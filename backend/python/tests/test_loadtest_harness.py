"""
The load-test harness itself (AUDIT P2-6): the budget logic, and a tiny end-to-end run in a separate
process (it changes global settings, so it must not run inside the test process).
"""
import _env  # noqa: F401  (must be first)

import json
import os
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
LOADTESTS = os.path.join(ROOT, "loadtests")
sys.path.insert(0, LOADTESTS)
HAVE_LOADTESTS = os.path.exists(os.path.join(LOADTESTS, "run.py"))

if HAVE_LOADTESTS:
    from budgets import check_budgets, lookup


@unittest.skipUnless(HAVE_LOADTESTS, "loadtests/ is not part of the container image")
class TestBudgets(unittest.TestCase):
    REPORT = {"chunks": {"10000": {"latencyMs": {"p95": 120.0}, "chunkReadsPerQuestion": 0}}, "errors": 0}

    def test_lookup_follows_dotted_paths_and_returns_none_when_absent(self):
        self.assertEqual(lookup(self.REPORT, "chunks.10000.latencyMs.p95"), 120.0)
        self.assertIsNone(lookup(self.REPORT, "chunks.99.latencyMs.p95"))

    def test_max_and_min_rules(self):
        ok, _ = check_budgets(self.REPORT, {"chunks.10000.latencyMs.p95": {"max": 200}, "errors": {"max": 0}})
        self.assertTrue(ok)
        ok, lines = check_budgets(self.REPORT, {"chunks.10000.latencyMs.p95": {"max": 100}})
        self.assertFalse(ok)
        self.assertIn("FAIL", lines[0])
        ok, _ = check_budgets(self.REPORT, {"chunks.10000.latencyMs.p95": {"min": 500}})
        self.assertFalse(ok)

    def test_a_missing_value_fails_a_full_run_but_not_a_partial_one(self):
        budget = {"coldStart.firstRunSeconds": {"max": 60}}
        self.assertFalse(check_budgets(self.REPORT, budget, strict=True)[0])
        self.assertTrue(check_budgets(self.REPORT, budget, strict=False)[0])

    def test_comment_keys_are_ignored(self):
        self.assertTrue(check_budgets(self.REPORT, {"_note": "x", "errors": {"max": 0}})[0])

    def test_the_shipped_budgets_file_is_valid_json_with_known_shapes(self):
        with open(os.path.join(LOADTESTS, "budgets.json"), encoding="utf-8") as f:
            budgets = json.load(f)
        real = {k: v for k, v in budgets.items() if not k.startswith("_")}
        self.assertGreater(len(real), 8)
        for path, rule in real.items():
            self.assertTrue(set(rule) <= {"max", "min"} and rule, path)


@unittest.skipUnless(HAVE_LOADTESTS, "loadtests/ is not part of the container image")
class TestHarnessRuns(unittest.TestCase):
    def test_a_tiny_run_produces_a_report_with_the_expected_numbers(self):
        with tempfile.TemporaryDirectory() as out:
            p = subprocess.run([sys.executable, "-I", "-X", "utf8", os.path.join(LOADTESTS, "run.py"), "--quick", "--only", "chunks,concurrency",
                                "--out", out], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=900, cwd=ROOT,
                               env=dict(os.environ, PYTHONPATH=os.path.join(ROOT, "backend", "python"), PYTHONUTF8="1"))
            self.assertEqual(p.returncode, 0, p.stdout[-800:] + p.stderr[-1500:])
            (name,) = [n for n in os.listdir(out) if n.endswith("-quick.json")]
            with open(os.path.join(out, name), encoding="utf-8") as f:
                report = json.load(f)
        for n, v in report["chunks"].items():
            self.assertEqual(v["chunkReadsPerQuestion"], 0, "after the index is built no question reads chunks from Firestore")
            self.assertGreater(v["latencyMs"]["n"], 0)
        for users, v in report["concurrency"].items():
            self.assertEqual(v["distinct"]["errors"] + v["sameQuestion"]["errors"], 0)
            self.assertGreaterEqual(v["distinct"]["modelCalls"], int(users), "distinct questions each reach the model")


if __name__ == "__main__":
    unittest.main()
