// Lint gate that does not require fixing the whole backlog at once.
//
// `eslint .` currently reports errors that were there before CI existed. Failing on all of them
// would block every change; ignoring lint would let new problems in. This runs ESLint and fails if
// the number of errors for ANY rule is higher than the committed baseline (lint-baseline.json), or
// if a rule that is not in the baseline reports an error. Fixing things lowers the numbers; when
// it does, run with --update so the improvement is locked in and cannot silently regress.
//
//   node scripts/check-lint-baseline.mjs            check (what CI runs)
//   node scripts/check-lint-baseline.mjs --update   rewrite lint-baseline.json from the current state
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const baselinePath = join(here, "..", "lint-baseline.json");

/** ESLint JSON report -> { ruleId: errorCount } (errors only; warnings do not fail the gate) */
export function countErrors(report) {
  const counts = {};
  for (const file of report) {
    for (const m of file.messages) {
      if (m.severity === 2) {
        const rule = m.ruleId || "(parse error)";
        counts[rule] = (counts[rule] || 0) + 1;
      }
    }
  }
  return counts;
}

/** Returns { regressions: [...], improvements: [...] } comparing current counts to the baseline. */
export function compare(current, baseline) {
  const regressions = [];
  const improvements = [];
  for (const rule of new Set([...Object.keys(current), ...Object.keys(baseline)])) {
    const now = current[rule] || 0;
    const before = baseline[rule] || 0;
    if (now > before) regressions.push({ rule, before, now });
    else if (now < before) improvements.push({ rule, before, now });
  }
  return { regressions, improvements };
}

function main() {
  const run = spawnSync("npx eslint . -f json", {
    cwd: join(here, ".."), encoding: "utf8", shell: true, maxBuffer: 64 * 1024 * 1024,
  });
  let report;
  try {
    report = JSON.parse(run.stdout);
  } catch {
    console.error("ESLint did not produce a report:\n" + (run.stderr || run.stdout));
    process.exit(2);
  }
  const current = countErrors(report);

  if (process.argv.includes("--update")) {
    writeFileSync(baselinePath, JSON.stringify(current, Object.keys(current).sort(), 2) + "\n");
    console.log("lint-baseline.json updated:", current);
    return;
  }

  const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, "utf8")) : {};
  const { regressions, improvements } = compare(current, baseline);
  const total = Object.values(current).reduce((a, b) => a + b, 0);
  console.log(`ESLint: ${total} errors (baseline ${Object.values(baseline).reduce((a, b) => a + b, 0)})`);

  if (improvements.length) {
    console.log("Fewer errors than the baseline. Lock it in with: node scripts/check-lint-baseline.mjs --update");
    improvements.forEach((i) => console.log(`  ${i.rule}: ${i.before} -> ${i.now}`));
  }
  if (regressions.length) {
    console.error("New lint errors (more than the baseline allows):");
    regressions.forEach((r) => console.error(`  ${r.rule}: ${r.before} -> ${r.now}`));
    console.error("Run `npx eslint .` to see them. Fix them; do not raise the baseline.");
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
