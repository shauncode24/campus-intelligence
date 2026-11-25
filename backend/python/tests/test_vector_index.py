"""
The in-memory vector index (AUDIT P2-1): same answers as scanning Firestore, but Firestore chunk
reads per question ~0 instead of N, and still correct when documents change.
Synthetic vectors (no models needed).
"""
import _env  # noqa: F401  (must be first)

import contextlib
import io
import time
import unittest

import numpy as np

from config import Config
from database.corpus_epoch import bump_epoch
from database.firebase_client import firebase_client
from database.storage_service import storage_service
from fake_firestore import FakeDB, FakeQuery
from services.embedding_service import embedding_service as es
from services.retrieval_service import retrieval_service
from services.vector_index import vector_index

DIM = 16


def quiet(fn, *a, **kw):
    with contextlib.redirect_stdout(io.StringIO()):
        return fn(*a, **kw)


class IndexCase(unittest.TestCase):
    def setUp(self):
        self.db = FakeDB()
        self._saved = (firebase_client._db, Config.VECTOR_INDEX_ENABLED, Config.VECTOR_INDEX_MAX_CHUNKS)
        firebase_client._db = self.db
        Config.VECTOR_INDEX_ENABLED, Config.VECTOR_INDEX_MAX_CHUNKS = True, 0
        vector_index.invalidate()
        retrieval_service._live_cache = None
        retrieval_service._warned_cap = False
        self.rng = np.random.default_rng(7)
        self.chunk_reads = 0
        self._stream = FakeQuery.stream
        test = self

        def counting(q):
            rows = test._stream(q)
            if getattr(q.collection, "name", None) == "chunks":
                test.chunk_reads += len(rows)
            return rows
        FakeQuery.stream = counting

    def tearDown(self):
        FakeQuery.stream = self._stream
        firebase_client._db, Config.VECTOR_INDEX_ENABLED, Config.VECTOR_INDEX_MAX_CHUNKS = self._saved
        vector_index.invalidate()

    def add_doc(self, doc_id, n, status="Processed", model=None, **fields):
        self.db.collection("documents").document(doc_id).set({"status": status, "name": doc_id, **fields})
        for i in range(n):
            self.db.collection("chunks").document(f"{doc_id}_{i}").set({
                "documentId": doc_id, "type": "text", "content": f"{doc_id} passage {i}",
                "embedding": self.rng.normal(size=DIM).tolist(), "embeddingModel": model or es.model_id,
                "metadata": {"pageNumber": i % 3},
            })

    def ask(self, q=None, **kw):
        q = self.rng.normal(size=DIM) if q is None else q
        return quiet(retrieval_service.retrieve_multimodal, q, **kw), q

    @staticmethod
    def ids(docs):
        return [d.metadata["chunkId"] for d in docs]


class TestSameAnswersAsScanning(IndexCase):
    def test_top_k_and_scores_match_the_old_full_scan(self):
        for d in ("a", "b", "c"):
            self.add_doc(d, 40)
        self.add_doc("hidden", 20, status="Processing")
        self.add_doc("old", 20, supersededBy="a")
        for _ in range(5):
            q = self.rng.normal(size=DIM)
            Config.VECTOR_INDEX_ENABLED = True
            fast, _ = self.ask(q)
            Config.VECTOR_INDEX_ENABLED = False
            slow, _ = self.ask(q)
            self.assertEqual(self.ids(fast), self.ids(slow))
            for f, s in zip(fast, slow):
                self.assertAlmostEqual(f.metadata["similarity"], s.metadata["similarity"], places=5)
                self.assertEqual(f.page_content, s.page_content)
                self.assertEqual(f.metadata["page"], s.metadata["page"])

    def test_document_id_filter_and_metadata_filter(self):
        self.add_doc("a", 30, department="Library")
        self.add_doc("b", 30, department="Hostel")
        docs, _ = self.ask(filters={"department": "Hostel"})
        self.assertTrue(docs and all(d.metadata["documentId"] == "b" for d in docs))
        docs, _ = self.ask(document_ids=["a"])
        self.assertTrue(docs and all(d.metadata["documentId"] == "a" for d in docs))

    def test_chunks_from_another_embedding_model_are_ignored(self):
        self.add_doc("a", 10)
        self.add_doc("b", 10, model="someone/else")
        docs, _ = self.ask()
        self.assertTrue(all(d.metadata["documentId"] == "a" for d in docs))


