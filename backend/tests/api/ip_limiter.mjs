// Throwaway verification for P0-7 (Node, part B): IP, admin and calendar limiters with tight limits.
import http from "node:http";

process.env.PORT = "5071";
process.env.FIREBASE_PROJECT_ID = "demo-campus-intel";
process.env.PYTHON_RAG_URL = "http://127.0.0.1:5082";
process.env.QUERY_RATE_PER_MINUTE = "1000";
process.env.QUERY_RATE_PER_MINUTE_PER_IP = "3";
process.env.ADMIN_RATE_PER_MINUTE = "2";
process.env.CALENDAR_RATE_PER_MINUTE = "2";
process.env.IP_RATE_PER_MINUTE = "14";

http.createServer((req, res) => {
  req.resume();
  req.on("end", () => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ answer: "ok", sources: [], status: "healthy" })); });
}).listen(5082);

const admin = (await import("firebase-admin")).default;
await import("../../config/firebaseAdmin.js");
admin.auth().verifyIdToken = async (t) => {
  if (t === "adminTok") return { uid: "boss", email: "boss@campus.edu", admin: true };
  if (/^user:/.test(t)) return { uid: t.slice(5) };
  const e = new Error("bad"); e.code = "auth/argument-error"; throw e;
};
await import("../../index.js");
await new Promise((r) => setTimeout(r, 1500));

const BASE = "http://127.0.0.1:5071";
let fails = 0, n = 0;
const check = (name, ok) => { console.log((ok ? "PASS " : "FAIL ") + name); if (!ok) fails++; };
const call = (method, path, token, body) => {
  n++;
  return fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
};
const ask = (user) => call("POST", "/document/query", `user:${user}`, { question: "hi" });

// 1. per-IP query limit: three different users share one IP
let codes = [];
for (const u of ["a", "b", "c", "d"]) codes.push((await ask(u)).status);
check("query per-IP limit: 3 users allowed, the 4th (a new user!) is 429", codes.join() === "200,200,200,429");
const r1 = await ask("e");
check("per-IP query 429 has a user-facing message", r1.status === 429 && /network/.test((await r1.json()).error));

// 2. admin limiter (per admin)
codes = [];
for (let i = 0; i < 3; i++) codes.push((await call("GET", "/documents/rag-status", "adminTok")).status);
check("admin limiter: 2 allowed, the 3rd is 429", codes.join() === "200,200,429");
check("non-admin gets 403 (auth runs before the admin limiter)", (await call("GET", "/documents/rag-status", "user:zed")).status === 403);

// 3. calendar limiter (per user)
codes = [];
for (let i = 0; i < 3; i++) codes.push((await call("GET", "/calendar/status", "user:cal")).status);
check("calendar limiter: 2 allowed, the 3rd is 429", codes.join() === "200,200,429");
check("calendar limiter is per user", (await call("GET", "/calendar/status", "user:cal2")).status === 200);

// 4. global per-IP limiter covers unauthenticated traffic
let first429 = null;
for (let i = 0; i < 20 && first429 === null; i++) {
  const r = await call("GET", "/documents/rag-status", null);
  if (r.status === 429) first429 = n;
}
check("global IP limiter: the first 429 comes right after the configured 14 requests", first429 === 15);
const rr = await call("GET", "/faq", null);
check("global IP limiter 429 is JSON with Retry-After", rr.status === 429 && Number(rr.headers.get("retry-after")) >= 1 && (await rr.json()).retryAfterSeconds >= 1);

console.log(fails ? `\nFAILED: ${fails}` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
