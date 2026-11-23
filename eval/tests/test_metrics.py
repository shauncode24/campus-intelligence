"""Metrics checked against values worked out by hand."""
import math
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import metrics as m  # noqa: E402

A, B, C, D, E = ("d", 1), ("d", 2), ("d", 3), ("d", 4), ("d", 5)


class TestRankingMetrics(unittest.TestCase):
    def test_hit_rate(self):
        self.assertEqual(m.hit_rate_at_k([E, D, A], {A}, 3), 1.0)
        self.assertEqual(m.hit_rate_at_k([E, D, A], {A}, 2), 0.0)  # gold is at rank 3

    def test_recall_counts_distinct_gold_pages(self):
        # gold {A, B}; top-3 = A, A, C -> only A found (a repeat is not a second page)
        self.assertEqual(m.recall_at_k([A, A, C], {A, B}, 3), 0.5)
        self.assertEqual(m.recall_at_k([A, B, C], {A, B}, 2), 1.0)
        self.assertEqual(m.recall_at_k([C, D, E], {A, B}, 3), 0.0)

    def test_recall_requires_gold(self):
        with self.assertRaises(ValueError):
            m.recall_at_k([A], set(), 1)

    def test_reciprocal_rank(self):
        self.assertEqual(m.reciprocal_rank([C, D, A], {A}), 1 / 3)
        self.assertEqual(m.reciprocal_rank([A, C], {A, C}), 1.0)
        self.assertEqual(m.reciprocal_rank([C, D, E], {A}), 0.0)
        self.assertEqual(m.reciprocal_rank([C, D, A], {A}, k=2), 0.0)  # outside top-k

    def test_ndcg_single_gold_page(self):
        self.assertAlmostEqual(m.ndcg_at_k([A, C, D], {A}, 3), 1.0)
        # gold at rank 3: DCG = 1/log2(4) = 0.5, ideal = 1/log2(2) = 1  -> 0.5
        self.assertAlmostEqual(m.ndcg_at_k([C, D, A], {A}, 3), 0.5)
        self.assertEqual(m.ndcg_at_k([C, D, E], {A}, 3), 0.0)

    def test_ndcg_two_gold_pages(self):
        # gold {A, B}; ranking A, C, B
        # DCG = 1/log2(2) + 1/log2(4) = 1.5 ; ideal = 1 + 1/log2(3)
        expected = 1.5 / (1 + 1 / math.log2(3))
        self.assertAlmostEqual(m.ndcg_at_k([A, C, B], {A, B}, 3), expected)

    def test_ndcg_does_not_double_credit_a_repeated_page(self):
        self.assertLess(m.ndcg_at_k([A, A, C], {A, B}, 3), m.ndcg_at_k([A, B, C], {A, B}, 3))
        self.assertAlmostEqual(m.ndcg_at_k([A, A, C], {A, B}, 3), 1 / (1 + 1 / math.log2(3)))

    def test_ndcg_ideal_is_capped_by_k(self):
        self.assertAlmostEqual(m.ndcg_at_k([A, B], {A, B, C}, 2), 1.0)


class TestStatistics(unittest.TestCase):
    def test_mean_and_percentile(self):
        self.assertEqual(m.mean([1, 2, 3, 4]), 2.5)
        self.assertEqual(m.percentile([1, 2, 3, 4, 5], 50), 3)
        self.assertEqual(m.percentile([10, 20], 50), 15)  # interpolated
        self.assertEqual(m.percentile([1, 2, 3, 4, 5], 100), 5)
        self.assertEqual(m.percentile([7], 95), 7)
        self.assertTrue(math.isnan(m.percentile([], 50)))

    def test_auc_known_values(self):
        self.assertEqual(m.auc([0.9, 0.8], [0.1, 0.2]), 1.0)   # perfect separation
        self.assertEqual(m.auc([0.1, 0.2], [0.9, 0.8]), 0.0)   # perfectly wrong
        self.assertEqual(m.auc([0.5], [0.5]), 0.5)             # tie counts half
        # pos {0.8, 0.4}, neg {0.6, 0.2}: 0.8>0.6 y, 0.8>0.2 y, 0.4>0.6 n, 0.4>0.2 y = 3/4
        self.assertEqual(m.auc([0.8, 0.4], [0.6, 0.2]), 0.75)
        self.assertTrue(math.isnan(m.auc([], [0.1])))

    def test_bootstrap_ci_is_deterministic_and_brackets_the_mean(self):
        values = [1, 0, 1, 1, 0, 1, 1, 1, 0, 1]
        lo, hi = m.bootstrap_ci(values)
        self.assertEqual((lo, hi), m.bootstrap_ci(values))
        self.assertLessEqual(lo, m.mean(values))
        self.assertGreaterEqual(hi, m.mean(values))
        self.assertGreater(hi - lo, 0)

    def test_bootstrap_ci_of_constant_values_is_degenerate(self):
        self.assertEqual(m.bootstrap_ci([1.0] * 10), (1.0, 1.0))

    def test_bootstrap_ci_is_wider_with_fewer_samples(self):
        few = m.bootstrap_ci([1, 0, 1, 0, 1])
        many = m.bootstrap_ci([1, 0, 1, 0, 1] * 20)
        self.assertGreater(few[1] - few[0], many[1] - many[0])


if __name__ == "__main__":
    unittest.main()