class TestReadsAndInvalidation(IndexCase):
    def test_firestore_chunk_reads_do_not_grow_with_questions_or_corpus(self):
        self.add_doc("a", 200)
        self.ask()
        first = self.chunk_reads
        self.assertEqual(first, 200)                      # built once
        for _ in range(10):
            self.ask()
        self.assertEqual(self.chunk_reads, first, "later questions read no chunks from Firestore")

    def test_a_document_that_stops_being_live_is_excluded_without_a_rebuild(self):
        self.add_doc("a", 20)
        self.add_doc("b", 20)
        self.ask()
        reads = self.chunk_reads
        # (the live-document set is normally kept until the corpus epoch changes; here it is read fresh)
        cls = type(retrieval_service)
        self.addCleanup(setattr, cls, "LIVE_SET_TTL_SECONDS", cls.LIVE_SET_TTL_SECONDS)
        cls.LIVE_SET_TTL_SECONDS = 0
        self.db.collection("documents").document("a").update({"status": "Deleting"})
        docs, _ = self.ask()
        self.assertTrue(docs and all(d.metadata["documentId"] == "b" for d in docs))
        self.db.collection("documents").document("b").update({"expiryDate": "2000-01-01"})
        docs, _ = self.ask()
        self.assertEqual(docs, [])
        self.assertEqual(self.chunk_reads, reads)

    def test_a_new_corpus_epoch_rebuilds_so_new_chunks_are_found(self):
        self.add_doc("a", 10)
        self.ask()
        self.add_doc("new", 10)                           # e.g. another instance finished a document
        docs, _ = self.ask()
        self.assertTrue(all(d.metadata["documentId"] == "a" for d in docs), "still the old index: epoch unchanged")
        quiet(bump_epoch, self.db)                        # what ingestion does when a document becomes Processed
        seen = set()
        for _ in range(20):
            seen |= {d.metadata["documentId"] for d in self.ask()[0]}
        self.assertIn("new", seen)

    def test_this_process_writing_chunks_drops_its_index_immediately(self):
        self.add_doc("a", 5)
        self.ask()
        self.assertEqual(vector_index.rebuilds >= 1, True)
        quiet(storage_service.delete_stale_chunks, "a", set())   # all of a's chunks gone
        docs, _ = self.ask()
        self.assertEqual(docs, [])


class TestSizeCapAndScale(IndexCase):
    def test_over_the_cap_it_falls_back_to_scanning_and_still_answers(self):
        self.add_doc("a", 30)
        Config.VECTOR_INDEX_MAX_CHUNKS = 10
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            docs = retrieval_service.retrieve_multimodal(self.rng.normal(size=DIM))
        self.assertEqual(len(docs), Config.TOP_K_RETRIEVAL)
        self.assertIn("not indexed in memory", buf.getvalue())

    def test_query_time_stays_small_as_the_corpus_grows_tenfold(self):
        def timed(n):
            self.db = FakeDB()
            firebase_client._db = self.db
            vector_index.invalidate()
            self.add_doc("a", n)
            self.ask()                                    # builds
            t = time.perf_counter()
            for _ in range(20):
                self.ask()
            return (time.perf_counter() - t) / 20
        small, big = timed(500), timed(5000)
        print(f"\n  per question: {small * 1000:.2f} ms at 500 chunks, {big * 1000:.2f} ms at 5000")
        self.assertLess(big, 0.25)


if __name__ == "__main__":
    unittest.main()
