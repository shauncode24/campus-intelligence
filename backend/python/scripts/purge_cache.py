"""
Delete cached answers that can no longer be served.

Stale entries are harmless (they are ignored when looked up) but they take space and, before
the answer cache was reworked, old entries have no `corpusEpoch` and will never be used again.

    python scripts/purge_cache.py --dry-run     # count what would be deleted
    python scripts/purge_cache.py               # delete entries from an older document set or past the age limit
    python scripts/purge_cache.py --all         # delete everything (the cache refills itself)

Run it from backend/python with the real credentials available (backend/.env or ENV_FILE).
"""
import argparse
import os
import sys
import time

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from config import Config  # noqa: E402


def purge(db, corpus_epoch: int, delete_all: bool = False, dry_run: bool = False, now_ms: int = None) -> int:
    """Delete unservable cache entries; returns how many were (or would be) deleted."""
    now_ms = now_ms if now_ms is not None else int(time.time() * 1000)
    ttl_ms = Config.CACHE_TTL_DAYS * 86400 * 1000
    doomed = []
    for snap in db.collection("questions").stream():
        data = snap.to_dict() or {}
        too_old = ttl_ms > 0 and not (isinstance(data.get("cachedAtMs"), (int, float))
                                      and now_ms - data["cachedAtMs"] <= ttl_ms)
        if delete_all or data.get("corpusEpoch") != corpus_epoch or too_old:
            doomed.append(snap.reference)
    if not dry_run:
        for i in range(0, len(doomed), 400):
            batch = db.batch()
            for ref in doomed[i:i + 400]:
                batch.delete(ref)
            batch.commit()
    return len(doomed)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--all", action="store_true", help="delete every cached answer")
    ap.add_argument("--dry-run", action="store_true", help="only count")
    args = ap.parse_args()

    from database.firebase_client import firebase_client
    from database.corpus_epoch import get_epoch
    db = firebase_client.db
    if not db:
        print("Firebase is not available (check credentials / ENV_FILE)")
        sys.exit(1)
    n = purge(db, get_epoch(db), delete_all=args.all, dry_run=args.dry_run)
    print(f"{'Would delete' if args.dry_run else 'Deleted'} {n} cached answers")


if __name__ == "__main__":
    main()
