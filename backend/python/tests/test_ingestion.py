"""
P1-6: ingestion as a background job, and a service that stays responsive while it runs.
Real FastAPI app, real job manager, real chunk storage, fake database; the PDF parsing and
download are replaced by controllable stand-ins (no Gemini calls, no network).
"""
import asyncio
import contextlib
import io
import threading
import time
import unittest

import numpy as np
from langchain_core.documents import Document

from test_followup_endpoint import FollowUpCase  # noqa: E402  (sets up the app)
import auth as authmod  # noqa: E402
from config import Config  # noqa: E402
from services import ingestion  # noqa: E402
from services.ingestion import fail_interrupted_jobs, ingestion_manager, INTERRUPTED_MESSAGE  # noqa: E402
from utils.file_security import DownloadFailed  # noqa: E402
import main  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

GOOD_URL = f"https://{Config.ALLOWED_FILE_HOSTS[0]}/storage/v1/object/public/documents/a.pdf"


def quiet(fn, *a, **k):
    with contextlib.redirect_stdout(io.StringIO()):
        return fn(*a, **k)


class IngestCase(FollowUpCase):
    def setUp(self):
        super().setUp()
        authmod.firebase_auth.verify_id_token = lambda t, *a, **k: {
            "uid": t, **({"admin": True} if t == "boss" else {})}
        self._saved_ing = (ingestion.pdf_processor.process_pdf, ingestion.download_pdf,
                           ingestion.PROGRESS_INTERVAL_SECONDS, Config.MAX_CONCURRENT_INGESTS)
        ingestion.PROGRESS_INTERVAL_SECONDS = 0           # write every progress call
        self.pages = 3
        self.seen = []            # what the job had written on the document at each page
        self.concurrent = 0
        self.max_concurrent = 0
        self.gate = None          # optional threading.Event the fake parser waits on
        self.hook = None          # optional callable(page) run inside the parser
        self.parse_error = None
        self.download_error = None

        async def fake_download(url):
            if self.download_error:
                raise self.download_error
            return b"%PDF-1.4 fake"

        def fake_process(pdf_bytes, doc_id, progress=None):
            self.concurrent += 1
            self.max_concurrent = max(self.max_concurrent, self.concurrent)
            try:
                if self.gate is not None:
                    self.gate.wait(10)
                if progress:
                    progress(0, self.pages)
                docs, vecs = [], []
                for page in range(self.pages):
                    if self.hook:
                        self.hook(page)
                    if self.parse_error:
                        raise self.parse_error
                    docs.append(Document(page_content=f"passage {page}", metadata={"page": page, "type": "text"}))
                    vecs.append(np.ones(384, dtype=float) / 384 ** 0.5)
                    if progress:
                        progress(page + 1, self.pages)
                    self.seen.append(dict(self.db.collection("documents").docs.get(doc_id, {}).get("processing") or {}))
                return docs, vecs
            finally:
                self.concurrent -= 1

        ingestion.pdf_processor.process_pdf = fake_process
        ingestion.download_pdf = fake_download
        self.http = TestClient(main.app)
        self.http.__enter__()                  # keep one event loop alive, so background jobs can run

    def tearDown(self):
        if self.gate:
            self.gate.set()
        self.http.__exit__(None, None, None)
        (ingestion.pdf_processor.process_pdf, ingestion.download_pdf,
         ingestion.PROGRESS_INTERVAL_SECONDS, Config.MAX_CONCURRENT_INGESTS) = self._saved_ing
        super().tearDown()

    def hdr(self, token="boss"):
        return {"Authorization": f"Bearer {token}"}

    def make_doc(self, status="Processing", url=GOOD_URL, **extra):
        ref = self.db.collection("documents").document()
        ref.set({"name": "Fee policy", "status": status, "fileUrl": url, **extra})
        return ref.id

    def process(self, doc_id, token="boss"):
        return quiet(self.http.post, "/process-document", json={"documentId": doc_id}, headers=self.hdr(token))

    def record(self, doc_id):
        return self.db.collection("documents").docs.get(doc_id)

    def wait_for(self, doc_id, until=lambda r: r and r.get("status") != "Processing", timeout=15):
        end = time.time() + timeout
        while time.time() < end:
            if until(self.record(doc_id)):
                return self.record(doc_id)
            time.sleep(0.02)
        self.fail(f"timed out; record is {self.record(doc_id)}")

    def chunks(self, doc_id):
        return [c for c in self.db.collection("chunks").docs.values() if c["documentId"] == doc_id]


