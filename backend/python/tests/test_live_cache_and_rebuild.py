"""
P1-3: per-question database reads stay constant as documents grow, and a corpus change no longer
makes the next student wait for a full index rebuild.
"""
import _env  # noqa: F401  (must be first)

import threading
import unittest
from datetime import date

from database.corpus_epoch import bump_epoch, get_epoch
from fake_firestore import FakeQuery
from services.retrieval_service import retrieval_service
from services.vector_index import vector_index
from test_vector_index import IndexCase, quiet  # noqa: E402


class TestLiveSetIsKept(IndexCase):
    def setUp(self):
        super().setUp()
        self.doc_reads = 0
        test, previous = self, FakeQuery.stream      # IndexCase's chunk counter; wrap it

        def counting(q):
            rows = previous(q)
            if getattr(q.collection, "name", None) == "documents":
                test.doc_reads += len(rows)
            return rows
        FakeQuery.stream = counting
        self.addCleanup(setattr, FakeQuery, "stream", previous)

    def test_document_reads_per_question_do_not_grow_with_the_number_of_documents(self):
        for n in (3, 60):
            for i in range(n):
                self.add_doc(f"doc{n}_{i}", 2)
            vector_index.invalidate()
            retrieval_service._live_cache = None
            self.ask()                                   # builds the index and the live set
            before = self.doc_reads
            for _ in range(5):
                self.ask()
            self.assertEqual(self.doc_reads - before, 0, f"{n} documents: no document reads once the set is kept")

    def test_a_corpus_change_refreshes_the_live_set(self):
        self.add_doc("a", 5)
        self.add_doc("b", 5)
        docs, _ = self.ask()
        self.assertEqual({d.metadata["documentId"] for d in docs}, {"a", "b"})
        self.db.collection("documents").document("a").update({"status": "Deleting"})
        bump_epoch(self.db)                              # what the delete route does
        vector_index.wait_for_background()
        fresh, _ = self.ask()
        self.assertTrue(fresh and all(d.metadata["documentId"] == "b" for d in fresh))

    def test_the_kept_set_still_notices_an_expiry_date_passing(self):
        self.add_doc("a", 5, expiryDate="2999-01-01")
        self.ask()
        ids_today = retrieval_service.live_document_ids(self.db, epoch=0, today=date(2999, 1, 1))
        ids_later = retrieval_service.live_document_ids(self.db, epoch=0, today=date(2999, 1, 2))
        self.assertEqual((ids_today, ids_later), ({"a"}, set()))


class TestBackgroundRebuild(IndexCase):
    def hold_builds(self):
        gate, original = threading.Event(), vector_index._build
        builds = []

        def slow_build(*a, **k):
            builds.append(1)
            gate.wait(10)
            return original(*a, **k)
        vector_index._build = slow_build
        self.addCleanup(setattr, vector_index, "_build", original)
        return gate, builds

    def test_after_a_corpus_change_questions_keep_working_while_the_new_index_is_built(self):
        self.add_doc("a", 30)
        docs, _ = self.ask()
        self.assertTrue(docs and not any(d.metadata.get("staleIndex") for d in docs))
        reads = self.chunk_reads

        self.add_doc("b", 30)
        bump_epoch(self.db)
        gate, _ = self.hold_builds()

        docs, _ = self.ask()                               # must not wait for the rebuild
        self.assertTrue(docs, "answered from the previous index")
        self.assertTrue(all(d.metadata["documentId"] == "a" for d in docs), "the new document is not searchable yet")
        self.assertTrue(all(d.metadata.get("staleIndex") for d in docs), "and the answer is marked as not to be cached")
        gate.set()
        vector_index.wait_for_background()

        docs, _ = self.ask()
        self.assertEqual({d.metadata["documentId"] for d in docs}, {"a", "b"})
        self.assertFalse(any(d.metadata.get("staleIndex") for d in docs))
        self.assertEqual(self.chunk_reads - reads, 60, "one rebuild only, however many questions came meanwhile")

    def test_only_one_background_rebuild_runs_at_a_time(self):
        self.add_doc("a", 10)
        self.ask()
        bump_epoch(self.db)
        gate, builds = self.hold_builds()
        for _ in range(5):
            self.ask()
        gate.set()
        vector_index.wait_for_background()
        self.assertEqual(len(builds), 1)

    def test_the_first_build_and_a_rebuild_after_our_own_write_still_wait(self):
        self.add_doc("a", 10)
        docs, _ = self.ask()                               # nothing to serve yet: it has to build
        self.assertTrue(docs)
        self.add_doc("c", 10)
        bump_epoch(self.db)                                # what finishing a document does
        vector_index.invalidate()                          # this process just wrote chunks
        docs, _ = self.ask()
        self.assertEqual({d.metadata["documentId"] for d in docs}, {"a", "c"}, "fresh at once, no stale answer")
        self.assertFalse(any(d.metadata.get("staleIndex") for d in docs))

    def test_a_failed_background_rebuild_keeps_serving_the_old_index_and_tries_again(self):
        self.add_doc("a", 10)
        self.ask()
        bump_epoch(self.db)
        original, calls = vector_index._build, []

        def broken(*a, **k):
            calls.append(1)
            raise RuntimeError("firestore hiccup")
        vector_index._build = broken
        self.addCleanup(setattr, vector_index, "_build", original)
        docs, _ = self.ask()
        vector_index.wait_for_background()
        self.assertTrue(docs)
        vector_index._build = original
        self.ask()
        vector_index.wait_for_background()
        docs, _ = self.ask()
        self.assertFalse(any(d.metadata.get("staleIndex") for d in docs), "recovered on the next try")
        self.assertEqual(len(calls), 1)

    def test_refresh_after_ingestion_makes_the_new_index_current_immediately(self):
        self.add_doc("a", 10)
        self.ask()
        self.add_doc("b", 10)
        bump_epoch(self.db)
        quiet(vector_index.refresh, self.db, get_epoch(self.db))
        docs, _ = self.ask()
        self.assertEqual({d.metadata["documentId"] for d in docs}, {"a", "b"})
        self.assertFalse(any(d.metadata.get("staleIndex") for d in docs))


if __name__ == "__main__":
    unittest.main()
