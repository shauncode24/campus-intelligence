// Throwaway verification for P0-8 (Node admin FAQ API). Runs inside the Firestore emulator.
process.env.PORT = "5072";
process.env.FIREBASE_PROJECT_ID = "demo-campus-intel";
process.env.PYTHON_RAG_URL = "http://127.0.0.1:5099";

const admin = (await import("firebase-admin")).default;
await import("../../config/firebaseAdmin.js");
admin.auth().verifyIdToken = async (t) => {
  if (t === "adminTok") return { uid: "boss", email: "boss@campus.edu", admin: true };
  if (t === "userTok") return { uid: "alice", email: "alice@x.com" };
  if (t === "guestTok") return { uid: "guest1" };
  const e = new Error("bad"); e.code = "auth/argument-error"; throw e;
};
await import("../../index.js");
await new Promise((r) => setTimeout(r, 1500));

const db = admin.firestore();
const BASE = "http://127.0.0.1:5072";
let fails = 0;
const check = (name, ok) => { console.log((ok ? "PASS " : "FAIL ") + name); if (!ok) fails++; };
const call = (method, path, token, body) =>
  fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
const good = { question: "When is the fee deadline?", answer: "15 November.", category: "deadline", order: 10, published: true };

// ---- access control ----
for (const [m, p, b] of [["GET", "/admin/faq"], ["POST", "/admin/faq", good], ["PUT", "/admin/faq/x", good], ["DELETE", "/admin/faq/x"]]) {
  check(`401 no token     ${m} ${p}`, (await call(m, p, null, b)).status === 401);
  check(`403 normal user  ${m} ${p}`, (await call(m, p, "userTok", b)).status === 403);
  check(`403 guest        ${m} ${p}`, (await call(m, p, "guestTok", b)).status === 403);
}
check("nothing was written by rejected callers", (await db.collection("faqs").get()).size === 0);

// ---- the old public route that exposed user questions is gone ----
await db.collection("questions").doc("secret1").set({ question: "I am being harassed by my guide, what do I do?", answer: "private", count: 50, intent: "general" });
let r = await fetch(BASE + "/faq");
check("Node GET /faq no longer exists (404)", r.status === 404);
check("and nothing from `questions` is returned by it", !(await r.text()).includes("harassed"));

// ---- create + validation ----
r = await call("POST", "/admin/faq", "adminTok", good);
const created = await r.json();
check("admin can create (201)", r.status === 201 && !!created.id);
const doc = (await db.collection("faqs").doc(created.id).get()).data();
check("stored with the editor's email and server timestamps", doc.createdBy === "boss@campus.edu" && !!doc.createdAt?.toDate && !!doc.updatedAt?.toDate);
check("stored fields are exactly the curated ones (no user data)", doc.intent === "deadline" && doc.published === true && doc.order === 10);

const bad = {
  "question too short": { ...good, question: "Hi" },
  "question too long": { ...good, question: "q".repeat(301) },
  "empty answer": { ...good, answer: "   " },
  "answer too long": { ...good, answer: "a".repeat(5001) },
  "unknown category": { ...good, category: "hacking" },
  "order not integer": { ...good, order: 1.5 },
  "order out of range": { ...good, order: 10000 },
  "published not boolean": { ...good, published: "yes" },
  "source page without name": { ...good, sourcePage: 4 },
  "source name too long": { ...good, sourceName: "s".repeat(151) },
  "source page 0": { ...good, sourceName: "Doc", sourcePage: 0 },
  "non-object body": "just a string",
};
for (const [label, body] of Object.entries(bad)) {
  const res = await call("POST", "/admin/faq", "adminTok", body);
  check(`rejects (400): ${label}`, res.status === 400);
}
check("no invalid entry was stored", (await db.collection("faqs").get()).size === 1);

// ---- defaults ----
r = await call("POST", "/admin/faq", "adminTok", { question: "A draft question", answer: "Draft answer" });
const draft = await r.json();
const dd = (await db.collection("faqs").doc(draft.id).get()).data();
check("defaults: category general, order 100, NOT published", dd.intent === "general" && dd.order === 100 && dd.published === false);

// ---- unexpected fields cannot be injected ----
r = await call("POST", "/admin/faq", "adminTok", { ...good, question: "Injected fields question", count: 9999, createdBy: "evil@x.com", userId: "alice", sources: [{ documentId: "d1" }] });
const inj = (await db.collection("faqs").doc((await r.json()).id).get()).data();
check("extra client fields (count, createdBy, sources) are ignored", inj.count === undefined && inj.createdBy === "boss@campus.edu" && inj.sources === undefined && inj.userId === undefined);

// ---- list ----
r = await call("GET", "/admin/faq", "adminTok");
let list = (await r.json()).faqs;
check("list includes drafts and is sorted by order", r.status === 200 && list.length === 3 && list[0].order <= list[1].order && list[1].order <= list[2].order);
check("list is shaped for the admin UI (category, published, ISO dates)", list.every((f) => f.category && typeof f.published === "boolean" && /T/.test(f.createdAt)));
check("list never includes user questions", !JSON.stringify(list).includes("harassed"));

// ---- update / publish toggle ----
r = await call("PUT", `/admin/faq/${draft.id}`, "adminTok", { question: "A draft question", answer: "Now final", published: true, category: "procedure", order: 5, sourceName: "Fee Policy", sourcePage: 2 });
const upd = (await db.collection("faqs").doc(draft.id).get()).data();
check("update works (publish + edit)", r.status === 200 && upd.published === true && upd.answer === "Now final" && upd.intent === "procedure" && upd.sourcePage === 2);
check("update refreshes updatedAt/updatedBy, keeps createdBy", upd.updatedBy === "boss@campus.edu" && upd.createdBy === "boss@campus.edu");
check("update validates too (400)", (await call("PUT", `/admin/faq/${draft.id}`, "adminTok", { ...good, category: "nope" })).status === 400);
check("update of unknown id -> 404", (await call("PUT", "/admin/faq/ghost", "adminTok", good)).status === 404);

// ---- delete ----
check("delete works", (await call("DELETE", `/admin/faq/${draft.id}`, "adminTok")).status === 200 && !(await db.collection("faqs").doc(draft.id).get()).exists);
check("delete unknown id -> 404", (await call("DELETE", "/admin/faq/ghost", "adminTok")).status === 404);

// ---- malformed / oversized bodies never expose stack traces or paths ----
const rawPost = (body) => fetch(BASE + "/admin/faq", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer adminTok" }, body });
let rb = await rawPost('{"question": "unterminated');
let rbText = await rb.text();
check("malformed JSON -> clean 400 JSON", rb.status === 400 && JSON.parse(rbText).error === "Invalid JSON body");
check("malformed JSON response has no stack trace or file paths", !/node_modules|body-parser|at \w+|\.js:\d+|SyntaxError/.test(rbText));
rb = await rawPost(JSON.stringify({ question: "x".repeat(300 * 1024) }));
rbText = await rb.text();
check("oversized body -> clean 413 JSON without internals", rb.status === 413 && JSON.parse(rbText).error === "Request body too large" && !/node_modules|PayloadTooLarge/.test(rbText));

// ---- cap ----
let batch = db.batch();
for (let i = 0; i < 500; i++) batch.set(db.collection("faqs").doc(`bulk${i}`), { question: `bulk ${i}`, answer: "x", intent: "general", order: 100, published: false });
await batch.commit();
r = await call("POST", "/admin/faq", "adminTok", good);
check("cannot exceed 500 FAQs (400)", r.status === 400);

console.log(fails ? `\nFAILED: ${fails}` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
