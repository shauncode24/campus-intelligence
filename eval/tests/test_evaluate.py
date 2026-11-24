"""
The evaluation loop checked against rankings worked out by hand, using stub
retrievers (no models needed). Also covers the regression gate.
"""
import math
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import evaluate as ev  # noqa: E402

PAGES = [{"doc": "d", "title": "D", "page": p, "text": f"text {p}"} for p in range(1, 6)]


def q(qid, gold_pages, answerable=True, qtype="fact"):
    return {"id": qid, "question": f"question {qid}", "type": qtype if answerable else "out_of_scope",
            "answerable": answerable, "gold": [{"doc": "d", "page": p} for p in gold_pages],
            "must_include": ["x"] if answerable else []}


class ScriptedRetriever:
    """Returns a fixed ranking (list of (page, score)) per question text."""
    name = "scripted"
    score_kind = "cosine"

    def __init__(self, rankings):
        self.rankings = rankings

    def build(self, pages):
        self.built_with = len(pages)

    def search(self, question, k):
        return [{"doc": "d", "page": p, "score": s, "text": ""} for p, s in self.rankings[question][:k]]

    def describe(self):
        return {"retriever": "scripted", "chunk_size": 0, "chunk_overlap": 0, "num_chunks": 0}


def run(questions, rankings):
    r = ScriptedRetriever({f"question {k}": v for k, v in rankings.items()})
    return ev.evaluate(PAGES, questions, r), r


