import http from "node:http";
process.env.PORT = "5076";
process.env.FIREBASE_PROJECT_ID = "demo-campus-intel";
process.env.PYTHON_RAG_URL = "http://127.0.0.1:5086";
process.env.ADMIN_RATE_PER_MINUTE = "1000"; process.env.IP_RATE_PER_MINUTE = "1000";
process.env.QUERY_RATE_PER_MINUTE = "1000"; process.env.QUERY_RATE_PER_MINUTE_PER_IP = "1000";
const pyBodies = [];
http.createServer((req, res) => {
  let raw = ""; req.on("data", (c) => (raw += c));
  req.on("end", () => {
    pyBodies.push({ url: req.url, body: raw ? JSON.parse(raw) : {} });
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/query") return res.end(JSON.stringify({ answer: "ok", sources: [], saved: true, metadata: {} }));
    res.statusCode = 202; res.end(JSON.stringify({ accepted: true }));
  });
}).listen(5086);
const admin = (await import("firebase-admin")).default;
await import("../../config/firebaseAdmin.js");
admin.auth().verifyIdToken = async (t) => ({ uid: "boss", email: "boss@campus.edu", admin: true });
await import("../../index.js");
await new Promise((r) => setTimeout(r, 1500));
const db = admin.firestore();
const BASE = "http://127.0.0.1:5076";
let fails = 0;
const check = (n, ok) => { console.log((ok ? "PASS " : "FAIL ") + n); if (!ok) fails++; };
const call = (method, path, body) => fetch(BASE + path, { method, headers: { "Content-Type": "application/json", Authorization: "Bearer t" }, body: body ? JSON.stringify(body) : undefined });
const URL = "https://qqdonjhgvuyjfusplexf.supabase.co/storage/v1/object/public/documents/a.pdf";
const meta = { name: "Fee Policy", department: "Academics", documentType: "Policy", version: "v2" };

await db.collection("documents").doc("old").set({ name: "Fee Policy", status: "Processed", fileUrl: URL });
let r = await call("POST", "/documents", { fileUrl: URL, metadata: meta, supersedes: "old" });
const created = await r.json();
check("a new version can be registered as replacing a live document", r.status === 201);
const rec = (await db.collection("documents").doc(created.documentId).get()).data();
check("the record stores `supersedes`", rec.supersedes === "old");
check("the old document is NOT retired yet (only after the new one is processed)", !(await db.collection("documents").doc("old").get()).data().supersededBy);

r = await call("POST", "/documents", { fileUrl: URL, metadata: meta, supersedes: "missing" });
check("replacing a document that does not exist is rejected", r.status === 400);
for (const bad of [5, "a/b", "x".repeat(200), {}]) {
  r = await call("POST", "/documents", { fileUrl: URL, metadata: meta, supersedes: bad });
  check(`invalid supersedes rejected: ${JSON.stringify(bad).slice(0, 15)}`, r.status === 400);
}
await db.collection("documents").doc("taken").set({ name: "T", status: "Processed", fileUrl: URL, supersededBy: "someone" });
r = await call("POST", "/documents", { fileUrl: URL, metadata: meta, supersedes: "taken" });
check("a document that was already replaced cannot be replaced again", r.status === 400);
r = await call("POST", "/documents", { fileUrl: URL, metadata: meta });
const plain = (await db.collection("documents").doc((await r.json()).documentId).get()).data();
check("no supersedes -> no field", r.status === 201 && !("supersedes" in plain));

// delete of the new version re-instates the old one
await db.collection("documents").doc("newv").set({ name: "N", status: "Processed", fileUrl: URL, supersedes: "old2" });
await db.collection("documents").doc("old2").set({ name: "O", status: "Processed", fileUrl: URL, supersededBy: "newv", supersededAt: new Date() });
r = await call("DELETE", "/documents/newv");
const del = await r.json();
const old2 = (await db.collection("documents").doc("old2").get()).data();
check("deleting the new version re-instates the old one", r.status === 200 && del.reinstated === "old2" && !("supersededBy" in old2));
await db.collection("documents").doc("newv2").set({ name: "N", status: "Processed", fileUrl: URL, supersedes: "old3" });
await db.collection("documents").doc("old3").set({ name: "O", status: "Processed", fileUrl: URL, supersededBy: "another" });
await call("DELETE", "/documents/newv2");
check("it does not touch an old document that something else replaced", (await db.collection("documents").doc("old3").get()).data().supersededBy === "another");

// filters reach Python
await (await call("POST", "/document/query", { question: "late fee?", department: " Library ", documentType: "Policy" })).text();
let q = pyBodies.filter((p) => p.url === "/query").at(-1).body;
check("department and documentType are forwarded (trimmed)", q.department === "Library" && q.documentType === "Policy");
await (await call("POST", "/document/query", { question: "late fee?", department: { $ne: 1 }, documentType: "x".repeat(300) })).text();
q = pyBodies.filter((p) => p.url === "/query").at(-1).body;
check("non-string or oversized filters are dropped", !("department" in q) && !("documentType" in q));
console.log(fails ? `\nFAILED: ${fails}` : "\nALL PASSED"); process.exit(fails ? 1 : 0);
