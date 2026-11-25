"""
P1-12: re-processing a live document does not take it offline. It keeps answering from its
current version until the new one is ready; a failed or cancelled re-process leaves it intact.
"""
import _env  # noqa: F401  (must be first)

import threading
import unittest

import numpy as np
from langchain_core.documents import Document

from test_ingestion import IngestCase, GOOD_URL  # noqa: E402  (sets up the app)
from services import ingestion  # noqa: E402
from services.ingestion import fail_interrupted_jobs, INTERRUPTED_MESSAGE  # noqa: E402


def old_chunk(i):
    return {"documentId": "", "index": i, "type": "text", "content": f"OLD passage {i}", "embedding": [0.1] * 4,
            "embeddingModel": "m"}


class ReprocessCase(IngestCase):
    def live_doc(self):
        doc = self.make_doc(status="Processed", chunksCount=2)
        for i in range(2):
            self.db.collection("chunks").document(f"{doc}_{i}").set({**old_chunk(i), "documentId": doc})
        return doc

    def reprocess(self, doc, token="boss"):
        return self.http.post("/process-document", json={"documentId": doc, "reprocess": True}, headers=self.hdr(token))


class TestKeepsAnswering(ReprocessCase):
    def test_the_document_stays_processed_and_its_old_passages_stay_until_the_new_ones_are_ready(self):
        doc = self.live_doc()
        self.gate = threading.Event()                        # hold the parser: "the job is running"
        r = self.reprocess(doc)
        self.assertEqual(r.status_code, 202, r.text)
        rec = self.record(doc)
        self.assertEqual(rec["status"], "Processed")
        self.assertTrue(rec["reprocessing"])
        self.assertEqual({c["content"] for c in self.chunks(doc)}, {"OLD passage 0", "OLD passage 1"})
        self.gate.set()
        rec = self.wait_for(doc, until=lambda r: r and not r.get("reprocessing"))
        self.assertEqual(rec["status"], "Processed")
        self.assertEqual(rec["chunksCount"], 3)
        self.assertEqual(len(self.chunks(doc)), 3)
        self.assertTrue(all("passage" in c["content"] and "OLD" not in c["content"] for c in self.chunks(doc)))
        self.assertNotIn("reprocessError", rec)

    def test_a_failure_before_saving_keeps_the_old_version_and_tells_the_admin(self):
        doc = self.live_doc()
        self.parse_error = RuntimeError("parser exploded: /secret/path")
        self.assertEqual(self.reprocess(doc).status_code, 202)
        rec = self.wait_for(doc, until=lambda r: r and not r.get("reprocessing"))
        self.assertEqual(rec["status"], "Processed", "still live")
        self.assertIn("Processing failed", rec["reprocessError"])
        self.assertNotIn("secret", rec["reprocessError"])
        self.assertEqual({c["content"] for c in self.chunks(doc)}, {"OLD passage 0", "OLD passage 1"})

    def test_a_download_failure_also_keeps_it_live(self):
        from utils.file_security import DownloadFailed
        doc = self.live_doc()
        self.download_error = DownloadFailed("the file could not be downloaded")
        self.reprocess(doc)
        rec = self.wait_for(doc, until=lambda r: r and not r.get("reprocessing"))
        self.assertEqual(rec["status"], "Processed")
        self.assertIn("could not be downloaded", rec["reprocessError"])

    def test_a_scan_found_on_reprocess_keeps_the_old_text_version(self):
        doc = self.live_doc()
        # (IngestCase.tearDown puts the real parser back; nothing to restore here)
        ingestion.pdf_processor.process_pdf = lambda pdf, doc_id, progress=None: (
            [Document(page_content="[Image on page 1]", metadata={"type": "image", "page": 0})], [np.ones(4)])
        self.reprocess(doc)
        rec = self.wait_for(doc, until=lambda r: r and not r.get("reprocessing"))
        self.assertEqual(rec["status"], "Processed")
        self.assertIn("no readable text", rec["reprocessError"])
        self.assertEqual(len(self.chunks(doc)), 2)

    def test_cancelling_does_not_delete_the_live_passages(self):
        doc = self.live_doc()
        self.gate = threading.Event()
        self.reprocess(doc)
        # what the Node cancel route does for a live document being re-processed
        self.db.collection("documents").document(doc).update({"reprocessing": __import__("firebase_admin").firestore.DELETE_FIELD})
        self.gate.set()
        self.wait_for(doc, until=lambda r: r and not r.get("reprocessing") and not ingestion.ingestion_manager.is_active(doc))
        self.assertEqual(self.record(doc)["status"], "Processed")
        self.assertEqual({c["content"] for c in self.chunks(doc)}, {"OLD passage 0", "OLD passage 1"})

    def test_a_not_yet_live_document_is_processed_as_before(self):
        doc = self.make_doc(status="Error")
        r = self.reprocess(doc)
        self.assertEqual(r.status_code, 202)
        self.assertEqual(self.wait_for(doc)["status"], "Processed")

    def test_a_restart_clears_a_stuck_reprocess_flag_without_hiding_the_document(self):
        doc = self.make_doc(status="Processed", reprocessing=True)
        self.assertEqual(fail_interrupted_jobs(), 1)
        rec = self.record(doc)
        self.assertEqual(rec["status"], "Processed")
        self.assertNotIn("reprocessing", rec)
        self.assertEqual(rec["reprocessError"], INTERRUPTED_MESSAGE)


if __name__ == "__main__":
    unittest.main()
