"""Answer-level scoring and the chunking experiment helpers, with fake retrievers/answerers (no models)."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import answer_eval as ae  # noqa: E402
import chunking  # noqa: E402

PAGES = [
    {"doc": "fees", "title": "Fee Policy", "page": 1, "text": "Late fee is Rs. 200 per day."},
    {"doc": "fees", "title": "Fee Policy", "page": 2, "text": "Refund is 90 percent before classes."},
    {"doc": "hostel", "title": "Hostel Rules", "page": 1, "text": "Curfew is 10 pm."},
]
TITLES = {"fees": "Fee Policy", "hostel": "Hostel Rules"}


def q(qid, answerable, **kw):
    base = {"id": qid, "question": f"question {qid}?", "type": "numeric" if answerable else "absent_in_domain",
            "answerable": answerable}
    if answerable:
        base.setdefault("gold", [{"doc": "fees", "page": 1}])
        base.setdefault("must_include", ["Rs. 200"])
    return {**base, **kw}


def hit(doc, page, score=0.9, text="x"):
    return {"doc": doc, "page": page, "score": score, "text": text}


class FakeRetriever:
    score_kind = "cosine"

    def __init__(self, table):
        self.table = table

    def search(self, question, k):
        return self.table.get(question, [])[:k]


class Scripted:
    def __init__(self, answers):
        self.answers, self.calls = answers, []

    def answer(self, question, hits, titles):
        self.calls.append(question)
        return self.answers[question]


class TestScoring(unittest.TestCase):
    def test_a_correct_cited_answer(self):
        row = ae.score_question(q("a", True), "Late fee is Rs. 200 per day [Fee Policy, p. 1].", [hit("fees", 1)], TITLES)
        self.assertEqual((row["correct"], row["cites_gold"], row["fabricated_citations"], row["uncited"]), (True, True, 0, False))

    def test_a_missing_fact_is_incorrect_even_if_cited(self):
        row = ae.score_question(q("a", True), "Late fees apply [Fee Policy, p. 1].", [hit("fees", 1)], TITLES)
        self.assertFalse(row["correct"])

    def test_right_fact_wrong_page_is_correct_but_does_not_cite_gold(self):
        row = ae.score_question(q("a", True), "Late fee is Rs. 200 per day [Fee Policy, p. 2].", [hit("fees", 1), hit("fees", 2)], TITLES)
        self.assertEqual((row["correct"], row["cites_gold"]), (True, False))

    def test_a_fabricated_citation_is_counted(self):
        row = ae.score_question(q("a", True), "Late fee is Rs. 200 per day [Fee Policy, p. 7].", [hit("fees", 1)], TITLES)
        self.assertEqual((row["fabricated_citations"], row["uncited"], row["cites_gold"]), (1, True, False))

    def test_a_refusal_of_an_answerable_question_is_a_false_refusal(self):
        for answer in ("NOT_FOUND", "`not_found`", None):
            row = ae.score_question(q("a", True), answer, [hit("fees", 1)], TITLES)
            self.assertEqual((row["correct"], row["false_refusal"], row["declined"]), (False, True, True))

    def test_refusing_an_unanswerable_question_is_correct_and_answering_is_a_hallucination(self):
        refused = ae.score_question(q("u", False), "NOT_FOUND", [hit("fees", 1)], TITLES)
        answered = ae.score_question(q("u", False), "The fee is Rs. 9 [Fee Policy, p. 1].", [hit("fees", 1)], TITLES)
        self.assertEqual((refused["correct"], refused["hallucinated"]), (True, False))
        self.assertEqual((answered["correct"], answered["hallucinated"]), (False, True))

    def test_matching_is_literal_but_ignores_case_quotes_and_spacing(self):
        row = ae.score_question(q("a", True, must_include=["Rs. 200 per day"]), "LATE FEE IS  rs. 200   per day.", [hit("fees", 1)], TITLES)
        self.assertTrue(row["correct"])


class TestEvaluation(unittest.TestCase):
    def test_the_floor_declines_without_calling_the_model_and_the_summary_adds_up(self):
        questions = [q("a", True), q("b", True, question="b?"), q("u", False, question="u?"), q("v", False, question="v?")]
        retriever = FakeRetriever({
            "question a?": [hit("fees", 1, 0.9)],
            "b?": [hit("fees", 1, 0.3)],                    # below the floor: declined, no model call
            "u?": [hit("hostel", 1, 0.9)],
            "v?": [hit("hostel", 1, 0.2)],                  # below the floor: correctly declined
        })
        answerer = Scripted({"question a?": "Late fee is Rs. 200 per day [Fee Policy, p. 1].", "u?": "NOT_FOUND"})
        result = ae.evaluate(PAGES, questions, retriever, answerer, min_score=0.5)
        self.assertEqual(sorted(answerer.calls), ["question a?", "u?"], "only questions with a relevant passage reach the model")
        s = result["summary"]
        self.assertEqual(s["answerable"]["correct"]["mean"], 0.5)
        self.assertEqual(s["answerable"]["false_refusal"]["mean"], 0.5)
        self.assertEqual(s["unanswerable"]["refused"]["mean"], 1.0)
        self.assertEqual(s["citations"]["answers"], 1)
        self.assertEqual(s["answerable"]["cites_gold_when_answered"]["mean"], 1.0)

    def test_the_extractive_baseline_quotes_and_cites_the_best_passage(self):
        answer = ae.ExtractiveAnswerer().answer("q", [hit("fees", 2, text="Refund is 90 percent.")], TITLES)
        self.assertEqual(answer, "Refund is 90 percent. [Fee Policy, p. 2]")


class TestGate(unittest.TestCase):
    def summary(self, correct=0.8, refused=0.9, gold=0.8, false_refusal=0.05, fabricated=0.0):
        stat = lambda v: {"mean": v}   # noqa: E731
        return {"answerable": {"correct": stat(correct), "false_refusal": stat(false_refusal), "cites_gold_when_answered": stat(gold)},
                "unanswerable": {"refused": stat(refused)}, "citations": {"with_fabricated": stat(fabricated)}}

    def test_a_small_wobble_passes_a_real_drop_fails(self):
        base = self.summary()
        self.assertTrue(ae.compare(base, self.summary(correct=0.77), 0.05)[0])
        self.assertFalse(ae.compare(base, self.summary(correct=0.70), 0.05)[0])
        self.assertFalse(ae.compare(base, self.summary(refused=0.80), 0.05)[0])
        self.assertFalse(ae.compare(base, self.summary(false_refusal=0.15), 0.05)[0], "more false refusals is worse")
        self.assertFalse(ae.compare(base, self.summary(fabricated=0.10), 0.05)[0], "more invented citations is worse")
        self.assertTrue(ae.compare(base, self.summary(correct=0.95, false_refusal=0.0), 0.05)[0], "getting better never fails")


class TestChunkingHelpers(unittest.TestCase):
    def test_repeated_headers_and_page_numbers_are_removed_but_content_stays(self):
        topics = ["tuition", "hostel", "library", "exams"]
        pages = [f"Example Institute - Fee Policy\nAbout {t} here\nPage {i}" for i, t in enumerate(topics, start=1)]
        cleaned = chunking.strip_repeated_lines(pages)
        for t, text in zip(topics, cleaned):
            self.assertEqual(text.strip(), f"About {t} here")

    def test_too_few_pages_are_left_alone(self):
        pages = ["Header\nA", "Header\nB"]
        self.assertEqual(chunking.strip_repeated_lines(pages), pages)

    def test_cross_page_passages_are_attributed_to_the_page_where_they_start(self):
        from langchain_text_splitters import RecursiveCharacterTextSplitter
        r = chunking.ChunkingRetriever.__new__(chunking.ChunkingRetriever)    # no embedding model needed
        r.size, r.overlap, r.title_prefix, r.cross_page, r.strip_headers = 300, 20, False, True, False
        r.splitter = RecursiveCharacterTextSplitter(chunk_size=300, chunk_overlap=20)
        doc_pages = [{"doc": "d", "page": 1, "text": "First page sentence one is here. " * 3},
                     {"doc": "d", "page": 2, "text": "Second page sentence two is there. " * 3}]
        pieces = r._pieces(doc_pages)
        spanning = [(page, t) for page, t in pieces if "First" in t and "Second" in t]
        self.assertTrue(spanning, "a passage spans the page break")
        self.assertEqual(spanning[0][0], 1, "...and is attributed to the page where it starts")


if __name__ == "__main__":
    unittest.main()
