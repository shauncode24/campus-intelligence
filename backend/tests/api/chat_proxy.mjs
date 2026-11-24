import http from "node:http";
process.env.PORT = "5074";
process.env.FIREBASE_PROJECT_ID = "demo-campus-intel";
process.env.PYTHON_RAG_URL = "http://127.0.0.1:5084";
process.env.QUERY_RATE_PER_MINUTE = "1000"; process.env.QUERY_RATE_PER_MINUTE_PER_IP = "1000"; process.env.IP_RATE_PER_MINUTE = "1000";
const bodies = []; let mode = "ok"; let upstreamClosed = 0;
const line = (o) => JSON.stringify(o) + "\n";
const metadata = (saved) => ({ cached: false, answered: true, sources: [{ documentName: "Fees", displayPage: 2 }], historyId: "h1", favorite: false, saved });
http.createServer((req, res) => {
  let raw = ""; req.on("data", (c) => (raw += c));
  req.on("end", () => {
    bodies.push(JSON.parse(raw || "{}"));
    if (mode === "404") { res.statusCode = 404; res.setHeader("Content-Type", "application/json"); return res.end(JSON.stringify({ detail: "Chat not found" })); }
    res.setHeader("Content-Type", "application/x-ndjson");
    res.on("close", () => { if (!res.writableEnded) upstreamClosed++; });
    if (mode === "slow") {                       // first piece now, the rest much later
      res.write(line({ type: "text", data: "Rs 200 " }));
      return setTimeout(() => { res.write(line({ type: "text", data: "a day" })); res.write(line({ type: "metadata", data: metadata(true) })); res.end(line({ type: "done" })); }, 1500);
    }
    if (mode === "hang") { res.write(line({ type: "text", data: "Rs " })); return; }     // never finishes: the client will leave
    if (mode === "split") {                      // one JSON line cut in two network writes, plus junk that must not pass
      const whole = line({ type: "metadata", data: metadata(true) });
      res.write(line({ type: "text", data: "Rs 200 a day" }));
      res.write("not json at all\n" + line({ type: "evil", data: "x" }));
      res.write(whole.slice(0, 20));
      return setTimeout(() => { res.write(whole.slice(20)); res.end(line({ type: "done" })); }, 100);
    }
    res.write(line({ type: "text", data: "Rs 200 " })); res.write(line({ type: "text", data: "a day" }));
    res.write(line({ type: "metadata", data: metadata(mode !== "unsaved") }));
    res.end(line({ type: "done" }));
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
mode = "ok";
await (await post({ question: "q", chatId: "c1", regenerate: true })).text();
check("regenerate: true is forwarded", bodies.at(-1).regenerate === true);
await (await post({ question: "q", chatId: "c1" })).text();
check("no regenerate flag -> none forwarded", !("regenerate" in bodies.at(-1)));
for (const odd of ["true", 1, "yes", {}]) {
  await (await post({ question: "q", chatId: "c1", regenerate: odd })).text();
  check(`only a real boolean true is forwarded (not ${JSON.stringify(odd)})`, !("regenerate" in bodies.at(-1)));
}
// ---- P2-3: real streaming ----
mode = "ok"; ev = await events(await post({ question: "q", chatId: "c1" }));
check("the answer is relayed piece by piece, then metadata, then done", ev.filter((e) => e.type === "text").map((e) => e.data).join("") === "Rs 200 a day" && ev.at(-1).type === "done" && ev.at(-2).type === "metadata");
mode = "slow";
{
  const t0 = Date.now(); const r = await post({ question: "q", chatId: "c1" }); const reader = r.body.getReader(); const dec = new TextDecoder();
  let first = null, all = "";
  for (;;) { const { value, done } = await reader.read(); if (done) break; all += dec.decode(value); if (first === null && all.includes("Rs 200")) first = Date.now() - t0; }
  check(`the first words arrive before generation ends (${first} ms of ~1500)`, first !== null && first < 1000);
  check("and the rest still arrives", all.includes("a day") && all.includes('"type":"done"'));
  check("no artificial per-word delay is added", Date.now() - t0 < 2500);
}
mode = "split"; ev = await events(await post({ question: "q", chatId: "c1" }));
check("a JSON line split across network reads is still delivered", ev.some((e) => e.type === "metadata" && e.data.historyId === "h1"));
check("lines that are not valid events are never passed on", !ev.some((e) => e.type === "evil") && ev.every((e) => ["intent", "text", "metadata", "done", "error"].includes(e.type)));
mode = "hang";
{
  const before = upstreamClosed; const ac = new AbortController();
  const r = await fetch("http://127.0.0.1:5074/document/query", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer t" }, body: JSON.stringify({ question: "q", chatId: "c1" }), signal: ac.signal });
  const reader = r.body.getReader(); await reader.read();
  ac.abort(); await new Promise((r) => setTimeout(r, 700));
  check("when the browser leaves, the request to the RAG service is cancelled", upstreamClosed === before + 1);
}
mode = "ok";
console.log(fails ? `\nFAILED: ${fails}` : "\nALL PASSED"); process.exit(fails ? 1 : 0);
