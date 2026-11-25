import http from "node:http";
process.env.PORT = "5075";
process.env.FIREBASE_PROJECT_ID = "demo-campus-intel";
process.env.PYTHON_RAG_URL = "http://127.0.0.1:5085";
process.env.ADMIN_RATE_PER_MINUTE = "1000";
process.env.IP_RATE_PER_MINUTE = "1000";
const calls = []; let mode = "accept";
http.createServer((req, res) => {
  let raw = ""; req.on("data", (c) => (raw += c));
  req.on("end", () => {
    calls.push({ url: req.url, body: raw ? JSON.parse(raw) : {} });
    res.setHeader("Content-Type", "application/json");
    if (mode === "accept") { res.statusCode = 202; return res.end(JSON.stringify({ accepted: true })); }
    if (mode === "busy") { res.statusCode = 409; return res.end(JSON.stringify({ detail: "This document is already being processed" })); }
    if (mode === "badurl") { res.statusCode = 400; return res.end(JSON.stringify({ detail: "File URL host is not allowed" })); }
    res.statusCode = 500; res.end("{}");
  });
}).listen(5085);
const admin = (await import("firebase-admin")).default;
await import("../../config/firebaseAdmin.js");
admin.auth().verifyIdToken = async (t) => {
  if (t === "adminTok") return { uid: "boss", email: "boss@campus.edu", admin: true };
  const e = new Error("bad"); e.code = "auth/argument-error"; throw e;
};
await import("../../index.js");
await new Promise((r) => setTimeout(r, 1500));
const db = admin.firestore();
const BASE = "http://127.0.0.1:5075";
let fails = 0;
const check = (n, ok) => { console.log((ok ? "PASS " : "FAIL ") + n); if (!ok) fails++; };
const call = (method, path, body) => fetch(BASE + path, { method, headers: { "Content-Type": "application/json", Authorization: "Bearer adminTok" }, body: body ? JSON.stringify(body) : undefined });
const seed = async (id, data) => db.collection("documents").doc(id).set({ name: id, status: "Processed", fileUrl: "https://x/y.pdf", ...data });
const status = async (id) => (await db.collection("documents").doc(id).get()).data()?.status;

await seed("d1", { status: "Processing" });
let r = await call("POST", "/documents/process", { documentId: "d1" });
check("process returns 202 immediately", r.status === 202 && (await r.json()).accepted === true);
check("Python receives only the id", JSON.stringify(calls.at(-1).body) === '{"documentId":"d1"}' && calls.at(-1).url === "/process-document");
check("document is Processing", (await status("d1")) === "Processing");

await seed("d2", { status: "Processed" });
await db.collection("questions").doc("q1").set({ sources: [{ documentId: "d2" }], answer: "old" });
await db.collection("questions").doc("q2").set({ sources: [{ documentId: "other" }], answer: "keep" });
r = await call("POST", "/documents/reprocess", { documentId: "d2" });
const body = await r.json();
check("reprocess returns 202 and removes stale cached answers", r.status === 202 && body.cacheEntriesRemoved === 1);
check("unrelated cache entries are kept", (await db.collection("questions").doc("q2").get()).exists);
check("reprocess of a LIVE document keeps it Processed (still answering from its current version)", (await status("d2")) === "Processed");
check("Python is told it is a re-process of a live document", calls.at(-1).body.reprocess === true && calls.at(-1).body.documentId === "d2");

mode = "busy";
await seed("d3", { status: "Processing" });
r = await call("POST", "/documents/process", { documentId: "d3" });
check("a job already running is a 409 and the document is not marked Error", r.status === 409 && (await status("d3")) === "Processing");

mode = "badurl";
await seed("d4", { status: "Processed" });
r = await call("POST", "/documents/process", { documentId: "d4" });
check("Python refusing the address is a 400 with its message and the old status is restored", r.status === 400 && (await r.json()).message === "File URL host is not allowed" && (await status("d4")) === "Processed");

mode = "fail";
await seed("d5", { status: "Processed" });
r = await call("POST", "/documents/process", { documentId: "d5" });
const d5 = (await db.collection("documents").doc("d5").get()).data();
check("Python failing to start gives a generic 500, never a stuck Processing", r.status === 500 && d5.status === "Error" && !/500/.test(d5.errorMessage || ""));
mode = "accept";

check("missing documentId -> 400", (await call("POST", "/documents/process", {})).status === 400);
check("unknown document -> 404", (await call("POST", "/documents/process", { documentId: "nope" })).status === 404);
await seed("d6", { status: "Deleting" });
check("a document being deleted -> 409", (await call("POST", "/documents/process", { documentId: "d6" })).status === 409);
check("the dead bulk route is gone", (await call("POST", "/documents/process-bulk", { documents: [] })).status === 404);

await db.collection("documents").doc("d7").set({ name: "d7", status: "Processing", processing: { stage: "reading", percent: 40, message: "Reading page 2 of 5" } });
const st = await (await call("GET", "/documents/processing-status/d7")).json();
check("status exposes the real progress", st.processing.percent === 40 && st.processing.stage === "reading" && st.status === "Processing");
const nores = await fetch(BASE + "/documents/process", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
check("no token -> 401", nores.status === 401);
console.log(fails ? `\nFAILED: ${fails}` : "\nALL PASSED"); process.exit(fails ? 1 : 0);
