// Throwaway verification for P0-6 (Node). Runs inside the Firestore emulator.
import http from "node:http";

process.env.PORT = "5069";
process.env.FIREBASE_PROJECT_ID = "demo-campus-intel";
process.env.PYTHON_RAG_URL = "http://127.0.0.1:5080";
const KEY = "service-role-SECRET-key-123";

// Fake Python: succeeds, except for documentId "doc6" which fails
const pythonCalls = [];
http.createServer((req, res) => {
  let raw = ""; req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const body = raw ? JSON.parse(raw) : {};
    pythonCalls.push(body);
    res.setHeader("Content-Type", "application/json");
    if (body.documentId === "doc6") { res.statusCode = 500; return res.end("{}"); }
    res.end(JSON.stringify({ success: true, totalChunks: 7, textChunks: 6, visualChunks: 1 }));
  });
}).listen(5080);

// Intercept calls to Supabase only; everything else uses the real fetch
const realFetch = globalThis.fetch;
const supaCalls = [];
let supaMode = { status: 200 };
globalThis.fetch = async (url, opts) => {
  if (String(url).includes("supabase.co")) {
    supaCalls.push({ url: String(url), method: opts?.method, headers: opts?.headers });
    if (supaMode.throw) { const e = new Error("net down"); e.name = "TypeError"; throw e; }
    return new Response("{}", { status: supaMode.status });
  }
  return realFetch(url, opts);
};

const admin = (await import("firebase-admin")).default;
await import("../../config/firebaseAdmin.js");
admin.auth().verifyIdToken = async (t) => {
  if (t === "adminTok") return { uid: "boss", email: "boss@campus.edu", admin: true };
  const e = new Error("bad"); e.code = "auth/argument-error"; throw e;
};
await import("../../index.js");
await new Promise((r) => setTimeout(r, 1500));

const db = admin.firestore();
const BASE = "http://127.0.0.1:5069";
let fails = 0;
const check = (name, ok) => { console.log((ok ? "PASS " : "FAIL ") + name); if (!ok) fails++; };
const call = (method, path, body) =>
  realFetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", Authorization: "Bearer adminTok" },
    body: body ? JSON.stringify(body) : undefined,
  });

const HOST = "qqdonjhgvuyjfusplexf.supabase.co";
const url = (name) => `https://${HOST}/storage/v1/object/public/documents/${name}`;

async function seedChunks(docId, n) {
  let w = db.batch(), c = 0;
  for (let i = 0; i < n; i++) {
    w.set(db.collection("chunks").doc(`${docId}_${i}`), { documentId: docId, index: i, embedding: [1, 2, 3], content: "x" });
    if (++c === 400) { await w.commit(); w = db.batch(); c = 0; }
  }
  if (c) await w.commit();
}
const chunkCount = async (docId) => (await db.collection("chunks").where("documentId", "==", docId).count().get()).data().count;
const exists = async (col, id) => (await db.collection(col).doc(id).get()).exists;

// ---------- seed ----------
await db.collection("documents").doc("doc1").set({ name: "Policy", status: "Processed", fileUrl: url("123_policy%20v1.pdf") });
await db.collection("documents").doc("doc2").set({ name: "Other", status: "Processed", fileUrl: url("other.pdf") });
await seedChunks("doc1", 1200);   // > 2 x the 500-op batch limit
await seedChunks("doc2", 30);
await db.collection("questions").doc("q_new").set({ question: "a", sources: [{ documentId: "doc1" }] });
await db.collection("questions").doc("q_both").set({ question: "b", sources: [{ documentId: "doc2" }, { documentId: "doc1" }] });
await db.collection("questions").doc("q_flat").set({ question: "c", documentIds: ["doc1"], sources: [] });
await db.collection("questions").doc("q_other").set({ question: "d", sources: [{ documentId: "doc2" }] });
await db.collection("questions").doc("q_none").set({ question: "e", sources: [] });
await db.collection("questions").doc("q_legacy_nosources").set({ question: "f" });

// ---------- 1. full delete ----------
process.env.SUPABASE_SERVICE_ROLE_KEY = KEY;
let r = await call("DELETE", "/documents/doc1");
let j = await r.json();
check("delete: 200 success", r.status === 200 && j.success === true);
check("delete: all 1200 chunks removed (past the 500-op batch limit)", j.chunksDeleted === 1200 && (await chunkCount("doc1")) === 0);
check("delete: another document's chunks untouched", (await chunkCount("doc2")) === 30);
check("delete: cached answers citing it removed (nested sources + flat documentIds)", j.cacheEntriesRemoved === 3
  && !(await exists("questions", "q_new")) && !(await exists("questions", "q_both")) && !(await exists("questions", "q_flat")));
check("delete: unrelated cached answers kept", (await exists("questions", "q_other")) && (await exists("questions", "q_none")) && (await exists("questions", "q_legacy_nosources")));
check("delete: record itself removed", !(await exists("documents", "doc1")));
check("delete: storage object deleted via Supabase API", j.file?.deleted === true && supaCalls.length === 1);
check("delete: correct storage endpoint + method", supaCalls[0].method === "DELETE"
  && supaCalls[0].url === `https://${HOST}/storage/v1/object/documents/123_policy%20v1.pdf`);
