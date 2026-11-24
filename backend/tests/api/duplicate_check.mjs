import http from "node:http";
process.env.PORT = "5078";
process.env.FIREBASE_PROJECT_ID = "demo-campus-intel";
process.env.PYTHON_RAG_URL = "http://127.0.0.1:5088";
process.env.ADMIN_RATE_PER_MINUTE = "1000"; process.env.IP_RATE_PER_MINUTE = "1000";
const seen = [];
http.createServer((req, res) => {
  seen.push({ method: req.method, url: req.url });
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ hasDuplicates: false, exactDuplicates: [], similarDocuments: [] }));
}).listen(5088);
const admin = (await import("firebase-admin")).default;
await import("../../config/firebaseAdmin.js");
admin.auth().verifyIdToken = async (t) => (t === "adminTok" ? { uid: "boss", email: "b@c.edu", admin: true } : (() => { const e = new Error("bad"); e.code = "auth/argument-error"; throw e; })());
await import("../../index.js");
await new Promise((r) => setTimeout(r, 1500));
let fails = 0;
const check = (n, ok) => { console.log((ok ? "PASS " : "FAIL ") + n); if (!ok) fails++; };
const post = (body, tok = "adminTok") => fetch("http://127.0.0.1:5078/documents/check-duplicate", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` }, body: JSON.stringify(body) });
const H = "a".repeat(64);
let r = await post({ sha256: H.toUpperCase() });
const u = new URL("http://x" + seen.at(-1).url);
check("a hash alone is accepted and sent lowercased", r.status === 200 && u.searchParams.get("sha256") === H && !u.searchParams.has("name") && seen.at(-1).method === "POST");
r = await post({ name: "Fee Policy", department: "Library", sha256: H });
const u2 = new URL("http://x" + seen.at(-1).url);
check("name, department and hash are all forwarded", u2.searchParams.get("name") === "Fee Policy" && u2.searchParams.get("department") === "Library" && u2.searchParams.get("sha256") === H);
r = await post({ name: "A & B = C?", department: "Lib/rary" });
const u3 = new URL("http://x" + seen.at(-1).url);
check("special characters are encoded, not injected", u3.searchParams.get("name") === "A & B = C?" && u3.searchParams.get("department") === "Lib/rary" && [...u3.searchParams.keys()].length === 2);
const before = seen.length;
for (const bad of [{ sha256: "xyz" }, { sha256: "a".repeat(63) }, {}, { name: "x" }, { department: "y" }, { name: 5, department: {} }]) {
  r = await post(bad);
  check(`rejected (400): ${JSON.stringify(bad)}`, r.status === 400);
}
check("rejected requests never reach Python", seen.length === before);
check("no token -> 401", (await post({ sha256: H }, "")).status === 401);
console.log(fails ? `\nFAILED: ${fails}` : "\nALL PASSED"); process.exit(fails ? 1 : 0);
