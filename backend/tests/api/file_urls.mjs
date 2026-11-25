// Throwaway verification for P0-3 (Node). Runs inside the Firestore emulator.
import http from "node:http";

process.env.PORT = "5067";
process.env.FIREBASE_PROJECT_ID = "demo-campus-intel";
process.env.PYTHON_RAG_URL = "http://127.0.0.1:5078";

const pythonCalls = [];
http
  .createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      pythonCalls.push({ url: req.url, body: body ? JSON.parse(body) : null });
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ success: true, totalChunks: 1 }));
    });
  })
  .listen(5078);

const admin = (await import("firebase-admin")).default;
await import("../../config/firebaseAdmin.js");
admin.auth().verifyIdToken = async (t) => {
  if (t === "adminTok") return { uid: "boss", email: "boss@campus.edu", admin: true };
  const e = new Error("bad"); e.code = "auth/argument-error"; throw e;
};
await import("../../index.js");
await new Promise((r) => setTimeout(r, 1500));

const db = admin.firestore();
const BASE = "http://127.0.0.1:5067";
let fails = 0;
const check = (name, ok) => { console.log((ok ? "PASS " : "FAIL ") + name); if (!ok) fails++; };
const call = (method, path, body) =>
  fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", Authorization: "Bearer adminTok" },
    body: body ? JSON.stringify(body) : undefined,
  });

const HOST = "qqdonjhgvuyjfusplexf.supabase.co";
const P = "/storage/v1/object/public/documents/";
const GOOD = `https://${HOST}${P}123_policy.pdf`;
const meta = { name: "Policy", department: "Admin", documentType: "Policy" };

// ---- URL allow-list on record creation ----
const bad = {
  "http scheme": `http://${HOST}${P}x.pdf`,
  "other host": `https://evil.com${P}x.pdf`,
  "suffix trick": `https://${HOST}.evil.com${P}x.pdf`,
  "userinfo trick": `https://${HOST}@evil.com${P}x.pdf`,
  credentials: `https://u:p@${HOST}${P}x.pdf`,
  "cloud metadata": "https://169.254.169.254/latest/meta-data/",
  localhost: `https://localhost${P}x.pdf`,
  "custom port": `https://${HOST}:8443${P}x.pdf`,
  "other bucket": `https://${HOST}/storage/v1/object/public/other/x.pdf`,
  traversal: `https://${HOST}${P}../../secret.pdf`,
  "encoded traversal": `https://${HOST}${P}%2e%2e/%2e%2e/secret.pdf`,
  "file scheme": "file:///etc/passwd",
  empty: "",
  "not a string": 123,
};
for (const [label, fileUrl] of Object.entries(bad)) {
  const r = await call("POST", "/documents", { fileUrl, metadata: meta });
  check(`create rejects: ${label}`, r.status === 400);
}
check("no record created for rejected URLs", (await db.collection("documents").get()).size === 0);

let r = await call("POST", "/documents", { fileUrl: GOOD, metadata: meta });
const created = await r.json();
check("create accepts allow-listed bucket URL", r.status === 201 && !!created.documentId);
r = await call("POST", "/documents", { fileUrl: GOOD.replace(HOST, HOST.toUpperCase()), metadata: meta });
check("create accepts uppercase host", r.status === 201);

// ---- /process takes only an id ----
r = await call("POST", "/documents/process", {});
check("process: missing documentId -> 400", r.status === 400);
r = await call("POST", "/documents/process", { documentId: "does-not-exist", fileUrl: "http://169.254.169.254/" });
check("process: unknown documentId -> 404", r.status === 404);
check("process: Python not called for 404", pythonCalls.length === 0);

r = await call("POST", "/documents/process", { documentId: created.documentId, fileUrl: "http://169.254.169.254/steal" });
check("process: valid id -> 202 (the job runs in the background)", r.status === 202);
check("process: body sent to Python is exactly {documentId}",
  pythonCalls.length === 1 && JSON.stringify(pythonCalls[0].body) === JSON.stringify({ documentId: created.documentId }));
check("process: client-supplied fileUrl never reaches Python", !JSON.stringify(pythonCalls).includes("169.254"));

// ---- /reprocess uses only the id, even if the stored record is bad ----
await db.collection("documents").doc("legacy").set({ name: "Legacy", status: "Processed", fileUrl: "http://169.254.169.254/meta" });
pythonCalls.length = 0;
r = await call("POST", "/documents/reprocess", { documentId: "legacy", fileUrl: "http://evil/x" });
check("reprocess: forwards only documentId (Python re-validates stored URL)",
  pythonCalls.length === 1 && JSON.stringify(pythonCalls[0].body) === JSON.stringify({ documentId: "legacy", reprocess: true }));

// ---- bulk forwards ids only ----
pythonCalls.length = 0;
r = await call("POST", "/documents/process-bulk", { documents: [{ documentId: "legacy", fileUrl: "http://evil/x" }] });
check("the old bulk route is gone and nothing is forwarded", r.status === 404 && pythonCalls.length === 0);

console.log(fails ? `\nFAILED: ${fails}` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
