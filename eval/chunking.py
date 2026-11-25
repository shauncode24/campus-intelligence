"""
Chunking experiments (P1-2): does changing HOW pages are cut into passages change whether the
right page is found?

`ChunkingRetriever` is the production retriever with the chunking step replaced by a configurable
one; everything else (embedding model, cosine ranking) is the production code, so a difference
between two configurations is caused by the chunking alone.

Configuration (all optional):
  size, overlap       characters per passage and overlap (production: 500 / 100)
  title_prefix        put the document title in front of every passage before embedding, so a
                      passage that never says what it is about ("The fee is Rs. 200") still carries it
  cross_page          cut each document as one text instead of page by page, so a passage can span a
                      page break (each passage is attributed to the page where it starts)
  strip_headers       remove lines that repeat on at least half of a document's pages (running
                      headers and footers, page numbers) before cutting

Only the embedded text changes; the text shown and checked (`text`) is the passage itself.
"""
import re
from collections import Counter

import numpy as np

from retrievers import ProductionRetriever


def strip_repeated_lines(texts, min_share=0.5):
    """Drop lines that appear (after removing digits) on at least `min_share` of the pages."""
    if len(texts) < 3:
        return list(texts)
    key = lambda line: re.sub(r"\d+", "#", line.strip().lower())   # noqa: E731  ("Page 3" and "Page 4" are one line)
    counts = Counter()
    for text in texts:
        counts.update({key(l) for l in text.splitlines() if l.strip()})
    common = {k for k, n in counts.items() if n / len(texts) >= min_share}
    return ["\n".join(l for l in text.splitlines() if key(l) not in common) for text in texts]


class ChunkingRetriever(ProductionRetriever):
    name = "chunking"

    def __init__(self, embedding_backend=None, size=None, overlap=None, title_prefix=False,
                 cross_page=False, strip_headers=False):
        super().__init__(embedding_backend)
        from langchain_text_splitters import RecursiveCharacterTextSplitter
        self.size = size or self.Config.CHUNK_SIZE
        self.overlap = self.Config.CHUNK_OVERLAP if overlap is None else overlap
        self.title_prefix, self.cross_page, self.strip_headers = title_prefix, cross_page, strip_headers
        self.splitter = RecursiveCharacterTextSplitter(chunk_size=self.size, chunk_overlap=self.overlap)

    def _pieces(self, doc_pages):
        """[(page, text)] for one document, cut according to the configuration."""
        texts = [p["text"] for p in doc_pages]
        if self.strip_headers:
            texts = strip_repeated_lines(texts)
        if not self.cross_page:
            return [(p["page"], piece) for p, t in zip(doc_pages, texts) for piece in self.splitter.split_text(t)]
        joined, starts = "", []
        for p, t in zip(doc_pages, texts):
            starts.append((len(joined), p["page"]))
            joined += t + "\n\n"
        out, cursor = [], 0
        for piece in self.splitter.split_text(joined):
            at = joined.find(piece[:60], max(0, cursor - self.overlap - 200))
            at = cursor if at < 0 else at
            cursor = at
            page = [pg for start, pg in starts if start <= at][-1] if starts else 1
            out.append((page, piece))
        return out

    def build(self, pages):
        by_doc = {}
        for p in sorted(pages, key=lambda p: (p["doc"], p["page"])):
            by_doc.setdefault(p["doc"], []).append(p)
        texts = []
        for doc, doc_pages in by_doc.items():
            title = doc_pages[0].get("title") or doc
            for page, piece in self._pieces(doc_pages):
                if not piece.strip():
                    continue
                self.chunks.append({"doc": doc, "page": page, "text": piece})
                texts.append(f"{title}\n{piece}" if self.title_prefix else piece)
        self.matrix = np.stack(self.embedding.embed_texts(texts))

    def describe(self):
        return {**super().describe(), "retriever": self.name, "chunk_size": self.size, "chunk_overlap": self.overlap,
                "title_prefix": self.title_prefix, "cross_page": self.cross_page, "strip_headers": self.strip_headers}
