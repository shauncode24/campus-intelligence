// Throwaway verification for P0-2 (Node admin plane). Runs inside the Firestore emulator.
import http from "node:http";

process.env.PORT = "5066";
process.env.FIREBASE_PROJECT_ID = "demo-campus-intel";
process.env.PYTHON_RAG_URL = "http://127.0.0.1:5077";

// Fake Python service: records the headers it receives.
const pythonCalls = [];
http
  .createServer((req, res) => {
    pythonCalls.push({ url: req.url, auth: req.headers.authorization });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ success: true, totalChunks: 1, hasDuplicates: false }));
  })
  .listen(5077);

const admin = (await import("firebase-admin")).default;
await import("../../config/firebaseAdmin.js");

const TOKENS = {
  adminTok: { uid: "boss", email: "boss@campus.edu", admin: true },
  userTok: { uid: "alice", email: "alice@x.com" },
  guestTok: { uid: "guest1", firebase: { sign_in_provider: "anonymous" } },
  fakeAdminTok: { uid: "mallory", email: "m@x.com", admin: "true" }, // string, not boolean
};
admin.auth().verifyIdToken = async (t) => {
  if (TOKENS[t]) return TOKENS[t];
  const e = new Error("bad"); e.code = "auth/argument-error"; throw e;
};

await import("../../index.js");
await new Promise((r) => setTimeout(r, 1500));

const db = admin.firestore();
const BASE = "http://127.0.0.1:5066";
let fails = 0;
const check = (name, ok) => { console.log((ok ? "PASS " : "FAIL ") + name); if (!ok) fails++; };
const call = (method, path, token, body) =>
  fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });

await db.collection("documents").doc("seed1").set({ name: "Seed", status: "Processed", fileUrl: "https://x/y.pdf" });
await db.collection("documents").doc("proc1").set({ name: "P", status: "Processing" });

const routes = [
  ["GET", "/documents/rag-status"],
  ["POST", "/documents", { fileUrl: "https://qqdonjhgvuyjfusplexf.supabase.co/storage/v1/object/public/documents/a.pdf", metadata: { name: "n", department: "d", documentType: "t" } }],
  ["DELETE", "/documents/seed1"],
  ["POST", "/documents/process", { documentId: "seed1", fileUrl: "https://x" }],
  ["POST", "/documents/reprocess", { documentId: "seed1" }],
  ["POST", "/documents/process-bulk", { documents: [{ documentId: "seed1" }] }],
  ["POST", "/documents/check-duplicate", { name: "n", department: "d" }],
  ["POST", "/documents/validate-metadata", { metadata: {} }],
  ["GET", "/documents/processing-status/seed1"],
  ["DELETE", "/documents/cancel-processing/proc1"],
];
for (const prefix of ["/documents", "/api/documents"]) {
  for (const [m, p, b] of routes) {
    const path = p.replace(/^\/documents/, prefix);
    const label = `${m} ${path}`;
    check(`401 no token      ${label}`, (await call(m, path, null, b)).status === 401);
    check(`401 garbage token ${label}`, (await call(m, path, "garbage", b)).status === 401);
    check(`403 normal user   ${label}`, (await call(m, path, "userTok", b)).status === 403);
    check(`403 guest         ${label}`, (await call(m, path, "guestTok", b)).status === 403);
    check(`403 admin:"true" (string) ${label}`, (await call(m, path, "fakeAdminTok", b)).status === 403);
  }
}
check("nothing deleted by rejected callers", (await db.collection("documents").doc("seed1").get()).exists);
check("proc1 not cancelled by rejected callers", (await db.collection("documents").doc("proc1").get()).data().status === "Processing");
check("python never called by rejected callers", pythonCalls.length === 0);

// ---- admin happy paths ----
let r = await call("POST", "/documents", "adminTok", {
  fileUrl: "https://qqdonjhgvuyjfusplexf.supabase.co/storage/v1/object/public/documents/a.pdf", fileSize: 1234,
  metadata: { name: "  Fee Policy ", department: "Finance", documentType: "Policy", tags: "a, b", version: "v1.0", accessLevel: "Public" },
});
const created = await r.json();
check("admin create -> 201", r.status === 201 && !!created.documentId);
const snap = await db.collection("documents").doc(created.documentId).get();
const d = snap.data();
check("record has uploadedBy from verified token (not client)", d.uploadedBy === "boss@campus.edu");
check("record status Processing, name trimmed, tags parsed", d.status === "Processing" && d.name === "Fee Policy" && d.tags.join() === "a,b");
check("record has server timestamp", !!d.uploadedAt?.toDate);

r = await call("POST", "/documents", "adminTok", { fileUrl: "https://qqdonjhgvuyjfusplexf.supabase.co/storage/v1/object/public/documents/a.pdf", metadata: { name: "", department: "" } });
check("invalid metadata -> 400", r.status === 400);
r = await call("POST", "/documents", "adminTok", { metadata: { name: "n", department: "d", documentType: "t" } });
check("missing fileUrl -> 400", r.status === 400);
r = await call("POST", "/documents", "adminTok", { fileUrl: "https://qqdonjhgvuyjfusplexf.supabase.co/storage/v1/object/public/documents/a.pdf", metadata: { name: "n", department: "d", documentType: "t", version: "abc" } });
check("bad version -> 400", r.status === 400);
r = await call("POST", "/documents", "adminTok", { fileUrl: "https://qqdonjhgvuyjfusplexf.supabase.co/storage/v1/object/public/documents/a.pdf", uploadedBy: "evil@x.com", metadata: { name: "n", department: "d", documentType: "t", uploadedBy: "evil@x.com" } });
const c2 = await r.json();
check("client-supplied uploadedBy ignored", (await db.collection("documents").doc(c2.documentId).get()).data().uploadedBy === "boss@campus.edu");

r = await call("DELETE", `/documents/${created.documentId}`, "adminTok");
check("admin delete -> 200 and gone", r.status === 200 && !(await db.collection("documents").doc(created.documentId).get()).exists);
check("admin delete missing -> 404", (await call("DELETE", "/documents/nope", "adminTok")).status === 404);

pythonCalls.length = 0;
await call("POST", "/documents/process", "adminTok", { documentId: "seed1", fileUrl: "https://x" });
await call("POST", "/documents/reprocess", "adminTok", { documentId: "seed1" });
await call("POST", "/documents/check-duplicate", "adminTok", { name: "n", department: "d" });
check("python received 3 calls", pythonCalls.length === 3);
check("admin token forwarded to Python on every call", pythonCalls.every((c) => c.auth === "Bearer adminTok"));

console.log(fails ? `\nFAILED: ${fails}` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
