// P0-1: uploads go through a one-time signed URL issued to admins only (no anonymous bucket writes).
process.env.PORT = "5076";
process.env.FIREBASE_PROJECT_ID = "demo-campus-intel";
process.env.PYTHON_RAG_URL = "http://127.0.0.1:5089";
process.env.IP_RATE_PER_MINUTE = "1000"; process.env.ADMIN_RATE_PER_MINUTE = "1000";
const KEY = "service-role-SECRET-key-123";
const HOST = "qqdonjhgvuyjfusplexf.supabase.co";

const realFetch = globalThis.fetch;
const supaCalls = [];
let supaMode = { status: 200 };
globalThis.fetch = async (url, opts) => {
  if (String(url).includes("supabase.co")) {
    supaCalls.push({ url: String(url), method: opts?.method, headers: opts?.headers });
    if (supaMode.throw) { const e = new Error("down"); e.name = "TypeError"; throw e; }
    const path = new URL(String(url)).pathname.split("/documents/")[1];
    return new Response(JSON.stringify(supaMode.body ?? { url: `/object/upload/sign/documents/${path}?token=TOK123` }), { status: supaMode.status });
  }
  return realFetch(url, opts);
};

const admin = (await import("firebase-admin")).default;
await import("../../config/firebaseAdmin.js");
admin.auth().verifyIdToken = async (t) => {
  if (t === "adminTok") return { uid: "boss", email: "boss@campus.edu", admin: true };
  if (t === "userTok") return { uid: "stud", email: "s@campus.edu" };
  const e = new Error("bad"); e.code = "auth/argument-error"; throw e;
};
await import("../../index.js");
await new Promise((r) => setTimeout(r, 1500));

let fails = 0;
const check = (n, ok) => { console.log((ok ? "PASS " : "FAIL ") + n); if (!ok) fails++; };
const call = (tok, body) => realFetch("http://127.0.0.1:5076/documents/upload-url", {
  method: "POST",
  headers: { "Content-Type": "application/json", ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
  body: JSON.stringify(body),
});

process.env.SUPABASE_SERVICE_ROLE_KEY = KEY;

let r = await call(null, { fileName: "a.pdf" });
check("no token -> 401, storage not called", r.status === 401 && supaCalls.length === 0);
r = await call("userTok", { fileName: "a.pdf" });
check("signed-in non-admin -> 403, storage not called", r.status === 403 && supaCalls.length === 0);

r = await call("adminTok", { fileName: "Fee Policy (2025).pdf" });
let j = await r.json();
check("admin gets a target", r.status === 200 && j.token === "TOK123" && typeof j.path === "string");
check("path is sanitised and unique", /^\d+_[0-9a-f]{12}_Fee_Policy_2025_.pdf$/.test(j.path));
check("public URL points at our bucket", j.fileUrl === `https://${HOST}/storage/v1/object/public/documents/${j.path}`);
check("service key sent only as a header to Supabase", supaCalls[0].headers.apikey === KEY && !JSON.stringify(j).includes(KEY));
check("signing endpoint + method", supaCalls[0].method === "POST" && supaCalls[0].url.startsWith(`https://${HOST}/storage/v1/object/upload/sign/documents/`));
check("overwrite not enabled (no x-upsert)", !("x-upsert" in supaCalls[0].headers));

const a = (await (await call("adminTok", { fileName: "same.pdf" })).json()).path;
const b = (await (await call("adminTok", { fileName: "same.pdf" })).json()).path;
check("same file name twice -> different paths", a !== b);

for (const bad of [undefined, "", "notes.txt", "../../x.exe", 42, "a".repeat(400) + ".pdf"]) {
  supaCalls.length = 0;
  r = await call("adminTok", { fileName: bad });
  check(`rejects fileName ${JSON.stringify(bad)?.slice(0, 20)}`, r.status === 400 && supaCalls.length === 0);
}
r = await call("adminTok", { fileName: "../../etc/x.pdf" });
j = await r.json();
check("path traversal in name is neutralised", r.status === 200 && !j.path.includes("/") && !j.path.includes(".."));

supaMode = { status: 500 };
r = await call("adminTok", { fileName: "a.pdf" });
check("storage error -> 502", r.status === 502);
supaMode = { throw: true };
r = await call("adminTok", { fileName: "a.pdf" });
check("storage unreachable -> 502", r.status === 502);
supaMode = { status: 200, body: {} };
r = await call("adminTok", { fileName: "a.pdf" });
check("storage returns no token -> 502", r.status === 502);

delete process.env.SUPABASE_SERVICE_ROLE_KEY;
supaMode = { status: 200 }; supaCalls.length = 0;
r = await call("adminTok", { fileName: "a.pdf" });
check("no service key -> 503, storage not called", r.status === 503 && supaCalls.length === 0);

console.log(fails ? `\nFAILED: ${fails}` : "\nALL PASSED"); process.exit(fails ? 1 : 0);
