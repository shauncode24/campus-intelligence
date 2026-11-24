"""
Document ingestion as a background job.

Before: the browser's request stayed open for the whole job (download, parse, embed,
describe images, store), the work ran on the event loop and froze every other request
(`/query`, `/health`), and the progress bar was made up with timers.

Now: `/process-document` validates, marks the document "Processing" and returns 202
at once. The job runs here, in the background, one at a time, with the CPU-heavy part
in a worker thread. It writes real progress onto the document record
(`documents/{id}.processing = {stage, percent, message, ...}`), which the admin UI
polls. It always ends the document as "Processed" or "Error" (never stuck), and it
stops cleanly if an admin cancels or deletes the document meanwhile.

Single-instance assumption: the job list and the "one at a time" limit live in this
process, like the rate limits. On start-up, documents still marked "Processing" are
failed with a clear message, because the job that was working on them died with the
previous process.
"""
import asyncio
import hashlib
import time
import uuid

from firebase_admin import firestore

from config import Config
from database.firebase_client import firebase_client
from database.storage_service import storage_service
from services.embedding_service import embedding_service
from services.pdf_processor import pdf_processor
from utils.file_security import (
    DownloadFailed, FileTooLarge, InvalidPdf, UnsafeFileUrl, download_pdf,
)
from database.corpus_epoch import bump_epoch
from utils.observability import log_event
from utils.threads import run_blocking

# How often progress is written (and the document re-checked for cancellation)
PROGRESS_INTERVAL_SECONDS = 1.5

INTERRUPTED_MESSAGE = ("Processing was interrupted because the service restarted. "
                       "Please re-process this document.")


class NoReadableText(Exception):
    """The PDF has no text layer (typically a scan). Message is written for the admin."""


def low_text_warning(stats: dict):
    """
    Text for the admin when too few pages of a document have readable text (they are scans or
    pictures, which this service cannot read: there is no OCR), else None.
    """
    pages = int(stats.get("pages") or 0)
    with_text = int(stats.get("pagesWithText") or 0)
    if pages and with_text / pages < Config.MIN_TEXT_PAGE_FRACTION:
        return (f"Only {with_text} of {pages} pages have readable text. The other pages are probably "
                "scans or pictures, which cannot be searched: questions about them will get \"not found\". "
                "Upload a text version of the document if you have one.")
    return None


# Errors whose message was written for people (they were returned to the admin as
# 400/413/415/502 before). Anything else is logged and reported generically.
USER_FACING_ERRORS = (UnsafeFileUrl, FileTooLarge, InvalidPdf, DownloadFailed, NoReadableText)


class JobCancelled(Exception):
    """The document was cancelled or deleted while it was being processed."""


class _Progress:
    """Writes progress for one job. Its methods run in a worker thread (sync Firestore)."""

    def __init__(self, doc_id: str):
        self.doc_id = doc_id
        self.ref = firebase_client.db.collection("documents").document(doc_id)
        self.started = time.time()
        self._last_write = 0.0

    def check(self):
        """Raise JobCancelled unless the document is still being processed."""
        snap = self.ref.get()
        if not snap.exists or (snap.to_dict() or {}).get("status") != "Processing":
            raise JobCancelled()

    def stage(self, stage: str, percent: int, message: str, force: bool = True):
        now = time.monotonic()
        if not force and now - self._last_write < PROGRESS_INTERVAL_SECONDS:
            return
        self._last_write = now
        self.check()
        self.ref.update({"processing": {
            "stage": stage,
            "percent": int(percent),
            "message": message,
            "startedAtMs": int(self.started * 1000),
            "updatedAtMs": int(time.time() * 1000),
        }})

    def pages(self, done: int, total: int):
        """Callback for pdf_processor.process_pdf: pages 0..total map to 8%..85%."""
        percent = 8 + int(77 * done / max(total, 1))
        message = f"Reading page {done + 1} of {total}" if done < total else f"Read all {total} pages"
        self.stage("reading", percent, message, force=(done == 0 or done == total))