class TestBackgroundJob(IngestCase):
    def test_the_request_returns_202_at_once_and_the_job_finishes_in_the_background(self):
        self.gate = threading.Event()                      # the parser is held up
        doc = self.make_doc()
        started = time.time()
        r = self.process(doc)
        self.assertEqual(r.status_code, 202, r.text)
        self.assertLess(time.time() - started, 2, "the request must not wait for the job")
        self.assertEqual(r.json()["status"], "Processing")
        self.assertEqual(self.record(doc)["status"], "Processing")
        self.assertEqual(self.chunks(doc), [])
        self.gate.set()                                    # let the job proceed
        record = self.wait_for(doc)
        self.assertEqual(record["status"], "Processed")
        self.assertEqual(record["chunksCount"], 3)
        self.assertEqual(len(self.chunks(doc)), 3)
        self.assertEqual(record["processing"]["stage"], "done")
        self.assertEqual(record["processing"]["percent"], 100)

    def test_progress_is_real_and_increases_with_the_pages_actually_read(self):
        doc = self.make_doc()
        self.process(doc)
        self.wait_for(doc)
        percents = [s["percent"] for s in self.seen]
        self.assertEqual(len(percents), 3)
        self.assertEqual(percents, sorted(percents))
        self.assertTrue(all(s["stage"] == "reading" for s in self.seen))
        self.assertEqual(self.seen[1]["message"], "Reading page 3 of 3")      # written when page 2 was done
        self.assertTrue(0 < percents[0] < percents[-1] <= 85)

    def test_a_previous_error_message_is_cleared_on_success(self):
        doc = self.make_doc(status="Error", errorMessage="old failure")
        self.process(doc)
        record = self.wait_for(doc)
        self.assertEqual(record["status"], "Processed")
        self.assertNotIn("errorMessage", record)

    def test_it_records_image_stats_for_the_admin(self):
        ingestion.pdf_processor.last_image_stats = {"found": 2, "captioned": 1}
        doc = self.make_doc()
        self.process(doc)
        self.assertEqual(self.wait_for(doc)["imageStats"], {"found": 2, "captioned": 1})


class TestResponsiveness(IngestCase):
    def test_other_requests_stay_fast_while_a_document_is_being_processed(self):
        """B1: parsing used to run on the event loop and froze /health and /query."""
        self.gate = threading.Event()
        doc = self.make_doc()
        original = ingestion.pdf_processor.process_pdf

        def blocking_parse(pdf_bytes, doc_id, progress=None):
            time.sleep(2.0)                                # a CPU-bound parser holding its thread
            return original(pdf_bytes, doc_id, progress)

        self.gate.set()
        ingestion.pdf_processor.process_pdf = blocking_parse
        self.process(doc)
        self.wait_for(doc, until=lambda r: (r.get("processing") or {}).get("stage") == "reading")

        started = time.time()
        health = quiet(self.http.get, "/health")
        health_time = time.time() - started
        self.assertEqual(health.status_code, 200)
        self.assertLess(health_time, 1.0, f"/health took {health_time:.2f}s while a job was parsing")

        started = time.time()
        answer = quiet(self.http.post, "/query", json={"question": "What is the late fee for tuition?"},
                       headers=self.hdr("tokA"))
        query_time = time.time() - started
        self.assertEqual(answer.status_code, 200, answer.text)
        self.assertLess(query_time, 1.5, f"/query took {query_time:.2f}s while a job was parsing")
        self.assertEqual(self.record(doc)["status"], "Processing", "the job was still running during those calls")
        self.wait_for(doc)

    def test_the_event_loop_itself_is_not_blocked_by_the_repositories(self):
        """A slow Firestore read must not stop other coroutines: it runs in a worker thread."""
        from database.chat_repository import chat_repository
        ref = self.db.collection("chats").document()
        ref.set({"userId": "A", "title": "x", "messageCount": 0})
        real_get = type(ref).get

        def slow_get(self_):
            time.sleep(0.5)
            return real_get(self_)

        type(ref).get = slow_get
        try:
            async def scenario():
                ticks = []

                async def ticker():
                    for _ in range(8):
                        await asyncio.sleep(0.05)
                        ticks.append(time.time())

                t0 = time.time()
                await asyncio.gather(chat_repository.user_owns_chat("A", ref.id), ticker())
                return ticks, t0
            ticks, t0 = quiet(asyncio.run, scenario())
        finally:
            type(ref).get = real_get
        # the ticker ran while the slow read was in flight (it would finish after it if blocked)
        self.assertGreaterEqual(sum(1 for t in ticks if t - t0 < 0.45), 5)


class TestOneAtATime(IngestCase):
    def test_documents_are_processed_one_at_a_time_and_the_second_waits_in_a_queue(self):
        self.gate = threading.Event()
        first, second = self.make_doc(), self.make_doc()
        self.assertEqual(self.process(first).status_code, 202)
        self.assertEqual(self.process(second).status_code, 202)
        self.wait_for(second, until=lambda r: (r.get("processing") or {}).get("stage") == "queued")
        self.assertEqual(self.chunks(second), [])
        self.gate.set()
        self.assertEqual(self.wait_for(first)["status"], "Processed")
        self.assertEqual(self.wait_for(second)["status"], "Processed")
        self.assertEqual(self.max_concurrent, 1)

    def test_the_same_document_cannot_be_started_twice(self):
        self.gate = threading.Event()
        doc = self.make_doc()
        self.assertEqual(self.process(doc).status_code, 202)
        self.assertEqual(self.process(doc).status_code, 409)
        self.gate.set()
        self.wait_for(doc)
        self.assertEqual(len(self.chunks(doc)), 3, "chunks were written once, not twice")