check("delete: service key sent to Supabase only in headers", supaCalls[0].headers.apikey === KEY && supaCalls[0].headers.Authorization === `Bearer ${KEY}`);
check("delete: service key never appears in the API response", !JSON.stringify(j).includes(KEY));

// ---------- 2. storage failure modes never block deletion ----------
async function deleteWith(id, fileUrl, mode, key = KEY) {
  await db.collection("documents").doc(id).set({ name: id, status: "Processed", fileUrl });
  await seedChunks(id, 5);
  supaCalls.length = 0; supaMode = mode;
  if (key) process.env.SUPABASE_SERVICE_ROLE_KEY = key; else delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const res = await call("DELETE", `/documents/${id}`);
  return { status: res.status, body: await res.json() };
}
let x = await deleteWith("d_nokey", url("a.pdf"), { status: 200 }, null);
check("no service key: record + chunks still deleted", x.status === 200 && !(await exists("documents", "d_nokey")) && (await chunkCount("d_nokey")) === 0);
check("no service key: reported, Supabase not called", x.body.file.deleted === false && /SERVICE_ROLE_KEY/.test(x.body.file.reason) && supaCalls.length === 0);
x = await deleteWith("d_500", url("b.pdf"), { status: 500 });
check("storage HTTP 500: still deleted, reported", x.status === 200 && x.body.file.deleted === false && /500/.test(x.body.file.reason) && !(await exists("documents", "d_500")));
x = await deleteWith("d_404", url("c.pdf"), { status: 404 });
check("storage 404 (already gone) counts as deleted", x.body.file.deleted === true);
x = await deleteWith("d_net", url("d.pdf"), { throw: true });
check("storage network error: still deleted, reported", x.status === 200 && x.body.file.deleted === false && !(await exists("documents", "d_net")));
x = await deleteWith("d_legacy", "http://169.254.169.254/evil.pdf", { status: 200 });
check("unrecognised stored URL: storage NOT called, still deleted", x.status === 200 && supaCalls.length === 0 && x.body.file.deleted === false && !(await exists("documents", "d_legacy")));

// ---------- 3. retry after a half-finished delete ----------
await db.collection("documents").doc("d_stuck").set({ name: "s", status: "Deleting", fileUrl: url("s.pdf") });
await seedChunks("d_stuck", 10);
supaMode = { status: 200 }; process.env.SUPABASE_SERVICE_ROLE_KEY = KEY;
r = await call("DELETE", "/documents/d_stuck");
check("retry of a 'Deleting' document completes", r.status === 200 && !(await exists("documents", "d_stuck")) && (await chunkCount("d_stuck")) === 0);
check("delete unknown id -> 404", (await call("DELETE", "/documents/nope")).status === 404);

// ---------- 4. cancel-processing with > 500 chunks ----------
await db.collection("documents").doc("d_cancel").set({ name: "c", status: "Processing" });
await seedChunks("d_cancel", 700);
r = await call("DELETE", "/documents/cancel-processing/d_cancel");
check("cancel: 700 partial chunks all removed (used to fail past 500)", r.status === 200 && (await chunkCount("d_cancel")) === 0);
check("cancel: marked Cancelled", (await db.collection("documents").doc("d_cancel").get()).data().status === "Cancelled");

// ---------- 5. reprocess ----------
await db.collection("documents").doc("doc5").set({ name: "R", status: "Processed", fileUrl: url("r.pdf") });
await db.collection("questions").doc("q_r1").set({ question: "r1", sources: [{ documentId: "doc5" }] });
await db.collection("questions").doc("q_keep").set({ question: "keep", sources: [{ documentId: "doc2" }] });
pythonCalls.length = 0;
r = await call("POST", "/documents/reprocess", { documentId: "doc5" });
j = await r.json();
check("reprocess: 202 (runs in the background) and sends only the id to Python", r.status === 202 && JSON.stringify(pythonCalls) === JSON.stringify([{ documentId: "doc5", reprocess: true }]));
check("reprocess: cached answers citing the document invalidated", j.cacheEntriesRemoved === 1 && !(await exists("questions", "q_r1")) && (await exists("questions", "q_keep")));

await db.collection("documents").doc("doc6").set({ name: "F", status: "Processed", fileUrl: url("f.pdf") });
r = await call("POST", "/documents/reprocess", { documentId: "doc6" });
const d6 = (await db.collection("documents").doc("doc6").get()).data();
check("reprocess failure: 500 returned", r.status === 500);
check("reprocess failure of a live document: it keeps answering (still Processed) and the admin is told", d6.status === "Processed" && !!d6.reprocessError);
r = await call("POST", "/documents/reprocess", { documentId: "ghost" });
check("reprocess unknown document -> 404", r.status === 404);

console.log(fails ? `\nFAILED: ${fails}` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