class TestEvaluate(unittest.TestCase):
    def test_perfect_and_worst_retrievers(self):
        qs = [q("a", [1]), q("b", [2])]
        res, _ = run(qs, {"a": [(1, .9), (3, .5)], "b": [(2, .9), (4, .5)]})
        self.assertEqual(res["retrieval"]["mrr"]["mean"], 1.0)
        self.assertEqual(res["retrieval"]["recall@1"]["mean"], 1.0)
        self.assertEqual(res["retrieval"]["ndcg@5"]["mean"], 1.0)
        res, _ = run(qs, {"a": [(3, .9), (4, .5)], "b": [(3, .9), (5, .5)]})
        self.assertEqual(res["retrieval"]["hit@10"]["mean"], 0.0)
        self.assertEqual(res["retrieval"]["mrr"]["mean"], 0.0)

    def test_hand_computed_aggregate(self):
        # q a: gold page 1 at rank 1 -> RR 1.0, hit@1 1
        # q b: gold page 2 at rank 3 -> RR 1/3, hit@1 0, hit@3 1, ndcg@3 = 0.5
        qs = [q("a", [1]), q("b", [2])]
        res, _ = run(qs, {"a": [(1, .9), (3, .5), (4, .4)], "b": [(3, .9), (4, .5), (2, .4)]})
        r = res["retrieval"]
        self.assertAlmostEqual(r["mrr"]["mean"], (1 + 1 / 3) / 2)
        self.assertAlmostEqual(r["hit@1"]["mean"], 0.5)
        self.assertAlmostEqual(r["hit@3"]["mean"], 1.0)
        self.assertAlmostEqual(r["ndcg@3"]["mean"], (1.0 + 0.5) / 2)

    def test_multi_page_gold_counts_recall_fractionally(self):
        qs = [q("m", [1, 2], qtype="multi_doc")]
        res, _ = run(qs, {"m": [(1, .9), (3, .8), (4, .7)]})
        self.assertAlmostEqual(res["retrieval"]["recall@3"]["mean"], 0.5)
        self.assertAlmostEqual(res["retrieval"]["hit@3"]["mean"], 1.0)

    def test_unanswerable_questions_are_excluded_from_retrieval_metrics(self):
        qs = [q("a", [1]), q("u", [], answerable=False)]
        res, _ = run(qs, {"a": [(1, .9)], "u": [(2, .4)]})
        self.assertEqual(res["counts"], {"answerable": 1, "unanswerable": 1})
        self.assertEqual(res["retrieval"]["mrr"]["mean"], 1.0)

    def test_failures_list_the_questions_missing_from_the_top_5(self):
        qs = [q("ok", [1]), q("bad", [5])]
        res, _ = run(qs, {"ok": [(1, .9)], "bad": [(2, .9), (3, .8), (4, .7), (1, .6), (3, .5), (5, .4)]})
        self.assertEqual([f["id"] for f in res["failures"]], ["bad"])
        self.assertEqual(res["failures"][0]["first_gold_rank"], 6)     # present, but below the production top-5
        self.assertEqual(res["failures"][0]["top_retrieved"][0][:2], ["d", 2])

    def test_by_type_breakdown(self):
        qs = [q("a", [1], qtype="numeric"), q("b", [2], qtype="numeric"), q("c", [3], qtype="deadline")]
        res, _ = run(qs, {"a": [(1, .9)], "b": [(4, .9)], "c": [(3, .9)]})
        self.assertEqual(res["by_type"]["numeric"]["n"], 2)
        self.assertEqual(res["by_type"]["numeric"]["hit@5"], 0.5)
        self.assertEqual(res["by_type"]["deadline"]["hit@5"], 1.0)

    def test_abstention_auc_and_threshold_sweep(self):
        qs = [q("a", [1]), q("b", [2]), q("u1", [], answerable=False), q("u2", [], answerable=False)]
        res, _ = run(qs, {"a": [(1, .80)], "b": [(2, .60)], "u1": [(3, .50)], "u2": [(3, .70)]})
        # answerable tops {.80,.60}, unanswerable {.50,.70}: pairs .8>.5 y, .8>.7 y, .6>.5 y, .6>.7 n = 3/4
        self.assertEqual(res["abstention"]["auc"], 0.75)
        sweep = {row["floor"]: row for row in res["abstention"]["sweep"]}
        self.assertEqual(sweep[0.65]["answerable_kept"], 0.5)           # keeps .80 only
        self.assertEqual(sweep[0.65]["unanswerable_refused"], 0.5)      # refuses .50 only
        self.assertEqual(sweep[0.50]["unanswerable_refused"], 0.0)

    def test_no_threshold_sweep_for_non_cosine_scores(self):
        qs = [q("a", [1]), q("u", [], answerable=False)]
        r = ScriptedRetriever({"question a": [(1, 12.0)], "question u": [(2, 3.0)]})
        r.score_kind = "other"
        res = ev.evaluate(PAGES, qs, r)
        self.assertEqual(res["abstention"]["sweep"], [])
        self.assertEqual(res["abstention"]["auc"], 1.0)     # AUC is scale-free, so it is still reported

    def test_retriever_is_built_once_with_the_whole_corpus(self):
        res, r = run([q("a", [1])], {"a": [(1, .9)]})
        self.assertEqual(r.built_with, 5)

    def test_confidence_intervals_bracket_the_mean(self):
        qs = [q(str(i), [1]) for i in range(10)]
        ranks = {str(i): ([(1, .9)] if i % 2 else [(3, .9)]) for i in range(10)}
        res, _ = run(qs, ranks)
        stat = res["retrieval"]["hit@5"]
        self.assertAlmostEqual(stat["mean"], 0.5)
        self.assertLessEqual(stat["ci95"][0], 0.5)
        self.assertGreaterEqual(stat["ci95"][1], 0.5)
        self.assertLess(stat["ci95"][0], stat["ci95"][1])


