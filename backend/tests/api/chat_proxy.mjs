import http from "node:http";
process.env.PORT = "5074";
process.env.FIREBASE_PROJECT_ID = "demo-campus-intel";
process.env.PYTHON_RAG_URL = "http://127.0.0.1:5084";
process.env.QUERY_RATE_PER_MINUTE = "1000"; process.env.QUERY_RATE_PER_MINUTE_PER_IP = "1000"; process.env.IP_RATE_PER_MINUTE = "1000";
const bodies = []; let mode = "ok";
http.createServer((req, res) => {
  let raw = ""; req.on("data", (c) => (raw += c));
  req.on("end", () => {
    bodies.push(JSON.parse(raw || "{}"));
    res.setHeader("Content-Type", "application/json");
    if (mode === "404") { res.statusCode = 404; return res.end(JSON.stringify({ detail: "Chat not found" })); }
    res.end(JSON.stringify({ answer: "Rs 200 a day", saved: mode !== "unsaved", sources: [], cached: false, answered: true,
      metadata: { cached: false, answered: true, sources: [{ documentName: "Fees", displayPage: 2 }], historyId: "h1", favorite: false } }));
  });
}).listen(5084);
const admin = (await import("firebase-admin")).default;
await import("../../config/firebaseAdmin.js");
admin.auth().verifyIdToken = async () => ({ uid: "alice" });
await import("../../index.js");
await new Promise((r) => setTimeout(r, 1500));
let fails = 0;
const check = (n, ok) => { console.log((ok ? "PASS " : "FAIL ") + n); if (!ok) fails++; };
const post = (b) => fetch("http://127.0.0.1:5074/document/query", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer t" }, body: JSON.stringify(b) });
const events = async (r) => (await r.text()).split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));

let ev = await events(await post({ question: "late fee?", chatId: "c1" }));
check("chatId is forwarded to the RAG service", bodies.at(-1).chatId === "c1");
const md = ev.find((e) => e.type === "metadata").data;
check("metadata is the RAG service's, with historyId", md.historyId === "h1" && md.sources[0].documentName === "Fees");
check("saved flag is true when stored", md.saved === true);
await post({ question: "late fee?" }).then((r) => r.text());
check("no chatId -> none forwarded", !("chatId" in bodies.at(-1)));
for (const bad of [5, "", "x".repeat(200), { a: 1 }]) check(`bad chatId rejected: ${JSON.stringify(bad).slice(0, 20)}`, (await post({ question: "q", chatId: bad })).status === 400);
mode = "unsaved"; ev = await events(await post({ question: "q", chatId: "c1" }));
check("saved:false is passed to the browser", ev.find((e) => e.type === "metadata").data.saved === false);
mode = "404"; ev = await events(await post({ question: "q", chatId: "c1" }));
const err = ev.find((e) => e.type === "error");
check("a missing chat becomes a user-facing error", err?.userFacing === true && /no longer exists/.test(err.data));
console.log(fails ? `\nFAILED: ${fails}` : "\nALL PASSED"); process.exit(fails ? 1 : 0);
