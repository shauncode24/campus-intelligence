// Renders the real AnswerText component to HTML and checks what a user would get.
// Run with: node --test "frontend/src/components/*.test.mjs"  (npm test does)
// The component is bundled on the fly with esbuild (installed with Vite), so no extra tooling.
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
let render;
let renderSources;

before(async () => {
  const out = mkdtempSync(join(tmpdir(), "answer-text-"));
  const entry = join(out, "entry.jsx");
  writeFileSync(
    entry,
    `import { renderToStaticMarkup } from "react-dom/server";
     import AnswerText from ${JSON.stringify(join(here, "AnswerText.jsx").replace(/\\/g, "/"))};
     import SourcesList from ${JSON.stringify(join(here, "SourcesList.jsx").replace(/\\/g, "/"))};
     export const render = (text, sources) => renderToStaticMarkup(<AnswerText text={text} sources={sources} />);
     export const renderSources = (sources) => renderToStaticMarkup(<SourcesList sources={sources} />);`
  );
  const bundle = join(out, "bundle.mjs");
  await build({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "esm",
    jsx: "automatic",
    outfile: bundle,
    nodePaths: [join(here, "..", "..", "node_modules")],
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
    loader: { ".css": "empty" },
    logLevel: "silent",
  });
  ({ render, renderSources } = await import(pathToFileURL(bundle).href));
});

const sources = [{ documentId: "d1", documentName: "Fee Policy", displayPage: 2, fileUrl: "https://host/doc.pdf" }];

test("markdown becomes real formatting, not literal asterisks", () => {
  const html = render("The fee is **Rs. 200** per day:\n\n* late\n* very late\n\n1. first\n2. second", []);
  assert.match(html, /<strong>Rs\. 200<\/strong>/);
  assert.match(html, /<ul>\s*<li>late<\/li>\s*<li>very late<\/li>\s*<\/ul>/);
  assert.match(html, /<ol>/);
  assert.ok(!html.includes("**"));
});

test("a table is rendered inside a scrolling wrapper", () => {
  const html = render("| Year | Fee |\n|---|---|\n| FY | 100 |\n| SY | 200 |", []);
  assert.match(html, /<div class="answer-table-wrapper"><table>/);
  assert.match(html, /<th>Year<\/th>/);
  assert.match(html, /<td>200<\/td>/);
});

test("raw HTML in an answer is shown as text, never run", () => {
  const html = render('Hello <script>alert(1)</script> <img src=x onerror="alert(2)"> <b>bold?</b>', []);
  assert.ok(!html.includes("<script"));
  assert.ok(!html.includes("<img"));
  assert.ok(!/<b>/.test(html));
  assert.ok(html.includes("&lt;script&gt;"));
});

test("a dangerous link target is dropped", () => {
  const html = render("[click](javascript:alert(1)) and [data](data:text/html;base64,PHNjcmlwdD4=)", []);
  assert.ok(!/href="javascript:/i.test(html));
  assert.ok(!/href="data:/i.test(html));
});

test("a citation that matches a source links to the cited page and opens safely in a new tab", () => {
  const html = render("The fee is Rs. 200 [Fee Policy, p. 2].", sources);
  assert.match(html, /<a href="https:\/\/host\/doc\.pdf#page=2" target="_blank" rel="noopener noreferrer">\[Fee Policy, p\. 2\]<\/a>/);
});

test("a citation that does not match a source is left as plain text", () => {
  const html = render("See [Fee Policy, p. 7] and [Unknown Doc, p. 2].", sources);
  assert.ok(!html.includes("<a "));
  assert.match(html, /\[Fee Policy, p\. 7\]/);
});

test("partial markdown from a half-streamed answer does not break rendering", () => {
  for (const partial of ["The fee is **Rs. 2", "* one\n* tw", "| a | b |\n|---", "[Fee Policy, p.", "`code", ""]) {
    assert.doesNotThrow(() => render(partial, sources), JSON.stringify(partial));
  }
});

test("plain text answers keep their line breaks as paragraphs", () => {
  const html = render("First paragraph.\n\nSecond paragraph.", []);
  assert.match(html, /<p>First paragraph\.<\/p>\s*<p>Second paragraph\.<\/p>/);
});

const many = [
  { documentId: "d1", documentName: "Fee Policy", displayPage: 2, fileUrl: "https://host/fees.pdf", type: "text", excerpt: "Late fee is Rs. 200", version: "v2", effectiveDate: "2025-01-01" },
  { documentId: "d1", documentName: "Fee Policy", displayPage: 2, fileUrl: "https://host/fees.pdf", type: "text", excerpt: "same page again" },
  { documentId: "d2", documentName: "Hostel Rules", displayPage: 5, fileUrl: "https://host/hostel.pdf", type: "image", excerpt: "Curfew table" },
  { documentId: "d3", documentName: "Old Scan", displayPage: 1, fileUrl: null, type: "text", excerpt: "no file" },
];

test("sources: every distinct source is listed, not just the first, each with its own link to the page", () => {
  const html = renderSources(many);
  assert.match(html, /Sources \(3\)/);                                   // the duplicate page is listed once
  assert.match(html, /href="https:\/\/host\/fees\.pdf#page=2"[^>]*>Open page 2</);
  assert.match(html, /href="https:\/\/host\/hostel\.pdf#page=5"[^>]*>Open page 5</);
  assert.match(html, /Hostel Rules/);
  assert.match(html, /Old Scan/);
  assert.equal((html.match(/Open page/g) || []).length, 2, "a source without a file has no link");
});

test("sources: version, effective date and the figure badge are shown; no '.pdf' is pasted onto the title", () => {
  const html = renderSources(many);
  assert.match(html, /Version v2/);
  assert.match(html, /In effect from 2025-01-01/);
  assert.match(html, /Figure/);
  assert.ok(!html.includes("Fee Policy.pdf"));
});

test("sources: links open in a new tab safely, and nothing is rendered without sources", () => {
  assert.match(renderSources(many), /target="_blank" rel="noopener noreferrer"/);
  assert.equal(renderSources([]), "");
  assert.equal(renderSources(undefined), "");
});
