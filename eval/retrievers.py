"""
Retrievers under evaluation. Each one implements:

    build(pages)             index the corpus (a list of page dicts, see dataset.py)
    search(question, k)      -> list of hits, best first:
                             {"doc", "page" (1-based), "score", "text"}
    describe()               -> dict recorded in the report (model, chunking, ...)
    score_kind               "cosine" (thresholds are meaningful) or "other"

"production" runs the REAL backend code (the same chunker, embedding model and
cosine ranking the service uses) so the numbers describe what users get. Which
embedding model it uses is chosen with EMBEDDING_BACKEND (bge-small | clip), so
backends are compared by running the evaluation once per backend.

"bm25" is a plain keyword baseline. It is here as a sanity reference ("does the
embedding beat simple word matching?") and as the lexical half of a future
hybrid search.
"""
import math
import os
import re
import sys
import tempfile

import numpy as np

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BACKEND_PY = os.path.join(REPO_ROOT, "backend", "python")


def load_backend(embedding_backend=None):
    """
    Import backend modules for the evaluation. Points ENV_FILE at an empty file
    so the real backend/.env (with production secrets) is never loaded into this
    process; the evaluation needs no credentials.
    """
    # Only the opt-in "rewrite" mode (which calls Gemini) needs real credentials.
    empty = os.path.join(tempfile.gettempdir(), "campus_intel_empty.env")
    open(empty, "w").close()
    os.environ["ENV_FILE"] = os.environ.get("EVAL_ENV_FILE") or empty
    if embedding_backend:
        os.environ["EMBEDDING_BACKEND"] = embedding_backend
    if BACKEND_PY not in sys.path:
        sys.path.insert(0, BACKEND_PY)


class ProductionRetriever:
    name = "production"
    score_kind = "cosine"

    def __init__(self, embedding_backend=None):
        load_backend(embedding_backend)
        from config import Config
        from services.embedding_service import embedding_service
        from services.pdf_processor import pdf_processor
        self.Config, self.embedding, self.processor = Config, embedding_service, pdf_processor
        self.chunks, self.matrix = [], None

    def build(self, pages):
        vectors = []
        for p in pages:
            # exactly the production path: split with the production chunker, embed the chunks
            docs, embs = self.processor._process_text(p["text"], p["page"] - 1, p["doc"])
            for d, e in zip(docs, embs):
                self.chunks.append({"doc": p["doc"], "page": p["page"], "text": d.page_content})
                vectors.append(e)
        self.matrix = np.stack(vectors)

    def search(self, question, k):
        q = self.embedding.embed_query(question)
        scores = self.matrix @ q          # vectors are L2-normalised, so this is cosine similarity
        order = np.argsort(-scores, kind="stable")[:k]
        return [{**self.chunks[i], "score": float(scores[i])} for i in order]

    def describe(self):
        return {
            "retriever": self.name,
            "embedding_backend": self.embedding.backend,
            "embedding_model": self.embedding.model_id,
            "embedding_dimension": self.embedding.dimension,
            "embedding_max_tokens": self.embedding.max_tokens,
            "chunk_size": self.Config.CHUNK_SIZE,
            "chunk_overlap": self.Config.CHUNK_OVERLAP,
            "num_chunks": len(self.chunks),
            "production_relevance_floor": self.Config.MIN_RETRIEVAL_SCORE,
        }


_STOPWORDS = set(
    "a an and are as at be by can do does for from how i if in is it me my of on or so than that the "
    "their then there these this to was what when where which who why will with you your am been being "
    "have has had not no".split()
)


def tokenize(text):
    return [t for t in re.findall(r"[a-z0-9]+", text.lower()) if t not in _STOPWORDS]


class BM25Retriever:
    name = "bm25"
    score_kind = "other"

    def __init__(self, k1=1.5, b=0.75, **_ignored):
        load_backend()
        from config import Config
        from langchain_text_splitters import RecursiveCharacterTextSplitter
        self.k1, self.b = k1, b
        self.Config = Config
        self.splitter = RecursiveCharacterTextSplitter(
            chunk_size=Config.CHUNK_SIZE, chunk_overlap=Config.CHUNK_OVERLAP
        )
        self.chunks, self.tokens, self.df, self.avgdl = [], [], {}, 0.0

    def build(self, pages):
        for p in pages:
            for piece in self.splitter.split_text(p["text"]):
                self.chunks.append({"doc": p["doc"], "page": p["page"], "text": piece})
                self.tokens.append(tokenize(piece))
        for toks in self.tokens:
            for t in set(toks):
                self.df[t] = self.df.get(t, 0) + 1
        self.avgdl = sum(len(t) for t in self.tokens) / max(len(self.tokens), 1)

    def _score(self, q_tokens, doc_tokens):
        n = len(self.tokens)
        tf = {}
        for t in doc_tokens:
            tf[t] = tf.get(t, 0) + 1
        score = 0.0
        for t in set(q_tokens):
            if t not in tf:
                continue
            idf = math.log(1 + (n - self.df[t] + 0.5) / (self.df[t] + 0.5))
            norm = tf[t] * (self.k1 + 1) / (tf[t] + self.k1 * (1 - self.b + self.b * len(doc_tokens) / self.avgdl))
            score += idf * norm
        return score

    def search(self, question, k):
        q = tokenize(question)
        scored = [(self._score(q, toks), i) for i, toks in enumerate(self.tokens)]
        scored.sort(key=lambda x: (-x[0], x[1]))
        return [{**self.chunks[i], "score": float(s)} for s, i in scored[:k]]

    def describe(self):
        return {
            "retriever": self.name,
            "k1": self.k1,
            "b": self.b,
            "chunk_size": self.Config.CHUNK_SIZE,
            "chunk_overlap": self.Config.CHUNK_OVERLAP,
            "num_chunks": len(self.chunks),
        }


