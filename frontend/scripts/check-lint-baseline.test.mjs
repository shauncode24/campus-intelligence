// Run with: node --test "frontend/scripts/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { countErrors, compare } from "./check-lint-baseline.mjs";

const report = [
  { messages: [{ severity: 2, ruleId: "no-unused-vars" }, { severity: 1, ruleId: "no-unused-vars" }, { severity: 2, ruleId: "no-undef" }] },
  { messages: [{ severity: 2, ruleId: "no-unused-vars" }, { severity: 2, ruleId: null }] },
];

test("only errors are counted, per rule, across files", () => {
  assert.deepEqual(countErrors(report), { "no-unused-vars": 2, "no-undef": 1, "(parse error)": 1 });
});

test("more errors than the baseline is a regression, including a brand-new rule", () => {
  const { regressions } = compare({ "no-unused-vars": 3, "no-undef": 1 }, { "no-unused-vars": 2 });
  assert.deepEqual(regressions.map((r) => r.rule).sort(), ["no-undef", "no-unused-vars"]);
});

test("equal or fewer is fine, and fewer is reported as an improvement", () => {
  const { regressions, improvements } = compare({ "no-unused-vars": 1 }, { "no-unused-vars": 2, "no-undef": 1 });
  assert.deepEqual(regressions, []);
  assert.deepEqual(improvements.map((i) => i.rule).sort(), ["no-undef", "no-unused-vars"]);
});
