"""
Re-process every document with the CURRENT embedding model.

Why: vectors from different embedding models cannot be compared. After changing
EMBEDDING_BACKEND (or upgrading the model), chunks indexed with the old model
are ignored by retrieval, so until a document is re-processed it cannot answer
questions. This script rebuilds them all.

For each document it: marks it "Processing" (so it is not used mid-update),
downloads the stored PDF (only from the allow-listed storage host), re-chunks
and re-embeds it (images are described by Gemini: ONE API call per meaningful
image, at most MAX_IMAGES_PER_DOCUMENT per document; set IMAGE_CAPTIONING=false
to skip that and use CLIP vectors instead), overwrites its chunks (stale ones are removed), and marks it
"Processed". A document that fails is marked "Error" with the reason and the
script carries on. Finally it deletes cached answers that were produced under
a different embedding model.

Run it from backend/python with the real credentials available (backend/.env,
or ENV_FILE pointing at your secrets file):

    python scripts/reindex_all.py --dry-run      # show what would happen
    python scripts/reindex_all.py                # do it
    python scripts/reindex_all.py --only <documentId>

Exit code is 1 if any document failed.
"""
import argparse
import asyncio
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from config import Config  # noqa: E402


def _load_runtime():
    """Import the heavy modules lazily so --help and tests stay fast."""
    from database.firebase_client import firebase_client
    from database.storage_service import storage_service
    from services.embedding_service import embedding_service
    from services.pdf_processor import pdf_processor
    from utils.file_security import download_pdf
    return firebase_client, storage_service, embedding_service, pdf_processor, download_pdf


def delete_stale_cache(db, current_model, dry_run=False):
    """Delete cached answers whose question vector came from a different model."""
    stale = [
        snap.reference
        for snap in db.collection("questions").select(["embeddingModel"]).stream()
        if (snap.to_dict().get("embeddingModel") or Config.CLIP_MODEL_NAME) != current_model
    ]
    if not dry_run:
        for i in range(0, len(stale), 400):
            batch = db.batch()
            for ref in stale[i:i + 400]:
                batch.delete(ref)
            batch.commit()
    return len(stale)


async def reindex(only=None, dry_run=False, runtime=None):
    firebase_client, storage_service, embedding_service, pdf_processor, download_pdf = runtime or _load_runtime()
    db = firebase_client.db
    if not db:
        print("Firebase is not available (check credentials / ENV_FILE)")
        return {"ok": 0, "failed": 0, "skipped": 0, "cache_removed": 0}

    print(f"Embedding model: {embedding_service.model_id} ({embedding_service.dimension}-d)"
          f"{'  [DRY RUN]' if dry_run else ''}")

    docs = [(snap.id, snap.to_dict()) for snap in db.collection("documents").stream()]
    if only:
        docs = [(i, d) for i, d in docs if i == only]
        if not docs:
            print(f"No document with id {only!r}")
    totals = {"ok": 0, "failed": 0, "skipped": 0}

    for doc_id, data in sorted(docs, key=lambda x: str(x[1].get("name", ""))):
        name = data.get("name", doc_id)
        status = data.get("status")
        if status in ("Deleting", "Cancelled") or not data.get("fileUrl"):
            print(f"  skip   {name} ({doc_id}): status={status!r}, fileUrl={'yes' if data.get('fileUrl') else 'no'}")
            totals["skipped"] += 1
            continue
        if dry_run:
            print(f"  would  re-process {name} ({doc_id})")
            continue

        print(f"  start  {name} ({doc_id})")
        db.collection("documents").document(doc_id).update({"status": "Processing"})
        try:
            pdf_bytes = await download_pdf(data["fileUrl"])
            all_docs, all_embeddings = pdf_processor.process_pdf(pdf_bytes, doc_id)
            await storage_service.store_chunks(
                doc_id, all_docs, all_embeddings, embedding_model=embedding_service.model_id
            )
            await storage_service.update_document_status(doc_id, all_docs)
            images = getattr(pdf_processor, "last_image_stats", None) or {}
            extra = f" | images: {images}" if images.get("found") else ""
            print(f"  done   {name}: {len(all_docs)} chunks{extra}")
            totals["ok"] += 1
        except Exception as e:  # keep going: one bad document must not stop the rest
            db.collection("documents").document(doc_id).update({
                "status": "Error",
                "errorMessage": f"reindex failed: {type(e).__name__}: {e}",
            })
            print(f"  FAILED {name} ({doc_id}): {type(e).__name__}: {e}")
            totals["failed"] += 1

    removed = delete_stale_cache(db, embedding_service.model_id, dry_run=dry_run)
    if not dry_run and totals["ok"]:
        from database.corpus_epoch import bump_epoch
        bump_epoch(db)          # documents were rebuilt: no cached answer from before is trustworthy
    verb = "would delete" if dry_run else "deleted"
    print(f"\n{totals['ok']} re-processed, {totals['failed']} failed, {totals['skipped']} skipped; "
          f"{verb} {removed} cached answers from another embedding model")
    return {**totals, "cache_removed": removed}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true", help="show what would be done, change nothing")
    ap.add_argument("--only", help="re-process just this document id")
    args = ap.parse_args()
    result = asyncio.run(reindex(only=args.only, dry_run=args.dry_run))
    sys.exit(1 if result["failed"] else 0)


if __name__ == "__main__":
    main()
