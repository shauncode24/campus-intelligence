"""
P1-7: versions, effective dates, expiry and metadata filters.

Unit tests for the validity rules, then the real retrieval (real embedding model), the real
/query endpoint and the real ingestion job against a fake database.
"""
import asyncio
import time
import unittest
from datetime import date

from langchain_core.documents import Document

from test_ingestion import IngestCase, GOOD_URL, quiet  # noqa: E402  (sets up the app)
from services import ingestion  # noqa: E402
from services.document_validity import (  # noqa: E402
    document_state, is_live, matches_filters, describe, parse_day,
    LIVE, SUPERSEDED, EXPIRED, UPCOMING, NOT_PROCESSED,
)
from services.embedding_service import embedding_service as es  # noqa: E402
from services.retrieval_service import retrieval_service  # noqa: E402
from database.storage_service import storage_service  # noqa: E402

TODAY = date(2025, 6, 15)


def rec(**kw):
    return {"status": "Processed", **kw}


class TestValidityRules(unittest.TestCase):
    def test_a_plain_processed_document_is_live(self):
        self.assertEqual(document_state(rec(), TODAY), LIVE)

    def test_only_processed_documents_can_be_live(self):
        for status in ("Processing", "Error", "Cancelled", "Deleting", None):
            self.assertEqual(document_state({"status": status}, TODAY), NOT_PROCESSED, status)

    def test_a_superseded_version_is_not_live(self):
        self.assertEqual(document_state(rec(supersededBy="v2doc"), TODAY), SUPERSEDED)

    def test_the_expiry_day_itself_still_counts_and_the_next_day_does_not(self):
        self.assertEqual(document_state(rec(expiryDate="2025-06-15"), TODAY), LIVE)
        self.assertEqual(document_state(rec(expiryDate="2025-06-14"), TODAY), EXPIRED)

    def test_a_document_is_not_in_force_before_its_effective_date(self):
        self.assertEqual(document_state(rec(effectiveDate="2025-06-15"), TODAY), LIVE)
        self.assertEqual(document_state(rec(effectiveDate="2025-06-16"), TODAY), UPCOMING)

    def test_unreadable_dates_are_ignored_not_fatal(self):
        self.assertEqual(document_state(rec(expiryDate="soon", effectiveDate="??"), TODAY), LIVE)
        self.assertIsNone(parse_day("31/12/2025"))
        self.assertEqual(parse_day("2025-06-15T10:00:00Z"), date(2025, 6, 15))

    def test_superseded_wins_over_dates(self):
        self.assertEqual(document_state(rec(supersededBy="x", expiryDate="2020-01-01"), TODAY), SUPERSEDED)

    def test_filters_match_exactly_and_empty_filters_match_everything(self):
        r = rec(department="Library", documentType="Policy")
        self.assertTrue(matches_filters(r, None))
        self.assertTrue(matches_filters(r, {"department": "Library"}))
        self.assertTrue(matches_filters(r, {"department": "Library", "documentType": "Policy"}))
        self.assertFalse(matches_filters(r, {"department": "Sports"}))
        self.assertFalse(matches_filters({}, {"department": "Library"}))

    def test_the_prompt_label_names_version_and_date(self):
        self.assertEqual(describe({"name": "Fee Policy", "version": "v2", "effectiveDate": "2025-01-01"}),
                         "Fee Policy, version v2, effective 2025-01-01")
        self.assertEqual(describe({"name": "Handbook"}), "Handbook")
        self.assertTrue(is_live(rec(), TODAY))


V1_TEXT = "The late fee for tuition is Rs. 100 per day."
V2_TEXT = "The late fee for tuition is Rs. 200 per day, up to Rs. 5,000 per semester."
QUESTION = "What is the late fee for tuition?"


