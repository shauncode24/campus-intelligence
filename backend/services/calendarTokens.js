/**
 * Storage of a person's Google Calendar tokens, encrypted (P1-13).
 *
 * The tokens let the service create events in someone's calendar until they revoke access. They
 * used to sit in Firestore as plain text, so anyone who could read the database (a backup, an
 * export, a mistake in the rules, an admin console) could use them. Now they are stored as
 * AES-256-GCM ciphertext, bound to the user's id (a ciphertext copied into another user's record
 * does not decrypt), with the key held only in the server's environment:
 *
 *   TOKEN_ENCRYPTION_KEY = 32 random bytes, base64 or hex   (node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
 *
 * Without the key the service refuses to STORE new tokens (it fails closed; nothing is saved in
 * plain text). Old plain-text records still work and are re-saved encrypted the first time they
 * are used.
 *
 * Losing or changing the key makes stored tokens unreadable: people just reconnect their calendar.
 */
import crypto from "node:crypto";

const COLLECTION = "user_calendar_tokens";
const VERSION = "v1";

export class TokenKeyMissing extends Error {
  constructor() {
    super("TOKEN_ENCRYPTION_KEY is not set (or is not 32 bytes)");
    this.name = "TokenKeyMissing";
  }
}

function key() {
  const raw = (process.env.TOKEN_ENCRYPTION_KEY || "").trim();
  if (!raw) return null;
  const candidates = [
    /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : null,
    Buffer.from(raw, "base64"),
  ];
  return candidates.find((b) => b && b.length === 32) || null;
}

export function encryptionConfigured() {
  return key() !== null;
}

export function encrypt(value, uid) {
  const k = key();
  if (!k) throw new TokenKeyMissing();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", k, iv);
  cipher.setAAD(Buffer.from(String(uid)));
  const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64"), cipher.getAuthTag().toString("base64"), body.toString("base64")].join(":");
}

/** @returns the original value, or null if it cannot be read (wrong key, wrong user, tampered) */
export function decrypt(text, uid) {
  try {
    const k = key();
    if (!k || typeof text !== "string") return null;
    const [version, iv, tag, body] = text.split(":");
    if (version !== VERSION) return null;
    const decipher = crypto.createDecipheriv("aes-256-gcm", k, Buffer.from(iv, "base64"));
    decipher.setAAD(Buffer.from(String(uid)));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    const plain = Buffer.concat([decipher.update(Buffer.from(body, "base64")), decipher.final()]);
    return JSON.parse(plain.toString("utf8"));
  } catch {
    return null;
  }
}

/** Save (replace) the user's tokens, encrypted. Throws TokenKeyMissing if no key is configured. */
export async function saveTokens(db, admin, uid, tokens) {
  await db.collection(COLLECTION).doc(uid).set({
    enc: encrypt(tokens, uid),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

/**
 * The user's tokens, or null if they have none or they cannot be read.
 * A plain-text record from before encryption is returned and, when a key is configured,
 * replaced by an encrypted one.
 */
export async function loadTokens(db, admin, uid) {
  const ref = db.collection(COLLECTION).doc(uid);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const data = snap.data() || {};
  if (data.enc) return decrypt(data.enc, uid);
  if (data.tokens) {
    if (encryptionConfigured()) {
      try {
        await saveTokens(db, admin, uid, data.tokens);
      } catch (e) {
        console.warn("Could not encrypt an old calendar record:", e.name);
      }
    }
    return data.tokens;
  }
  return null;
}

