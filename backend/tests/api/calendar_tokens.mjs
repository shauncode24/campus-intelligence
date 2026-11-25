// P1-13: calendar tokens are stored encrypted, bound to their owner, and the feature fails closed without a key.
import crypto from "node:crypto";
process.env.PORT = "5078";
process.env.FIREBASE_PROJECT_ID = "demo-campus-intel";
process.env.PYTHON_RAG_URL = "http://127.0.0.1:5089";
process.env.IP_RATE_PER_MINUTE = "1000"; process.env.CALENDAR_RATE_PER_MINUTE = "1000";
process.env.GOOGLE_CLIENT_ID = "id"; process.env.GOOGLE_CLIENT_SECRET = "s"; process.env.GOOGLE_REDIRECT_URI = "http://x/cb";
delete process.env.TOKEN_ENCRYPTION_KEY;

const admin = (await import("firebase-admin")).default;
await import("../../config/firebaseAdmin.js");
admin.auth().verifyIdToken = async (t) => {
  if (t === "aliceTok") return { uid: "alice" };
  const e = new Error("bad"); e.code = "auth/argument-error"; throw e;
};
await import("../../index.js");
await new Promise((r) => setTimeout(r, 1500));
const vault = await import("../../services/calendarTokens.js");
const db = admin.firestore();

let fails = 0;
const check = (n, ok) => { console.log((ok ? "PASS " : "FAIL ") + n); if (!ok) fails++; };
const TOKENS = { access_token: "ya29.SECRET-ACCESS", refresh_token: "1//SECRET-REFRESH", expiry_date: 123 };

// ---- no key: fail closed
check("without a key: not configured", vault.encryptionConfigured() === false);
let threw = null;
try { await vault.saveTokens(db, admin, "alice", TOKENS); } catch (e) { threw = e; }
check("without a key: saving throws and writes NOTHING", threw?.name === "TokenKeyMissing" && !(await db.collection("user_calendar_tokens").doc("alice").get()).exists);
let r = await fetch("http://127.0.0.1:5078/calendar/auth", { headers: { Authorization: "Bearer aliceTok" } });
check("without a key: connecting a calendar answers 503 before Google is involved", r.status === 503);
r = await fetch("http://127.0.0.1:5078/calendar/status", { headers: { Authorization: "Bearer aliceTok" } });
check("status reports the feature unavailable", (await r.json()).available === false);

// ---- with a key
process.env.TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
check("with a key: configured (base64)", vault.encryptionConfigured());
process.env.TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
check("hex keys work too", vault.encryptionConfigured());
process.env.TOKEN_ENCRYPTION_KEY = "too-short";
check("a malformed key counts as not configured", !vault.encryptionConfigured());
process.env.TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");

await vault.saveTokens(db, admin, "alice", TOKENS);
const raw = (await db.collection("user_calendar_tokens").doc("alice").get()).data();
const dump = JSON.stringify(raw);
check("the stored record holds ciphertext, no plain token anywhere", !!raw.enc && !raw.tokens && !dump.includes("SECRET"));
check("it reads back exactly", JSON.stringify(await vault.loadTokens(db, admin, "alice")) === JSON.stringify(TOKENS));
check("each save uses a fresh IV", vault.encrypt(TOKENS, "alice") !== vault.encrypt(TOKENS, "alice"));

// ---- binding and tampering
await db.collection("user_calendar_tokens").doc("mallory").set({ enc: raw.enc });
check("a ciphertext copied into another user's record does not decrypt", (await vault.loadTokens(db, admin, "mallory")) === null);
const parts = raw.enc.split(":"); const body = Buffer.from(parts[3], "base64"); body[0] ^= 1; parts[3] = body.toString("base64");
check("a tampered ciphertext does not decrypt", vault.decrypt(parts.join(":"), "alice") === null);
check("garbage does not decrypt (and does not throw)", vault.decrypt("nonsense", "alice") === null && vault.decrypt(undefined, "alice") === null);
const keyA = process.env.TOKEN_ENCRYPTION_KEY;
process.env.TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
check("a different key cannot read it (the person just reconnects)", (await vault.loadTokens(db, admin, "alice")) === null);
process.env.TOKEN_ENCRYPTION_KEY = keyA;

// ---- legacy plaintext records keep working and are upgraded
await db.collection("user_calendar_tokens").doc("bob").set({ tokens: TOKENS, createdAt: new Date() });
check("an old plain-text record still works", JSON.stringify(await vault.loadTokens(db, admin, "bob")) === JSON.stringify(TOKENS));
const upgraded = (await db.collection("user_calendar_tokens").doc("bob").get()).data();
check("...and has been replaced by an encrypted one", !!upgraded.enc && !upgraded.tokens);
check("nothing stored -> null", (await vault.loadTokens(db, admin, "nobody")) === null);

// ---- through the API
r = await fetch("http://127.0.0.1:5078/calendar/auth", { headers: { Authorization: "Bearer aliceTok" } });
check("with a key: the OAuth link is issued", r.status === 200 && /accounts\.google\.com/.test((await r.json()).authUrl));
r = await fetch("http://127.0.0.1:5078/calendar/status", { headers: { Authorization: "Bearer aliceTok" } });
const st = await r.json();
check("status: connected and available", st.connected === true && st.available === true);

console.log(fails ? `\nFAILED: ${fails}` : "\nALL PASSED"); process.exit(fails ? 1 : 0);