class VersionCase(IngestCase):
    def setUp(self):
        super().setUp()
        from services.retrieval_service import retrieval_service as rs
        rs.retrieve_multimodal = self._saved[3]          # use the REAL retrieval, not the follow-up fake
        # these tests edit document records directly (no epoch bump), so read the live set fresh
        self.addCleanup(setattr, type(rs), "LIVE_SET_TTL_SECONDS", type(rs).LIVE_SET_TTL_SECONDS)
        type(rs).LIVE_SET_TTL_SECONDS = 0
        self.v1 = self.seed_document("Fee Policy", V1_TEXT, version="v1", effectiveDate="2024-01-01")

    def seed_document(self, name, text, **extra):
        ref = self.db.collection("documents").document()
        ref.set({"name": name, "status": "Processed", "fileUrl": GOOD_URL, "department": "Academics",
                 "documentType": "Policy", **extra})
        docs = [Document(page_content=text, metadata={"page": 0, "type": "text"})]
        vectors = es.embed_texts([text])
        quiet(asyncio.run, storage_service.store_chunks(ref.id, docs, vectors, embedding_model=es.model_id))
        return ref.id

    def ask(self, question=QUESTION, **extra):
        body = {"question": question, **extra}
        return quiet(self.http.post, "/query", json=body, headers=self.hdr("tokA"))

    def cited(self, response):
        return [s["documentId"] for s in response.json()["sources"]]

    def upload_v2(self, supersedes=None, text=V2_TEXT, fail=False):
        """Create a new version record and run the real ingestion job on it."""
        ref = self.db.collection("documents").document()
        record = {"name": "Fee Policy", "status": "Processing", "fileUrl": GOOD_URL, "version": "v2",
                  "effectiveDate": "2025-01-01", "department": "Academics", "documentType": "Policy"}
        if supersedes:
            record["supersedes"] = supersedes
        ref.set(record)
        vectors = es.embed_texts([text])

        def parse(pdf_bytes, doc_id, progress=None):
            if fail:
                raise RuntimeError("parser crashed")
            return [Document(page_content=text, metadata={"page": 0, "type": "text"})], vectors

        ingestion.pdf_processor.process_pdf = parse
        self.assertEqual(self.process(ref.id).status_code, 202)
        self.wait_for(ref.id)
        return ref.id


class TestSupersedeFlow(VersionCase):
    def test_the_old_version_keeps_answering_until_the_new_one_is_ready(self):
        self.gate = None
        v2 = self.db.collection("documents").document()
        v2.set({"name": "Fee Policy", "status": "Processing", "fileUrl": GOOD_URL, "supersedes": self.v1})
        # not processed yet -> only v1 can answer
        self.assertEqual(self.cited(self.ask()), [self.v1])
        self.assertNotIn("supersededBy", self.db.collection("documents").docs[self.v1])

    def test_after_v2_is_processed_answers_cite_v2_only(self):
        self.assertEqual(self.cited(self.ask()), [self.v1])
        v2 = self.upload_v2(supersedes=self.v1)
        self.assertEqual(self.record(v2)["status"], "Processed")
        self.assertEqual(self.record(self.v1)["supersededBy"], v2)
        self.assertEqual(self.record(self.v1)["status"], "Processed", "the old record is kept for the admin")
        answer = self.ask()
        self.assertEqual(set(self.cited(answer)), {v2})
        self.assertIn("Rs. 200", self.llm.last_user_text())
        self.assertNotIn("Rs. 100", self.llm.last_user_text(), "the old version's text never reaches the model")

    def test_a_failed_new_version_leaves_the_old_one_in_force(self):
        v2 = self.upload_v2(supersedes=self.v1, fail=True)
        self.assertEqual(self.record(v2)["status"], "Error")
        self.assertNotIn("supersededBy", self.record(self.v1))
        self.assertEqual(self.cited(self.ask()), [self.v1])

    def test_an_already_superseded_version_is_not_taken_over_by_another_upload(self):
        v2 = self.upload_v2(supersedes=self.v1)
        v3 = self.upload_v2(supersedes=self.v1)           # tries to replace v1 again
        self.assertEqual(self.record(self.v1)["supersededBy"], v2, "the first replacement stands")
        self.assertEqual(self.record(v3)["status"], "Processed")

    def test_a_document_cannot_supersede_itself(self):
        ref = self.db.collection("documents").document()
        ref.set({"name": "X", "status": "Processing", "fileUrl": GOOD_URL, "supersedes": ref.id})
        self.assertEqual(ingestion.IngestionManager._supersede_plan(ref.id, {"supersedes": ref.id}), [])
        self.assertNotIn("supersededBy", self.record(ref.id) or {})


