// Run with: node --test "frontend/src/utils/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { pageLink, linkCitations, uniqueSources, ageLabel } from "./citations.js";

const fees = { documentId: "d1", documentName: "Fee Policy", displayPage: 2, fileUrl: "https://host/doc.pdf", type: "text" };
const hostel = { documentId: "d2", documentName: "Hostel Rules", displayPage: 5, fileUrl: "https://host/h.pdf", type: "text" };

test("a page link jumps to the cited page, and is null without a real http(s) address", () => {
  assert.equal(pageLink(fees), "https://host/doc.pdf#page=2");
  assert.equal(pageLink({ ...fees, fileUrl: "https://host/doc.pdf#page=9" }), "https://host/doc.pdf#page=2");
  assert.equal(pageLink({ ...fees, displayPage: null }), "https://host/doc.pdf");
  assert.equal(pageLink({ ...fees, fileUrl: "javascript:alert(1)" }), null);
  assert.equal(pageLink({ ...fees, fileUrl: undefined }), null);
  assert.equal(pageLink(null), null);
});

test("a citation that matches a source becomes a link to that page", () => {
  const out = linkCitations("The fee is Rs. 200 [Fee Policy, p. 2].", [fees, hostel]);
  assert.equal(out, "The fee is Rs. 200 [[Fee Policy, p. 2]](https://host/doc.pdf#page=2).");
});

test("matching ignores case and tolerates the version/date the prompt adds to the name", () => {
  assert.match(linkCitations("[fee policy, p. 2]", [fees]), /\(https:\/\/host\/doc\.pdf#page=2\)/);
  assert.match(linkCitations("[Fee Policy, version v2, effective 2025-01-01, p. 2]", [fees]), /#page=2\)/);
  assert.match(linkCitations("see [Hostel Rules, p. 5] and [Fee Policy, p. 2]", [fees, hostel]), /h\.pdf#page=5.*doc\.pdf#page=2/);
});

test("a link is never invented: wrong page, unknown document, or a different document with a similar start", () => {
  const same = (text) => assert.equal(linkCitations(text, [fees]), text);
  same("[Fee Policy, p. 3]");                    // right document, page not among the sources
  same("[Library Rules, p. 2]");                 // not a source at all
  same("[Fee Policy Appendix, p. 2]");           // starts with the name but is another document
  same("[Fee Policy] and p. 2 and (Fee Policy, p. 2)");   // not the citation format
});

test("no sources, no text, or a source without a usable address leaves the text alone", () => {
  assert.equal(linkCitations("[Fee Policy, p. 2]", []), "[Fee Policy, p. 2]");
  assert.equal(linkCitations("", [fees]), "");
  assert.equal(linkCitations(undefined, [fees]), "");
  assert.equal(linkCitations("[Fee Policy, p. 2]", [{ ...fees, fileUrl: null }]), "[Fee Policy, p. 2]");
});

test("parentheses in an address cannot break out of the link", () => {
  const out = linkCitations("[Fee Policy, p. 2]", [{ ...fees, fileUrl: "https://host/a(b).pdf" }]);
  assert.equal(out, "[[Fee Policy, p. 2]](https://host/a%28b%29.pdf#page=2)");
});

test("the same page retrieved twice is listed once", () => {
  const dup = { ...fees, excerpt: "again" };
  assert.deepEqual(uniqueSources([fees, hostel, dup, { ...fees, displayPage: 3 }]).map((s) => `${s.documentId}:${s.displayPage}`),
    ["d1:2", "d2:5", "d1:3"]);
  assert.deepEqual(uniqueSources(undefined), []);
});

test("age labels", () => {
  const now = 1_000_000_000_000;
  assert.equal(ageLabel(now - 5_000, now), "just now");
  assert.equal(ageLabel(now - 60_000, now), "1 minute ago");
  assert.equal(ageLabel(now - 5 * 60_000, now), "5 minutes ago");
  assert.equal(ageLabel(now - 3 * 3_600_000, now), "3 hours ago");
  assert.equal(ageLabel(now - 86_400_000, now), "1 day ago");
  assert.equal(ageLabel(now - 40 * 86_400_000, now), "40 days ago");
  assert.equal(ageLabel(null, now), null);
  assert.equal(ageLabel(now + 10_000, now), "just now");
});
