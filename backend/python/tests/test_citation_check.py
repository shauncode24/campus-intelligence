"""
P1-5: citations are checked against what the model was shown; invented ones are removed and the
sources listed are the ones actually cited.
"""
import _env  # noqa: F401  (must be first)

import json
import types
import unittest

from langchain_core.documents import Document

from test_followup_endpoint import FollowUpCase  # noqa: E402  (stubs the Gemini client first)
from utils.citation_check import check_citations  # noqa: E402

SOURCES = [
    {"documentName": "Fee Policy", "displayPage": 2, "chunkId": "a"},
    {"documentName": "Fee Policy", "displayPage": 5, "chunkId": "b"},
    {"documentName": "Hostel Rules", "displayPage": 1, "chunkId": "c"},
]


class TestChecker(unittest.TestCase):
    def test_valid_citations_are_kept_and_only_cited_sources_are_listed(self):
        r = check_citations("Late fee is Rs. 200 [Fee Policy, p. 2].", SOURCES)
        self.assertEqual((r.cited, r.removed, r.uncited, r.changed), (1, 0, False, False))
        self.assertEqual([s["chunkId"] for s in r.sources], ["a"])
        self.assertEqual(r.answer, "Late fee is Rs. 200 [Fee Policy, p. 2].")

    def test_a_citation_of_a_page_that_was_not_shown_is_removed(self):
        r = check_citations("Fee is Rs. 200 [Fee Policy, p. 2] and 5% interest [Fee Policy, p. 9].", SOURCES)
        self.assertEqual((r.cited, r.removed, r.changed), (1, 1, True))
        self.assertEqual(r.answer, "Fee is Rs. 200 [Fee Policy, p. 2] and 5% interest.")

    def test_a_citation_of_an_unknown_document_is_removed(self):
        r = check_citations("The curfew is 10 pm [Library Guide, p. 1].", SOURCES)
        self.assertEqual((r.cited, r.removed, r.uncited), (0, 1, True))
        self.assertEqual(r.answer, "The curfew is 10 pm.")
        self.assertEqual(len(r.sources), 3, "nothing checks out: all retrieved sources stay listed")

    def test_an_answer_without_any_citation_is_flagged_and_keeps_the_sources(self):
        r = check_citations("The curfew is 10 pm.", SOURCES)
        self.assertEqual((r.cited, r.removed, r.uncited, r.changed), (0, 0, True, False))
        self.assertEqual(len(r.sources), 3)

    def test_ranges_lists_and_the_source_prefix(self):
        for text in ("[Fee Policy, p. 2, 5]", "[Fee Policy, pp. 2 and 5]", "[Source: Fee Policy, p. 2]", "[fee policy , P. 2]",
                     "[Fee Policy, version v2, effective 2025-01-01, p. 2]"):
            with self.subTest(text=text):
                r = check_citations(f"Yes {text}.", SOURCES)
                self.assertEqual(r.removed, 0, text)
        r = check_citations("Yes [Fee Policy, pp. 2-5].", SOURCES)           # pages 3 and 4 were never shown
        self.assertEqual((r.removed, r.cited), (1, 0))

    def test_several_sources_cited(self):
        r = check_citations("A [Fee Policy, p. 5]. B [Hostel Rules, p. 1].", SOURCES)
        self.assertEqual(sorted(s["chunkId"] for s in r.sources), ["b", "c"])

    def test_nothing_to_check(self):
        self.assertEqual(check_citations("", SOURCES).answer, "")
        r = check_citations("Fine [X, p. 1].", [])
        self.assertEqual((r.answer, r.sources, r.changed), ("Fine [X, p. 1].", [], False))

    def test_square_brackets_that_are_not_citations_are_left_alone(self):
        text = "Use form [A] or [B, C] and see item [3]."
        self.assertEqual(check_citations(text, SOURCES).answer, text)


class TestThroughTheApi(FollowUpCase):
    def setUp(self):
        super().setUp()
        self.retrieval_docs = [
            Document(page_content="The late fee is Rs. 200 per day.", metadata={"page": 1, "type": "text", "documentId": "d1", "similarity": 0.9}),
            Document(page_content="Unrelated hostel text about curfew.", metadata={"page": 4, "type": "text", "documentId": "d1", "similarity": 0.8}),
        ]
        self.llm.invoke = lambda messages: types.SimpleNamespace(
            content="The late fee is Rs. 200 per day [Fees, p. 2]. The maximum is Rs. 5,000 [Fees, p. 9].")

    def test_the_answer_sources_and_cache_hold_only_what_checks_out(self):
        r = self.ask("What is the late fee for tuition?")
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertEqual(body["answer"], "The late fee is Rs. 200 per day [Fees, p. 2]. The maximum is Rs. 5,000.")
        self.assertEqual([s["displayPage"] for s in body["sources"]], [2], "only the cited page is listed")
        cached = list(self.db.collection("questions").docs.values())[0]
        self.assertNotIn("p. 9", cached["answer"])
        self.assertEqual(len(cached["sources"]), 1)
        saved = list(self.db.collection("user_questions").docs.values())[0]
        self.assertNotIn("p. 9", saved["answer"])

    def test_the_streamed_exchange_tells_the_browser_to_replace_what_it_showed(self):
        async def fake_stream(message):
            yield "The late fee is Rs. 200 per day [Fees, p. 2]. "
            yield "The maximum is Rs. 5,000 [Fees, p. 9]."
        from services.llm_service import llm_service
        original = llm_service.stream_answer
        llm_service.stream_answer = fake_stream
        self.addCleanup(setattr, llm_service, "stream_answer", original)
        with self.client.stream("POST", "/query/stream", json={"question": "What is the late fee for tuition?"},
                                headers={"Authorization": "Bearer tokA"}) as r:
            events = [json.loads(line) for line in r.iter_lines() if line]
        meta = next(e for e in events if e["type"] == "metadata")["data"]
        self.assertEqual(meta["answerCorrected"], "The late fee is Rs. 200 per day [Fees, p. 2]. The maximum is Rs. 5,000.")
        self.assertEqual([s["displayPage"] for s in meta["sources"]], [2])

    def test_an_honest_answer_is_left_exactly_as_written_with_no_correction_field(self):
        self.llm.invoke = lambda messages: types.SimpleNamespace(content="The late fee is Rs. 200 per day [Fees, p. 2].")
        body = self.ask("What is the late fee for tuition?").json()
        self.assertEqual(body["answer"], "The late fee is Rs. 200 per day [Fees, p. 2].")
        self.assertNotIn("answerCorrected", body["metadata"])


if __name__ == "__main__":
    unittest.main()