class TestCacheStaysTruthful(VersionCase):
    def test_a_cached_answer_that_cites_a_replaced_version_is_not_served(self):
        first = self.ask()
        self.assertEqual(first.json()["cached"], False)
        self.assertEqual(self.ask().json()["cached"], True, "sanity: the cache works for a current document")
        v2 = self.upload_v2(supersedes=self.v1)
        calls = len(self.llm.calls)
        third = self.ask()
        self.assertFalse(third.json()["cached"])
        self.assertGreater(len(self.llm.calls), calls, "a fresh answer was generated")
        self.assertEqual(set(self.cited(third)), {v2})

    def test_a_cached_answer_is_dropped_when_its_document_expires(self):
        self.ask()
        self.db.collection("documents").docs[self.v1]["expiryDate"] = "2020-01-01"
        again = self.ask()
        self.assertFalse(again.json()["cached"])
        self.assertFalse(again.json()["answered"], "no live document left -> an honest 'not found'")


class TestValidityInRetrieval(VersionCase):
    def test_expired_and_not_yet_effective_documents_are_never_used(self):
        self.db.collection("documents").docs[self.v1]["expiryDate"] = "2020-12-31"
        self.assertFalse(self.ask().json()["answered"])
        self.db.collection("documents").docs[self.v1].pop("expiryDate")
        self.db.collection("documents").docs[self.v1]["effectiveDate"] = "2999-01-01"
        self.assertFalse(self.ask().json()["answered"])
        self.db.collection("documents").docs[self.v1]["effectiveDate"] = "2024-01-01"
        self.assertTrue(self.ask().json()["answered"])

    def test_the_prompt_tells_the_model_which_version_and_date_it_is_quoting(self):
        self.ask()
        text = self.llm.last_user_text()
        self.assertIn("Fee Policy, version v1, effective 2024-01-01", text)

    def test_sources_carry_version_and_date_for_the_ui(self):
        body = self.ask().json()
        self.assertEqual(body["sources"][0]["version"], "v1")
        self.assertEqual(body["metadata"]["sources"][0]["version"], "v1")
        self.assertEqual(body["metadata"]["sources"][0]["effectiveDate"], "2024-01-01")


class TestMetadataFilters(VersionCase):
    def setUp(self):
        super().setUp()
        self.lib = self.seed_document("Library Late Fees", "The library late fee for tuition books is Rs. 5 per day.",
                                      department="Library", documentType="Policy")

    def test_a_department_filter_only_searches_that_departments_documents(self):
        body = self.ask(department="Library").json()
        self.assertEqual(set(self.cited_ids(body)), {self.lib})
        body = self.ask(department="Academics").json()
        self.assertEqual(set(self.cited_ids(body)), {self.v1})

    def cited_ids(self, body):
        return [s["documentId"] for s in body["sources"]]

    def test_a_filter_that_matches_nothing_gives_an_honest_not_found(self):
        body = self.ask(department="Sports").json()
        self.assertFalse(body["answered"])
        self.assertEqual(body["sources"], [])

    def test_filtered_answers_are_never_cached_or_served_from_the_cache(self):
        self.ask(department="Library")
        self.assertEqual(len(self.db.collection("questions").docs), 0, "a narrowed answer must not enter the shared cache")
        self.ask()                                       # unfiltered: caches normally
        self.assertEqual(len(self.db.collection("questions").docs), 1)
        calls = len(self.llm.calls)
        self.ask(department="Library")                   # must not be answered from the unfiltered cache entry
        self.assertGreater(len(self.llm.calls), calls)

    def test_restricting_to_documentIds_is_not_cached_either(self):
        self.ask(documentIds=[self.v1])
        self.assertEqual(len(self.db.collection("questions").docs), 0)


if __name__ == "__main__":
    unittest.main()