class TestFollowUpModes(unittest.TestCase):
    """A follow-up is only findable if it is rewritten; the three modes measure by how much."""

    FOLLOW_UP = {"id": "f", "question": "and the maximum?", "type": "follow_up", "answerable": True,
                 "gold": [{"doc": "d", "page": 3}], "must_include": ["x"],
                 "history": [{"role": "user", "text": "late fee?"}, {"role": "bot", "text": "Rs. 200 a day"}],
                 "standalone": "what is the maximum late fee in a semester?"}
    PLAIN = q("plain", [1])

    def retriever(self):
        # the vague text finds the wrong page; the standalone text finds the right one
        return ScriptedRetriever({
            "and the maximum?": [(5, .6), (4, .5), (3, .4)],
            "what is the maximum late fee in a semester?": [(3, .9), (5, .5)],
            "question plain": [(1, .9)],
        })

    def evaluate(self, mode, rewrite=None):
        return ev.evaluate(PAGES, [self.FOLLOW_UP, self.PLAIN], self.retriever(), followups=mode, rewrite=rewrite)

    def test_raw_searches_the_follow_up_exactly_as_typed(self):
        res = self.evaluate("raw")
        row = next(r for r in res["per_question"] if r["id"] == "f")
        self.assertEqual(row["searched"], "and the maximum?")
        self.assertEqual(res["by_type"]["follow_up"]["hit@5"], 1.0)       # found, but only at rank 3...
        self.assertAlmostEqual(res["by_type"]["follow_up"]["mrr"], 1 / 3)  # ...so MRR shows the damage

    def test_oracle_searches_the_ideal_rewrite(self):
        res = self.evaluate("oracle")
        row = next(r for r in res["per_question"] if r["id"] == "f")
        self.assertEqual(row["searched"], "what is the maximum late fee in a semester?")
        self.assertEqual(res["by_type"]["follow_up"]["mrr"], 1.0)

    def test_rewrite_mode_uses_the_supplied_function_with_the_history(self):
        seen = {}

        def rewrite(question, history):
            seen["args"] = (question, history)
            return "what is the maximum late fee in a semester?"
        res = self.evaluate("rewrite", rewrite)
        self.assertEqual(seen["args"][0], "and the maximum?")
        self.assertEqual(seen["args"][1][0]["text"], "late fee?")
        self.assertEqual(res["by_type"]["follow_up"]["mrr"], 1.0)

    def test_only_follow_ups_are_affected_by_the_mode(self):
        raw, oracle = self.evaluate("raw"), self.evaluate("oracle")
        plain = lambda res: next(r for r in res["per_question"] if r["id"] == "plain")["searched"]
        self.assertEqual(plain(raw), plain(oracle))

    def test_rewrite_mode_without_a_function_is_an_error_not_a_silent_fallback(self):
        with self.assertRaises(ValueError):
            self.evaluate("rewrite")

    def test_an_unknown_mode_is_an_error(self):
        with self.assertRaises(ValueError):
            self.evaluate("telepathy")


class TestRegressionGate(unittest.TestCase):
    @staticmethod
    def report(**values):
        base = {"recall@5": .9, "hit@5": .9, "ndcg@5": .8, "mrr": .7}
        base.update(values)
        return {"retrieval": {k: {"mean": v} for k, v in base.items()}}

    def test_identical_reports_pass(self):
        ok, lines = ev.compare(self.report(), self.report())
        self.assertTrue(ok)
        self.assertTrue(all("ok" in l for l in lines))

    def test_small_drops_within_tolerance_pass(self):
        ok, _ = ev.compare(self.report(), self.report(mrr=.66), max_drop=0.05)
        self.assertTrue(ok)

    def test_a_drop_beyond_tolerance_fails_and_names_the_metric(self):
        ok, lines = ev.compare(self.report(), self.report(**{"recall@5": .7}), max_drop=0.05)
        self.assertFalse(ok)
        self.assertTrue(any("recall@5" in l and "FAIL" in l for l in lines))

    def test_improvements_never_fail(self):
        ok, _ = ev.compare(self.report(), self.report(mrr=.99, **{"recall@5": 1.0}))
        self.assertTrue(ok)

    def test_a_missing_metric_fails_instead_of_passing_silently(self):
        broken = {"retrieval": {}}
        ok, lines = ev.compare(self.report(), broken)
        self.assertFalse(ok)


if __name__ == "__main__":
    unittest.main()