class TestFailures(IngestCase):
    def test_a_download_problem_ends_as_error_with_a_message_written_for_people(self):
        self.download_error = DownloadFailed("The file could not be downloaded (HTTP 404)")
        doc = self.make_doc()
        self.process(doc)
        record = self.wait_for(doc)
        self.assertEqual(record["status"], "Error")
        self.assertEqual(record["errorMessage"], "The file could not be downloaded (HTTP 404)")
        self.assertEqual(record["processing"]["stage"], "failed")

    def test_an_unexpected_failure_is_generic_and_does_not_leak_internals(self):
        self.parse_error = RuntimeError("secret internal path /srv/keys/service.json")
        doc = self.make_doc()
        self.process(doc)
        record = self.wait_for(doc)
        self.assertEqual(record["status"], "Error")
        self.assertIn("ref ", record["errorMessage"])
        self.assertNotIn("secret", record["errorMessage"])

    def test_a_failed_status_write_is_an_error_not_a_document_stuck_in_processing(self):
        """B2: update_document_status used to swallow its exception."""
        async def boom(doc_id, docs, **kwargs):
            raise RuntimeError("firestore unavailable")
        original = ingestion.storage_service.update_document_status
        ingestion.storage_service.update_document_status = boom
        try:
            doc = self.make_doc()
            self.process(doc)
            record = self.wait_for(doc)
        finally:
            ingestion.storage_service.update_document_status = original
        self.assertEqual(record["status"], "Error")

    def test_a_bad_address_or_missing_or_deleting_document_is_refused_before_any_job(self):
        bad = self.make_doc(url="https://evil.example.com/a.pdf")
        self.assertEqual(self.process(bad).status_code, 400)
        self.assertEqual(self.process("nope").status_code, 404)
        deleting = self.make_doc(status="Deleting")
        self.assertEqual(self.process(deleting).status_code, 409)
        self.assertFalse(ingestion_manager.is_active(bad))
        self.assertEqual(self.chunks(bad), [])

    def test_only_admins_can_start_jobs(self):
        doc = self.make_doc()
        self.assertEqual(self.process(doc, token="tokA").status_code, 403)
        self.assertEqual(quiet(self.http.post, "/process-document", json={"documentId": doc}).status_code, 401)
        self.assertEqual(self.record(doc)["status"], "Processing")
        self.assertEqual(self.chunks(doc), [])


class TestCancelAndDelete(IngestCase):
    def test_cancelling_stops_the_job_and_nothing_stays_searchable(self):
        doc = self.make_doc()
        self.hook = lambda page: self.db.collection("documents").docs[doc].update({"status": "Cancelled"}) if page == 1 else None
        self.process(doc)
        self.wait_for(doc, until=lambda r: r["status"] == "Cancelled" and not ingestion_manager.is_active(doc))
        time.sleep(0.2)
        record = self.record(doc)
        self.assertEqual(record["status"], "Cancelled", "a cancelled document must not be flipped to Processed")
        self.assertEqual(self.chunks(doc), [])

    def test_deleting_the_document_stops_the_job_without_resurrecting_it(self):
        doc = self.make_doc()
        self.hook = lambda page: self.db.collection("documents").docs.pop(doc, None) if page == 1 else None
        self.process(doc)
        end = time.time() + 10
        while time.time() < end and ingestion_manager.is_active(doc):
            time.sleep(0.02)
        self.assertIsNone(self.record(doc))
        self.assertEqual(self.chunks(doc), [])


class TestRestart(IngestCase):
    def test_documents_left_processing_by_a_dead_process_are_failed_at_start_up(self):
        stuck = self.make_doc(status="Processing")
        fine = self.make_doc(status="Processed")
        errored = self.make_doc(status="Error", errorMessage="earlier")
        self.assertEqual(quiet(fail_interrupted_jobs), 1)
        self.assertEqual(self.record(stuck)["status"], "Error")
        self.assertEqual(self.record(stuck)["errorMessage"], INTERRUPTED_MESSAGE)
        self.assertEqual(self.record(fine)["status"], "Processed")
        self.assertEqual(self.record(errored)["errorMessage"], "earlier")

    def test_the_sweep_runs_when_the_service_starts(self):
        stuck = self.make_doc(status="Processing")
        with quiet(lambda: TestClient(main.app).__enter__()) as _client:
            pass
        self.assertEqual(self.record(stuck)["status"], "Error")


if __name__ == "__main__":
    unittest.main()
