// The Node API's documented routes (API.md) exist and are protected as documented; the removed ones are gone (P2-4).
import { readFileSync } from "node:fs";
process.env.PORT = "5075";
process.env.FIREBASE_PROJECT_ID = "demo-campus-intel";
process.env.PYTHON_RAG_URL = "http://127.0.0.1:5089";
process.env.IP_RATE_PER_MINUTE = "1000"; process.env.ADMIN_RATE_PER_MINUTE = "1000";
process.env.QUERY_RATE_PER_MINUTE = "1000"; process.env.QUERY_RATE_PER_MINUTE_PER_IP = "1000";
const admin = (await import("firebase-admin")).default;
await import("../../config/firebaseAdmin.js");
admin.auth().verifyIdToken = async () => { const e = new Error("bad"); e.code = "auth/argument-error"; throw e; };
await import("../../index.js");
await new Promise((r) => setTimeout(r, 1500));

let fails = 0;
const check = (n, ok) => { console.log((ok ? "PASS " : "FAIL ") + n); if (!ok) fails++; };
const md = readFileSync(new URL("../../../API.md", import.meta.url), "utf8");
const section = md.split("## Node API")[1].split("\n## ")[0];
const rows = [...section.matchAll(/^\|\s*([A-Z]+)\s*\|\s*`([^`]+)`\s*\|\s*([^|]+?)\s*\|/gm)].map((m) => ({ method: m[1], path: m[2], who: m[3] }));
check(`the document lists the Node routes (${rows.length})`, rows.length >= 15);
const call = (method, path) => fetch("http://127.0.0.1:5075" + path.replace(/:[A-Za-z]+/g, "x"), { method, headers: { "Content-Type": "application/json" }, body: method === "GET" || method === "DELETE" ? undefined : "{}" });

for (const r of rows) {
  const res = await call(r.method, r.path);
  if (r.who.startsWith("public")) check(`${r.method} ${r.path} exists (public)`, res.status !== 404 && res.status !== 401);
  else check(`${r.method} ${r.path} exists and refuses a caller with no token`, res.status === 401);
}
for (const [m, p] of [["GET", "/history"], ["POST", "/api/documents/process"], ["GET", "/api/documents/rag-status"], ["POST", "/ask"], ["POST", "/ask-stream"]]) {
  check(`removed/never-existing route is gone: ${m} ${p}`, (await call(m, p)).status === 404);
}
console.log(fails ? `\nFAILED: ${fails}` : "\nALL PASSED"); process.exit(fails ? 1 : 0);
