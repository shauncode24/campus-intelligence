// P0-9: "delete my data" removes everything about one person (and only them), then their account.
import { google } from "googleapis";
process.env.PORT = "5077";
process.env.FIREBASE_PROJECT_ID = "demo-campus-intel";
process.env.PYTHON_RAG_URL = "http://127.0.0.1:5089";
process.env.IP_RATE_PER_MINUTE = "1000"; process.env.ACCOUNT_RATE_PER_MINUTE = "1000";
process.env.GOOGLE_CLIENT_ID = "id"; process.env.GOOGLE_CLIENT_SECRET = "s"; process.env.GOOGLE_REDIRECT_URI = "http://x/cb";

const revoked = [];
google.auth.OAuth2.prototype.revokeToken = async function (t) { revoked.push(t); };

const admin = (await import("firebase-admin")).default;
await import("../../config/firebaseAdmin.js");
const deletedAccounts = [];
let deleteUserError = null;
admin.auth().deleteUser = async (uid) => { if (deleteUserError) throw deleteUserError; deletedAccounts.push(uid); };
admin.auth().verifyIdToken = async (t) => {
  if (t === "aliceTok") return { uid: "alice-uid-777", email: "alice@campus.edu" };
  if (t === "bobTok") return { uid: "bob-uid-888" };
  if (t === "adminTok") return { uid: "boss-uid-999", admin: true };
  const e = new Error("bad"); e.code = "auth/argument-error"; throw e;
};
await import("../../index.js");
await new Promise((r) => setTimeout(r, 1500));
const { USER_COLLECTIONS, USER_DOCUMENTS } = await import("../../services/userData.js");

const db = admin.firestore();
let fails = 0;
const check = (n, ok) => { console.log((ok ? "PASS " : "FAIL ") + n); if (!ok) fails++; };
const del = (tok, body) => fetch("http://127.0.0.1:5077/me", {
  method: "DELETE",
  headers: { "Content-Type": "application/json", ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body),
});

const A = "alice-uid-777", B = "bob-uid-888";
async function seed(uid, n) {
  for (const { name, field } of USER_COLLECTIONS) {
    for (let i = 0; i < n; i++) await db.collection(name).add({ [field]: uid, text: `private ${uid} ${i}` });
  }
  await db.collection("user_calendar_tokens").doc(uid).set({ tokens: { refresh_token: `rt-${uid}` } });
  await db.collection("users").doc(uid).set({ email: `${uid}@campus.edu`, role: "user" });
}
await seed(A, 450);          // more than one 400-document batch in every collection
await seed(B, 3);
await db.collection("questions").doc("q1").set({ question: "shared cache", answer: "no user id here" });
await db.collection("documents").doc("d1").set({ name: "Policy", uploadedBy: "someone@campus.edu" });

// every collection in the database that mentions the uid anywhere
async function collectionsMentioning(uid) {
  const hits = {};
  for (const col of await db.listCollections()) {
    const snap = await col.get();
    for (const d of snap.docs) if (d.id === uid || JSON.stringify(d.data()).includes(uid)) hits[col.id] = (hits[col.id] || 0) + 1;
  }
  return hits;
}
const before = await collectionsMentioning(A);
check("seed: Alice has data in every listed collection", [...USER_COLLECTIONS.map((c) => c.name), ...USER_DOCUMENTS].every((n) => before[n] > 0));

// ---- refusals
check("no token -> 401", (await del(null, { confirm: true })).status === 401);
check("no confirmation -> 400, nothing deleted", (await del("aliceTok", {})).status === 400 && (await del("aliceTok")).status === 400);
check("confirm must be exactly true", (await del("aliceTok", { confirm: "yes" })).status === 400);
check("admin account refused", (await del("adminTok", { confirm: true })).status === 403);
check("still all there after refusals", JSON.stringify(await collectionsMentioning(A)) === JSON.stringify(before) && deletedAccounts.length === 0);

// ---- a failure leaves the account so the person can retry
deleteUserError = new Error("auth down");
let r = await del("aliceTok", { confirm: true });
check("account-deletion failure -> 500", r.status === 500);
check("...but the data is already gone and can be retried", Object.keys(await collectionsMentioning(A)).length === 0);
deleteUserError = null;

// ---- the real thing
await seed(A, 2);            // she signed up again / retry with new data
r = await del("aliceTok", { confirm: true });
const j = await r.json();
check("delete -> 200", r.status === 200 && j.success === true);
check("every collection removed (counts reported)", USER_COLLECTIONS.every((c) => j.removed[c.name] === 2) && j.removed.users === 1 && j.removed.user_calendar_tokens === 1);
check("nothing in the whole database mentions Alice any more", Object.keys(await collectionsMentioning(A)).length === 0);
check("Alice's sign-in account was deleted", deletedAccounts.includes(A));
check("her Google calendar token was revoked", revoked.includes(`rt-${A}`));

// ---- others untouched
const bobAfter = await collectionsMentioning(B);
check("Bob's data is untouched", [...USER_COLLECTIONS.map((c) => c.name), ...USER_DOCUMENTS].every((n) => bobAfter[n] >= 1)
  && (await db.collection("chats").where("userId", "==", B).get()).size === 3);
check("shared cache and documents untouched", (await db.collection("questions").doc("q1").get()).exists && (await db.collection("documents").doc("d1").get()).exists);

// ---- repeat is harmless
r = await del("aliceTok", { confirm: true });
check("deleting again (nothing left) is fine", r.status === 200);

// ---- the list covers the code: every collection name used for per-user data is listed
import { readFileSync, readdirSync } from "node:fs";
const known = new Set([...USER_COLLECTIONS.map((c) => c.name), ...USER_DOCUMENTS]);
const shared = new Set(["documents", "chunks", "faqs", "meta", "questions"]);
const used = new Set();
const scan = (dir) => { for (const f of readdirSync(dir, { withFileTypes: true })) {
  if (f.name === "node_modules" || f.name === "tests" || f.name === "venv" || f.name === "__pycache__") continue;
  const p = `${dir}/${f.name}`;
  if (f.isDirectory()) scan(p); else if (/\.(js|py)$/.test(f.name)) for (const m of readFileSync(p, "utf8").matchAll(/collection\(["']([a-zA-Z_]+)["']\)/g)) used.add(m[1]);
} };
scan(new URL("../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const unlisted = [...used].filter((n) => !known.has(n) && !shared.has(n));
check(`every collection the code uses is either erased or declared shared (unlisted: ${unlisted.join(",") || "none"})`, unlisted.length === 0);

console.log(fails ? `\nFAILED: ${fails}` : "\nALL PASSED"); process.exit(fails ? 1 : 0);
