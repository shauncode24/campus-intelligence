// Run with: node --test frontend/src/utils
import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { fileKey, isPdf, validateSelection, sha256Hex, debounce, MAX_BYTES } from "./uploadFiles.js";

const f = (name, size = 1000, extra = {}) => ({
  name, size, type: "application/pdf", lastModified: 1, arrayBuffer: async () => new TextEncoder().encode("abc").buffer, ...extra,
});

test("two different files with the same name have different keys", () => {
  assert.notEqual(fileKey(f("fees.pdf", 1000)), fileKey(f("fees.pdf", 2000)));
  assert.notEqual(fileKey(f("fees.pdf", 1000, { lastModified: 1 })), fileKey(f("fees.pdf", 1000, { lastModified: 2 })));
  assert.equal(fileKey(f("fees.pdf")), fileKey(f("fees.pdf")));
});

test("only PDFs pass: by extension, and by type when there is one", () => {
  assert.ok(isPdf(f("a.pdf")));
  assert.ok(isPdf(f("A.PDF")));
  assert.ok(isPdf(f("a.pdf", 5, { type: "" })), "browsers sometimes report no type");
  assert.ok(!isPdf(f("a.docx", 5, { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" })));
  assert.ok(!isPdf(f("a.exe", 5, { type: "application/pdf" })), "a PDF type with another extension is refused");
  assert.ok(!isPdf(f("a.pdf", 5, { type: "text/html" })));
});

test("every rejected file says why, and the good ones are kept", () => {
  const existing = [f("old.pdf", 10)];
  const incoming = [f("ok.pdf"), f("notes.txt", 5, { type: "text/plain" }), f("empty.pdf", 0),
    f("huge.pdf", MAX_BYTES + 1), f("old.pdf", 10), f("ok.pdf")];
  const { accepted, rejected } = validateSelection(existing, incoming);
  assert.deepEqual(accepted.map((x) => x.name), ["ok.pdf"]);
  assert.deepEqual(rejected.map((r) => r.reason), [
    "Not a PDF file", "The file is empty", "Larger than 50 MB", "Already selected", "Already selected"]);
  assert.equal(accepted.length + rejected.length, incoming.length);
});

test("a same-named but different file is accepted, not silently dropped", () => {
  const { accepted, rejected } = validateSelection([f("fees.pdf", 100)], [f("fees.pdf", 200)]);
  assert.equal(accepted.length, 1);
  assert.equal(rejected.length, 0);
});

test("the batch is capped", () => {
  const existing = Array.from({ length: 18 }, (_, i) => f(`e${i}.pdf`));
  const { accepted, rejected } = validateSelection(existing, [f("a.pdf"), f("b.pdf"), f("c.pdf")]);
  assert.equal(accepted.length, 2);
  assert.equal(rejected[0].reason, "Only 20 files at a time");
});

test("sha256Hex matches the known digest, and is null when the browser has no crypto", async () => {
  assert.equal(await sha256Hex(f("a.pdf"), webcrypto.subtle),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(await sha256Hex(f("a.pdf"), null), null);
});

test("debounce runs once after the quiet period and can be cancelled", async () => {
  const calls = [];
  const d = debounce((v) => calls.push(v), 20);
  d(1); d(2); d(3);
  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(calls, [3]);
  d(4); d.cancel();
  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(calls, [3]);
});
