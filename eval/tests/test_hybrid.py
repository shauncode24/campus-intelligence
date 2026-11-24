"""Unit tests for the experimental hybrid pieces (no models needed)."""
import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
import retrievers as r  # noqa: E402


class TestRrf(unittest.TestCase):
    def test_an_item_ranked_well_by_both_lists_wins(self):
        self.assertEqual(r.rrf_fuse([[1, 2, 3], [3, 1, 4]])[:2], [1, 3])

    def test_an_item_only_one_list_has_is_still_included(self):
        self.assertIn(9, r.rrf_fuse([[1, 2], [9]]))

    def test_one_list_keeps_its_order_and_ties_are_deterministic(self):
        self.assertEqual(r.rrf_fuse([[5, 4, 3]]), [5, 4, 3])
        self.assertEqual(r.rrf_fuse([[1], [2]]), [1, 2])

    def test_empty(self):
        self.assertEqual(r.rrf_fuse([[], []]), [])


class TestBm25Index(unittest.TestCase):
    def test_a_rare_identifier_ranks_its_chunk_first(self):
        idx = r._Bm25Index(["the form is submitted to the office", "submit Form AR-3 with the certificate", "the office is open daily"])
        s = idx.scores("AR-3")
        self.assertEqual(max(range(3), key=lambda i: s[i]), 1)
        self.assertEqual(s[0], 0.0)

    def test_no_shared_words_scores_zero(self):
        idx = r._Bm25Index(["alpha beta", "gamma delta"])
        self.assertEqual(idx.scores("omega"), [0.0, 0.0])


if __name__ == "__main__":
    unittest.main()
