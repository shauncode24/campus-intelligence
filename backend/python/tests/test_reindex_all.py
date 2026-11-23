"""Tests for scripts/reindex_all.py with the heavy parts (models, PDF, download) faked."""
import _env  # noqa: F401  (must be first)

import asyncio
import contextlib
import io
import types
import unittest

import numpy as np
from langchain_core.documents import Document

from database.firebase_client import firebase_client
from database.storage_service import storage_service
from fake_firestore import FakeDB
from scripts import reindex_all
from utils.file_security import DownloadFailed

MODEL = "test/model"
GOOD_URL = "https://qqdonjhgvuyjfusplexf.supabase.co/storage/v1/object/public/documents/x.pdf"


def fake_process_pdf(pdf_bytes, doc_id):
    docs = [Document(page_content=f"chunk {i}", metadata={"page": i, "type": "text", "documentId": doc_id,
                                                          "embedding_model": MODEL}) for i in range(3)]
    return docs, [np.ones(4, dtype=np.float32) / 2 for _ in docs]


async def fake_download(url):
    if "fail" in url:
        raise DownloadFailed("storage is down")
    return b"%PDF-1.4"


class TestReindexAll(unittest.TestCase):
    def setUp(self):
        self.db = FakeDB()
        self._saved_db = firebase_client._db
        firebase_client._db = self.db

        docs = self.db.collection("documents").docs
        docs["a"] = {"name": "A", "status": "Processed", "fileUrl": GOOD_URL}
        docs["b"] = {"name": "B", "status": "Error", "fileUrl": GOOD_URL}
        docs["c"] = {"name": "C", "status": "Deleting", "fileUrl": GOOD_URL}
        docs["d"] = {"name": "D", "status": "Cancelled", "fileUrl": GOOD_URL}
        docs["e"] = {"name": "E", "status": "Processed"}                       # no file URL
        docs["f"] = {"name": "F", "status": "Processed", "fileUrl": GOOD_URL + "?fail"}

        chunks = self.db.collection("chunks").docs
        for i in range(4):   # old CLIP chunks of document a (random ids, untagged)
            chunks[f"legacyRANDOM{i}"] = {"documentId": "a", "content": "old", "embedding": [0.1] * 512}
        chunks["other_doc"] = {"documentId": "zzz", "content": "keep me", "embedding": [0.1] * 4, "embeddingModel": MODEL}

        q = self.db.collection("questions").docs
        q["q_untagged"] = {"question": "old", "embedding": [0.1] * 512}
        q["q_other"] = {"question": "x", "embedding": [0.1] * 8, "embeddingModel": "someone/else"}
        q["q_current"] = {"question": "y", "embedding": [0.1] * 4, "embeddingModel": MODEL}

        self.runtime = (
            firebase_client,
            storage_service,
            types.SimpleNamespace(model_id=MODEL, dimension=4),
            types.SimpleNamespace(process_pdf=fake_process_pdf),
            fake_download,
        )

    def tearDown(self):
        firebase_client._db = self._saved_db

    def run_reindex(self, **kwargs):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            result = asyncio.run(reindex_all.reindex(runtime=self.runtime, **kwargs))
        return result, buf.getvalue()

    def status(self, doc_id):
        return self.db.collection("documents").docs[doc_id]["status"]

    def test_reprocesses_eligible_documents_and_skips_the_rest(self):
        result, log = self.run_reindex()
        self.assertEqual((result["ok"], result["failed"], result["skipped"]), (2, 1, 3))
        self.assertEqual((self.status("a"), self.status("b")), ("Processed", "Processed"))
        # skipped documents are untouched
        self.assertEqual((self.status("c"), self.status("d"), self.status("e")), ("Deleting", "Cancelled", "Processed"))

    def test_old_chunks_are_replaced_and_other_documents_are_untouched(self):
        self.run_reindex()
        chunks = self.db.collection("chunks").docs
        self.assertFalse(any(k.startswith("legacyRANDOM") for k in chunks))
        self.assertEqual({k for k, v in chunks.items() if v["documentId"] == "a"}, {"a_0", "a_1", "a_2"})
        self.assertEqual({v["embeddingModel"] for k, v in chunks.items() if v["documentId"] == "a"}, {MODEL})
        self.assertIn("other_doc", chunks)

    def test_one_failing_document_does_not_stop_the_rest(self):
        result, log = self.run_reindex()
        self.assertEqual(self.status("f"), "Error")
        doc = self.db.collection("documents").docs["f"]
        self.assertIn("DownloadFailed", doc["errorMessage"])
        self.assertIn("storage is down", doc["errorMessage"])
        self.assertEqual(self.status("a"), "Processed")     # processed before AND after the failure (sorted by name)
        self.assertEqual(result["failed"], 1)

    def test_cached_answers_from_other_models_are_deleted(self):
        result, _ = self.run_reindex()
        questions = self.db.collection("questions").docs
        self.assertEqual(set(questions), {"q_current"})
        self.assertEqual(result["cache_removed"], 2)

    def test_dry_run_changes_nothing(self):
        before = {n: dict(c.docs) for n, c in self.db.collections.items()}
        result, log = self.run_reindex(dry_run=True)
        after = {n: dict(c.docs) for n, c in self.db.collections.items()}
        self.assertEqual(before, after)
        self.assertIn("would  re-process A", log)
        self.assertIn("would delete 2 cached answers", log)

    def test_only_processes_the_requested_document(self):
        result, _ = self.run_reindex(only="b")
        self.assertEqual(result["ok"], 1)
        self.assertEqual(self.status("b"), "Processed")
        self.assertEqual(self.status("f"), "Processed")      # f untouched (still its original status)
        self.assertIn("legacyRANDOM0", self.db.collection("chunks").docs)   # a's old chunks untouched

    def test_documents_are_hidden_from_answers_while_they_are_being_processed(self):
        seen = {}

        def spying_process(pdf_bytes, doc_id):
            seen[doc_id] = self.db.collection("documents").docs[doc_id]["status"]
            return fake_process_pdf(pdf_bytes, doc_id)

        self.runtime = self.runtime[:3] + (types.SimpleNamespace(process_pdf=spying_process),) + self.runtime[4:]
        self.run_reindex()
        self.assertEqual(seen["a"], "Processing")     # retrieval ignores anything not "Processed"

    def test_command_line_help_works_without_loading_models(self):
        # --help must not import torch / connect to Firebase
        import subprocess, sys, os
        here = os.path.dirname(os.path.abspath(reindex_all.__file__))
        out = subprocess.run([sys.executable, os.path.join(here, "reindex_all.py"), "--help"],
                             capture_output=True, text=True, env={**os.environ, "ENV_FILE": os.environ["ENV_FILE"]}, timeout=60)
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertIn("--dry-run", out.stdout)


if __name__ == "__main__":
    unittest.main()
