// Throwaway verification for P0-7 (Node, part A). Runs inside the Firestore emulator.
import http from "node:http";

process.env.PORT = "5070";
process.env.FIREBASE_PROJECT_ID = "demo-campus-intel";
process.env.PYTHON_RAG_URL = "http://127.0.0.1:5081";
process.env.FRONTEND_URL = "http://localhost:5173";
process.env.QUERY_RATE_PER_MINUTE = "3";
process.env.QUERY_RATE_PER_MINUTE_PER_IP = "1000";
process.env.IP_RATE_PER_MINUTE = "1000";
const SECRET = "SECRET projects/prod-db/databases/(default) token=abc123";

const pythonCalls = [];
http.createServer((req, res) => {
  let raw = ""; req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const body = raw ? JSON.parse(raw) : {};
    pythonCalls.push({ url: req.url, body });
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/query") {
      if (String(body.question).includes("BUDGET")) { res.statusCode = 429; return res.end(JSON.stringify({ detail: "You've reached today's question limit. Please try again tomorrow." })); }
      if (String(body.question).includes("BOOM")) { res.statusCode = 500; return res.end(SECRET); }
      return res.end(JSON.stringify({ answer: "Fees are due 5 May.", sources: [], cached: false, answered: true }));
    }
    if (req.url === "/process-document" && body.documentId === "docX") { res.statusCode = 500; return res.end(SECRET); }
    res.end(JSON.stringify({ success: true, totalChunks: 1 }));
  });
}).listen(5081);

const admin = (await import("firebase-admin")).default;
await import("../../config/firebaseAdmin.js");
admin.auth().verifyIdToken = async (t) => {
  if (t === "adminTok") return { uid: "boss", email: "boss@campus.edu", admin: true };
  if (/^user:/.test(t)) return { uid: t.slice(5) };
  const e = new Error("bad"); e.code = "auth/argument-error"; throw e;
};
await import("../../index.js");
await new Promise((r) => setTimeout(r, 1500));

const BASE = "http://127.0.0.1:5070";
let fails = 0;
const check = (name, ok) => { console.log((ok ? "PASS " : "FAIL ") + name); if (!ok) fails++; };
const q = (token, question, extra = {}) =>
  fetch(BASE + "/document/query", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...extra },
    body: JSON.stringify({ question }),
  });
const events = async (res) =>
  (await res.text()).split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));

// ---- input validation (before any limit is used up: use user "val") ----
const before = pythonCalls.length;
let r = await fetch(BASE + "/document/query", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer user:val" }, body: JSON.stringify({ question: { $gt: "" } }) });
check("non-string question rejected (400)", r.status === 400);
r = await q("user:val", "   ");
check("blank question rejected (400)", r.status === 400);
r = await q("user:val", "x".repeat(2001));
check("question over 2000 chars rejected (400)", r.status === 400);
check("rejected questions never reach Python", pythonCalls.length === before);
r = await fetch(BASE + "/document/query", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer user:val" }, body: JSON.stringify({ question: "x".repeat(200 * 1024) }) });
check("oversized request body rejected (413)", r.status === 413);

// ---- per-user query limit ----
const codes = [];
for (let i = 0; i < 4; i++) codes.push((await q("user:alice", `question ${i}`)).status);
check("user limit: 3 questions allowed, the 4th is 429", codes.join() === "200,200,200,429");
r = await q("user:alice", "again");
const j = await r.json();
check("429 body is JSON with a user-facing message + retryAfterSeconds", r.status === 429 && /too quickly/.test(j.error) && j.retryAfterSeconds >= 1);
check("429 has a Retry-After header", Number(r.headers.get("retry-after")) >= 1);
const bobRes = await q("user:bob", "hello");
await bobRes.text(); // wait for the stream to finish so the Python call has happened
check("another user is unaffected", bobRes.status === 200);
check("the blocked requests never reached Python", pythonCalls.filter((c) => c.url === "/query").length === 3 + 1);

// ---- Python's daily-budget 429 is passed on as a user-facing message ----
r = await q("user:carol", "BUDGET please");
let ev = await events(r);
const budgetErr = ev.find((e) => e.type === "error");
check("daily budget: stream carries a user-facing error", r.status === 200 && budgetErr?.userFacing === true && /today's question limit/.test(budgetErr.data));

// ---- unexpected Python failure never leaks ----
r = await q("user:dave", "BOOM");
ev = await events(r);
const err = ev.find((e) => e.type === "error");
check("unexpected failure: generic message with a ref", !!err && /ref [0-9a-f]{8}/.test(err.data) && err.userFacing !== true);
check("unexpected failure: nothing internal in the response", !JSON.stringify(ev).includes("SECRET") && !/Python RAG/.test(JSON.stringify(ev)) && !JSON.stringify(ev).includes("Internal Server Error"));

// ---- admin route errors are generic too ----
await admin.firestore().collection("documents").doc("docX").set({ name: "X", status: "Processed", fileUrl: "https://x" });
r = await fetch(BASE + "/documents/process", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer adminTok" }, body: JSON.stringify({ documentId: "docX" }) });
const pj = await r.json();
check("admin route 500: generic message with ref, no internals", r.status === 500 && /ref [0-9a-f]{8}/.test(pj.message) && !JSON.stringify(pj).includes("SECRET") && !/Python RAG/.test(JSON.stringify(pj)));
const docX = (await admin.firestore().collection("documents").doc("docX").get()).data();
check("the failure detail is recorded on the (admin-only) record, the message shown to people stays generic",
  /Python RAG service error/.test(docX.errorDetail) && docX.status === "Error" && !/Python RAG/.test(docX.errorMessage));

// ---- security headers ----
r = await fetch(BASE + "/faq");
check("helmet: no X-Powered-By", !r.headers.has("x-powered-by"));
check("helmet: X-Content-Type-Options: nosniff", r.headers.get("x-content-type-options") === "nosniff");

// ---- CORS ----
const pre = (origin) => fetch(BASE + "/document/query", { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type" } });
r = await pre("http://localhost:5173");
check("CORS: the web app origin is allowed", r.headers.get("access-control-allow-origin") === "http://localhost:5173");
check("CORS: credentials not allowed", !r.headers.has("access-control-allow-credentials"));
r = await pre("https://evil.example");
check("CORS: another origin gets no allow-origin header", !r.headers.has("access-control-allow-origin"));
r = await pre("http://127.0.0.1:5081");
check("CORS: the Python service URL is no longer an allowed browser origin", !r.headers.has("access-control-allow-origin"));
r = await fetch(BASE + "/faq", { headers: { Origin: "https://evil.example" } });
check("CORS: simple request from another origin gets no allow-origin header", !r.headers.has("access-control-allow-origin"));

console.log(fails ? `\nFAILED: ${fails}` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