class IngestionManager:
    def __init__(self):
        self._active = set()
        self._tasks = set()
        self._sem = None
        self._sem_loop = None

    def is_active(self, doc_id: str) -> bool:
        return doc_id in self._active

    def _semaphore(self):
        loop = asyncio.get_running_loop()
        if self._sem is None or self._sem_loop is not loop:
            self._sem = asyncio.Semaphore(max(1, Config.MAX_CONCURRENT_INGESTS))
            self._sem_loop = loop
        return self._sem

    def start(self, doc_id: str) -> bool:
        """Queue a job. Returns False if this document already has one."""
        if doc_id in self._active:
            return False
        self._active.add(doc_id)
        task = asyncio.get_running_loop().create_task(self._run(doc_id))
        self._tasks.add(task)               # keep a reference so it is not garbage-collected
        task.add_done_callback(self._tasks.discard)
        return True

    async def wait_idle(self):
        """Wait for all queued/running jobs (used by tests and shutdown)."""
        while self._tasks:
            await asyncio.gather(*list(self._tasks), return_exceptions=True)

    async def _run(self, doc_id: str):
        ref = firebase_client.db.collection("documents").document(doc_id)
        progress = _Progress(doc_id)
        try:
            await run_blocking(progress.stage, "queued", 1, "Waiting for other documents to finish")
            async with self._semaphore():
                await run_blocking(progress.stage, "downloading", 3, "Downloading the file")
                record = await run_blocking(lambda: ref.get().to_dict() or {})
                pdf_bytes = await download_pdf(record.get("fileUrl"))
                content_sha256 = hashlib.sha256(pdf_bytes).hexdigest()   # lets the upload form spot the same file twice

                await run_blocking(progress.stage, "reading", 8, "Reading pages")
                all_docs, all_embeddings = await run_blocking(
                    pdf_processor.process_pdf, pdf_bytes, doc_id, progress.pages
                )
                image_stats = dict(getattr(pdf_processor, "last_image_stats", None) or {})
                text_stats = dict(getattr(pdf_processor, "last_text_stats", None) or {})
                if not any(d.metadata.get("type") == "text" and not d.metadata.get("caption") for d in all_docs):
                    raise NoReadableText(
                        "This PDF has no readable text (it looks like a scan or a set of pictures), so nothing "
                        "could be indexed. Upload a text version, or run it through OCR first."
                    )
                warning = low_text_warning(text_stats)

                await run_blocking(progress.stage, "storing", 88, f"Saving {len(all_docs)} passages")
                await storage_service.store_chunks(
                    doc_id, all_docs, all_embeddings, embedding_model=embedding_service.model_id
                )

                # The last look before the document becomes searchable
                await run_blocking(progress.check)
                # ONE atomic write: this document becomes Processed (with its final progress
                # and fingerprint) and, if it replaces an older version, that version is retired
                # in the same instant: never both current, never neither.
                retire = await run_blocking(self._supersede_plan, doc_id, record)
                await storage_service.update_document_status(
                    doc_id, all_docs,
                    extra={
                        "processing": {
                            "stage": "done", "percent": 100,
                            "message": f"Done: {len(all_docs)} passages",
                            "startedAtMs": int(progress.started * 1000),
                            "updatedAtMs": int(time.time() * 1000),
                        },
                        "imageStats": image_stats,
                        "textStats": text_stats,
                        # shown to the admin next to the document; cleared when a re-run is fine
                        "warning": warning if warning else firestore.DELETE_FIELD,
                        "contentSha256": content_sha256,
                        "errorMessage": firestore.DELETE_FIELD,
                    },
                    also=retire,
                )
                # The set of documents that can answer questions just changed: every cached
                # answer made before now is out of date.
                await run_blocking(bump_epoch, firebase_client.db)
                print(f"✅ Ingestion finished for {doc_id}: {len(all_docs)} chunks")
                log_event("ingest_done", documentId=doc_id, chunks=len(all_docs),
                          seconds=round(time.time() - progress.started, 1), images=image_stats)
        except JobCancelled:
            print(f"🚫 Ingestion of {doc_id} stopped: cancelled or deleted")
            try:      # whatever this run wrote must not stay searchable
                await run_blocking(storage_service.delete_stale_chunks, doc_id, set())
            except Exception as e:
                print(f"⚠️ Could not clean up chunks of {doc_id}: {e}")
        except Exception as e:
            await self._fail(ref, doc_id, e)
        finally:
            self._active.discard(doc_id)

    @staticmethod
    def _supersede_plan(doc_id: str, record: dict) -> list:
        """
        If this document was uploaded as the new version of another, the write that retires
        the old one: [(old_id, fields)] to be committed together with this document becoming
        Processed (never before: until then the old version keeps answering). The old record
        stays for the admin but is no longer used for answers. Empty if nothing to retire.
        """
        old_id = (record or {}).get("supersedes")
        if not old_id or old_id == doc_id:
            return []
        old = firebase_client.db.collection("documents").document(old_id).get()
        if not old.exists:
            return []
        if (old.to_dict() or {}).get("supersededBy") not in (None, "", doc_id):
            return []                   # already replaced by something else; leave that alone
        print(f"📚 {old_id} will be superseded by {doc_id}")
        return [(old_id, {"supersededBy": doc_id, "supersededAt": firestore.SERVER_TIMESTAMP})]

    async def _fail(self, ref, doc_id: str, error: Exception):
        if isinstance(error, USER_FACING_ERRORS):
            message = str(error)
            print(f"❌ Ingestion of {doc_id} failed: {message}")
        else:
            reference = uuid.uuid4().hex[:8]
            message = f"Processing failed (ref {reference}). See the service log for details."
            print(f"❌ [{reference}] Ingestion of {doc_id} failed: {type(error).__name__}: {error}")
            log_event("ingest_failed", documentId=doc_id, ref=reference, error=type(error).__name__)
        try:
            snap = await run_blocking(ref.get)
            if snap.exists and (snap.to_dict() or {}).get("status") == "Processing":
                await run_blocking(ref.update, {
                    "status": "Error",
                    "errorMessage": message,
                    "errorAt": firestore.SERVER_TIMESTAMP,
                    "processing": {"stage": "failed", "percent": 0, "message": message,
                                   "updatedAtMs": int(time.time() * 1000)},
                })
        except Exception as e:
            print(f"❌ Could not record the failure of {doc_id}: {e}")


def fail_interrupted_jobs() -> int:
    """
    At start-up: any document still "Processing" lost its job when the previous process
    ended. Mark it "Error" so it is visible and can be re-processed, instead of staying
    hidden from answers forever.
    """
    db = firebase_client.db
    if not db:
        return 0
    count = 0
    for snap in db.collection("documents").where("status", "==", "Processing").stream():
        snap.reference.update({
            "status": "Error",
            "errorMessage": INTERRUPTED_MESSAGE,
            "errorAt": firestore.SERVER_TIMESTAMP,
            "processing": {"stage": "failed", "percent": 0, "message": INTERRUPTED_MESSAGE,
                           "updatedAtMs": int(time.time() * 1000)},
        })
        count += 1
    if count:
        print(f"⚠️ {count} document(s) were left 'Processing' by a previous run and are now marked Error")
    return count


ingestion_manager = IngestionManager()
