"""The cache-threshold calibration arithmetic, checked by hand, and the labelled pair file."""
import json
import math
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import calibrate_cache as cc  # noqa: E402

PAIRS = os.path.join(os.path.dirname(__file__), "..", "examples", "synthetic_demo", "cache_pairs.jsonl")


def row(sim, same, guard=True):
    return {"similarity": sim, "same": same, "guard_ok": guard, "kind": "x", "a": "a", "b": "b"}


class TestArithmetic(unittest.TestCase):
    def test_wilson_upper_bound(self):
        self.assertAlmostEqual(cc.wilson_upper(0, 36), 0.0963, places=3)     # 0 false hits in 36 is NOT "0%"
        self.assertAlmostEqual(cc.wilson_upper(0, 0), 1.0)
        self.assertLess(cc.wilson_upper(1, 100), cc.wilson_upper(5, 100))

    def test_sweep_counts_hits_and_false_hits_with_and_without_the_guard(self):
        rows = [row(0.96, True), row(0.90, True), row(0.80, True, guard=False),
                row(0.93, False, guard=True), row(0.97, False, guard=False)]
        table, n_same, n_diff = cc.sweep(rows)
        self.assertEqual((n_same, n_diff), (3, 2))
        at = {r["threshold"]: r for r in table}
        self.assertAlmostEqual(at[0.90]["embedding_hit_rate"], 2 / 3)
        self.assertEqual(at[0.90]["embedding_false_hits"], 2)            # 0.93 and 0.97
        self.assertEqual(at[0.90]["production_false_hits"], 1)           # the 0.97 one is blocked by the guard
        self.assertEqual(at[0.94]["production_false_hits"], 0)           # 0.93 < 0.94
        self.assertAlmostEqual(at[0.94]["production_hit_rate"], 1 / 3)   # only the 0.96 pair still hits

    def test_recommendation_stays_above_the_worst_unblocked_false_hit(self):
        rows = [row(0.90, True), row(0.93, False, guard=True), row(0.99, False, guard=False)]
        rec, worst = cc.recommend(rows)
        self.assertEqual(worst, 0.93)                                    # the blocked 0.99 pair does not count
        self.assertEqual(rec, 0.95)
        self.assertEqual(cc.recommend([row(0.9, True)])[1], 0.0)


class TestPairFile(unittest.TestCase):
    def test_every_pair_is_well_formed_and_the_two_classes_are_balanced(self):
        with open(PAIRS, encoding="utf-8") as f:
            pairs = [json.loads(line) for line in f if line.strip()]
        self.assertGreaterEqual(len(pairs), 60)
        for p in pairs:
            self.assertIsInstance(p["same"], bool)
            self.assertTrue(p["a"].strip() and p["b"].strip() and p["kind"])
            self.assertNotEqual(p["a"], p["b"])
        same = sum(p["same"] for p in pairs)
        self.assertGreaterEqual(same, 30)
        self.assertGreaterEqual(len(pairs) - same, 30)
        self.assertEqual(len({(p["a"], p["b"]) for p in pairs}), len(pairs), "no duplicate pairs")


if __name__ == "__main__":
    unittest.main()
