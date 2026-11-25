import test from "node:test";
import assert from "node:assert/strict";
import { refFromMessage, withRef, freshRef } from "./errorRef.js";

test("reads the ref the server wrote into a message", () => {
  assert.equal(refFromMessage("Internal server error (ref cb11a96f)"), "cb11a96f");
  assert.equal(refFromMessage("Something went wrong. Please try again. (ref 0123456789abcdef)"), "0123456789abcdef");
  assert.equal(refFromMessage("no reference here"), null);
  assert.equal(refFromMessage(undefined), null);
  assert.equal(refFromMessage("(ref x)"), null, "too short to be one of ours");
});

test("adds a ref once, never twice, never an empty one", () => {
  assert.equal(withRef("Server error.", "abc12345"), "Server error. (ref abc12345)");
  assert.equal(withRef("Server error. (ref abc12345)", "zzz99999"), "Server error. (ref abc12345)");
  assert.equal(withRef("Server error.", null), "Server error.");
  assert.equal(withRef("Server error.", ""), "Server error.");
});

test("only a recent failure's ref is used", () => {
  const failure = { ref: "abc12345", at: 1000 };
  assert.equal(freshRef(failure, 1000 + 5000), "abc12345");
  assert.equal(freshRef(failure, 1000 + 20000), null);
  assert.equal(freshRef(null), null);
  assert.equal(freshRef({ ref: null, at: 1000 }, 1500), null, "a response without the header gives nothing");
});