class _Bm25Index:
    """BM25 over a ready-made list of chunk texts (the same chunks the dense retriever uses)."""

    def __init__(self, texts, k1=1.5, b=0.75):
        self.k1, self.b = k1, b
        self.tokens = [tokenize(t) for t in texts]
        self.df = {}
        for toks in self.tokens:
            for t in set(toks):
                self.df[t] = self.df.get(t, 0) + 1
        self.avgdl = sum(len(t) for t in self.tokens) / max(len(self.tokens), 1)

    score_one = BM25Retriever._score

    def scores(self, question):
        q = tokenize(question)
        return [self.score_one(q, toks) for toks in self.tokens]


def rrf_fuse(rankings, k=60):
    """Reciprocal Rank Fusion: each ranking (best first, list of ids) adds 1/(k+rank) to an id."""
    fused = {}
    for ranking in rankings:
        for rank, i in enumerate(ranking, start=1):
            fused[i] = fused.get(i, 0.0) + 1.0 / (k + rank)
    return sorted(fused, key=lambda i: (-fused[i], i))


class HybridRetriever(ProductionRetriever):
    """
    EXPERIMENT (P2-2): dense (the production retriever) + BM25, fused with Reciprocal Rank Fusion.
    The ORDER comes from the fusion; the reported `score` stays the dense cosine similarity, because
    that is what the production relevance floor is defined on.
    """
    name = "hybrid"
    CANDIDATES = 50

    def build(self, pages):
        super().build(pages)
        self.bm25 = _Bm25Index([c["text"] for c in self.chunks])

    def _fused_order(self, question, dense_scores):
        n = min(self.CANDIDATES, len(self.chunks))
        dense = list(np.argsort(-dense_scores, kind="stable")[:n])
        lex_scores = np.array(self.bm25.scores(question))
        lexical = [int(i) for i in np.argsort(-lex_scores, kind="stable")[:n] if lex_scores[i] > 0]
        return rrf_fuse([[int(i) for i in dense], lexical])

    def search(self, question, k):
        q = self.embedding.embed_query(question)
        dense_scores = self.matrix @ q
        order = self._fused_order(question, dense_scores)[:k]
        return [{**self.chunks[i], "score": float(dense_scores[i])} for i in order]

    def describe(self):
        return {**super().describe(), "retriever": self.name, "fusion": "RRF k=60", "candidates_per_list": self.CANDIDATES}


class RerankRetriever(ProductionRetriever):
    """
    EXPERIMENT (P2-2): dense top-N re-scored by a small cross-encoder that reads question and passage
    together. `score` stays the dense cosine (production floor); the order is the reranker's.
    """
    name = "rerank"
    CANDIDATES = 20
    MODEL = "cross-encoder/ms-marco-MiniLM-L-6-v2"

    def __init__(self, embedding_backend=None):
        super().__init__(embedding_backend)
        import torch
        from transformers import AutoModelForSequenceClassification, AutoTokenizer
        self.torch = torch
        self.tok = AutoTokenizer.from_pretrained(self.MODEL)
        self.model = AutoModelForSequenceClassification.from_pretrained(self.MODEL).eval()

    def search(self, question, k):
        q = self.embedding.embed_query(question)
        dense_scores = self.matrix @ q
        cand = [int(i) for i in np.argsort(-dense_scores, kind="stable")[: self.CANDIDATES]]
        enc = self.tok([question] * len(cand), [self.chunks[i]["text"] for i in cand],
                       padding=True, truncation=True, max_length=512, return_tensors="pt")
        with self.torch.no_grad():
            logits = self.model(**enc).logits.reshape(-1).tolist()
        order = [cand[j] for j in sorted(range(len(cand)), key=lambda j: (-logits[j], j))][:k]
        return [{**self.chunks[i], "score": float(dense_scores[i])} for i in order]

    def describe(self):
        return {**super().describe(), "retriever": self.name, "reranker": self.MODEL, "candidates": self.CANDIDATES}


RETRIEVERS = {"production": ProductionRetriever, "bm25": BM25Retriever,
              "hybrid": HybridRetriever, "rerank": RerankRetriever}
