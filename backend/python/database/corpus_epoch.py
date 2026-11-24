"""
The "corpus epoch": a counter that changes whenever the set of documents that can answer
questions changes (a document finished processing, was replaced by a newer version, was
deleted). Every cached answer records the epoch it was produced under and is served only while
the epoch is unchanged, so a new, changed or removed document can never be shadowed by a stale
cached answer. Cheap and safe: any change invalidates the whole cache, and it refills itself.

(Time-based changes, such as a document passing its expiry date, are not events; those are
caught at lookup time by checking that every cited document is still live.)
"""
from firebase_admin import firestore

COLLECTION, DOC = "meta", "corpus"


def get_epoch(db) -> int:
    """Current epoch (0 if nothing has ever bumped it)."""
    snap = db.collection(COLLECTION).document(DOC).get()
    return int((snap.to_dict() or {}).get("epoch", 0)) if snap.exists else 0


def bump_epoch(db) -> None:
    """Invalidate every cached answer produced before now."""
    ref = db.collection(COLLECTION).document(DOC)
    if ref.get().exists:
        ref.update({"epoch": firestore.Increment(1), "updatedAt": firestore.SERVER_TIMESTAMP})
    else:
        ref.set({"epoch": 1, "updatedAt": firestore.SERVER_TIMESTAMP})
