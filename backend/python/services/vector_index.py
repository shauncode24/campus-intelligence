"""
In-memory vector index over the `chunks` collection.

Before: every question downloaded EVERY chunk (text + its vector) from Firestore and compared
them one by one in Python: reads, transfer and latency grew linearly with the corpus.
Now: the chunks are read once, kept as numpy matrices, and a question is one matrix product.
Firestore is read again only when the corpus changes.

When it is rebuilt
- The corpus epoch (`meta/corpus`, bumped whenever a document finishes processing, is replaced
  or reindexed) is compared on every question: one small read. A different epoch means another
  process (or an earlier run) changed the chunks, so the index is rebuilt.
- This process drops its index immediately when it writes or deletes chunks itself.
- Chunks of documents that are not live (deleted, expired, superseded, still processing) are
  NOT removed from the index: they are excluded at question time by the live-document set, which
  is read fresh every time, exactly as before.

Memory: about 1.5 KB per text chunk (384 floats) plus its text. Config.VECTOR_INDEX_MAX_CHUNKS
caps it; above the cap the caller falls back to the old scan and says so (that is the point
where a real vector store, such as Firestore find_nearest, is worth its operational cost).
"""
import threading
import time

import numpy as np

from config import Config


class _Group:
    """All chunks of one kind (text or image) produced by one embedding model."""

    def __init__(self):
        self.ids, self.docs, self.meta, self.rows = [], [], [], []
        self.matrix = None            # (n, dim) float32, rows L2-normalised
        self.doc_codes = None         # (n,) int, index into VectorIndex.doc_names

    def finish(self, doc_code):
        m = np.asarray(self.rows, dtype=np.float32)
        norms = np.linalg.norm(m, axis=1, keepdims=True)
        norms[norms == 0] = 1.0       # an all-zero vector scores 0 instead of NaN
        self.matrix = m / norms
        self.doc_codes = np.array([doc_code[d] for d in self.docs], dtype=np.int64)
        self.rows = []                # the un-normalised copy is not needed any more


class VectorIndex:
    def __init__(self):
        self._lock = threading.Lock()
        self._built_for = None        # (id(db), epoch) the current contents belong to
        self._groups = {}             # (is_image, model) -> _Group
        self._doc_code = {}           # document id -> int
        self.size = 0
        self.rebuilds = 0
        self.last_build_seconds = 0.0
        self.too_large = False

    def invalidate(self):
        """This process just changed chunks: the next question rebuilds."""
        self._built_for = None

    def _build(self, db, key, max_chunks):
        started = time.time()
        groups, doc_code, count = {}, {}, 0
        self.too_large = False
        for snap in db.collection("chunks").stream():
            data = snap.to_dict() or {}
            if "embedding" not in data:
                continue
            count += 1
            if max_chunks and count > max_chunks:
                self.too_large = True
                break
            is_caption = bool(data.get("isCaption"))
            is_image = data.get("type", "text") == "image" and not is_caption
            model = data.get("embeddingModel") or Config.CLIP_MODEL_NAME   # untagged legacy chunks came from CLIP
            g = groups.setdefault((is_image, model), _Group())
            if g.rows and len(data["embedding"]) != len(g.rows[0]):
                continue                # a malformed vector can never be compared; skip it
            doc_id = data.get("documentId")
            doc_code.setdefault(doc_id, len(doc_code))
            md = data.get("metadata") or {}
            g.ids.append(snap.id)
            g.docs.append(doc_id)
            g.rows.append(data["embedding"])
            g.meta.append({
                "content": data.get("content", ""),
                "type": data.get("type", "text"),
                "page": md.get("pageNumber"),
                "image_id": md.get("imageId"),
                "xref": md.get("xref"),
                "caption": is_caption,
            })
        if self.too_large:
            self._groups, self._doc_code, self.size = {}, {}, 0
            self._built_for = key       # remember the verdict until the corpus changes
            return
        for g in groups.values():
            g.finish(doc_code)
        self._groups, self._doc_code, self.size = groups, doc_code, count
        self._built_for = key
        self.rebuilds += 1
        self.last_build_seconds = time.time() - started
        print(f"📇 Vector index built: {count} chunks in {self.last_build_seconds:.2f}s")

    def ensure(self, db, epoch, max_chunks=0):
        """Make the index current for `epoch`. Returns False when the corpus is over the cap."""
        key = (id(db), epoch)
        if self._built_for != key:
            with self._lock:
                if self._built_for != key:
                    self._build(db, key, max_chunks)
        return not self.too_large

    def search(self, kind_is_image, model, query_vector, allowed_docs, k):
        """
        Best `k` chunks of one kind produced by `model`, restricted to `allowed_docs` (a set of
        document ids). Returns ([(chunk_id, doc_id, meta, similarity)], ignored) where `ignored`
        counts chunks of the allowed documents that were skipped because another model made them.
        """
        allowed_codes = np.array([self._doc_code[d] for d in allowed_docs if d in self._doc_code], dtype=np.int64)
        ignored = 0
        best = None
        for (is_image, group_model), g in self._groups.items():
            if is_image != kind_is_image:
                continue
            in_scope = np.isin(g.doc_codes, allowed_codes)
            if group_model != model:
                ignored += int(in_scope.sum())
                continue
            best = (g, in_scope)
        if best is None:
            return [], ignored
        g, in_scope = best
        idx = np.nonzero(in_scope)[0]
        if idx.size == 0:
            return [], ignored
        q = np.asarray(query_vector, dtype=np.float32)
        norm = np.linalg.norm(q)
        if norm == 0 or q.shape[0] != g.matrix.shape[1]:
            return [], ignored
        sims = g.matrix[idx] @ (q / norm)
        order = np.argsort(-sims, kind="stable")[:k]
        out = [(g.ids[idx[i]], g.docs[idx[i]], g.meta[idx[i]], float(sims[i])) for i in order]
        return out, ignored


vector_index = VectorIndex()
