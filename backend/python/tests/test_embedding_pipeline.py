"""
Integration tests: the REAL embedding models, chunker, storage, retrieval and
answer cache, against an in-memory Firestore. They check that text and image
vectors from different models are routed, tagged and compared correctly.

Needs torch, transformers, PyMuPDF, firebase-admin and the cached models, so run
them with a fully installed backend environment:

    python -m unittest discover -s python/tests -v        (from backend/)
"""
import _env  # noqa: F401  (must be first)

import asyncio
import contextlib
import io
import unittest

import fitz
import numpy as np
from PIL import Image, ImageDraw, ImageFont

from config import Config
from database.cache_repository import cache_repository
from database.corpus_epoch import bump_epoch
from database.firebase_client import firebase_client
from database.storage_service import storage_service
from fake_firestore import FakeDB
from services.embedding_service import embedding_service as es
from services.pdf_processor import pdf_processor
from services.retrieval_service import retrieval_service

BGE = Config.BGE_MODEL_NAME
CLIP = Config.CLIP_MODEL_NAME

try:
    _BIG = ImageFont.truetype("arial.ttf", 30)
    _SMALL = ImageFont.truetype("arial.ttf", 22)
    HAVE_FONT = True
except OSError:
    _BIG = _SMALL = ImageFont.load_default()
    HAVE_FONT = False


def _canvas(title):
    im = Image.new("RGB", (640, 420), "white")
    d = ImageDraw.Draw(im)
    d.text((20, 15), title, fill="black", font=_BIG)
    return im, d


def fee_table_image():
    im, d = _canvas("Fee Structure 2026-27")
    for i, (a, b) in enumerate([("Tuition fee", "Rs. 50,000"), ("Hostel fee", "Rs. 60,000"), ("Exam fee", "Rs. 3,000")]):
        y = 80 + i * 70
        d.rectangle([20, y, 620, y + 55], outline="black", width=2)
        d.text((35, y + 14), a, fill="black", font=_SMALL)
        d.text((420, y + 14), b, fill="black", font=_SMALL)
    return im


def campus_map_image():
    im, d = _canvas("Campus Map")
    for label, box in [("Library", [40, 90, 220, 190]), ("Hostel", [260, 90, 440, 190]), ("Canteen", [260, 240, 440, 340])]:
        d.rectangle(box, outline="black", width=3, fill="#dde8ff")
        d.text((box[0] + 20, box[1] + 35), label, fill="black", font=_SMALL)
    return im


def png_bytes(image):
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return buf.getvalue()


def cos(a, b):
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))


class DbCase(unittest.TestCase):
    """Gives each test a fresh fake Firestore and restores the real client after."""

    def setUp(self):
        self.db = FakeDB()
        self._saved_db = firebase_client._db
        firebase_client._db = self.db

    def tearDown(self):
        firebase_client._db = self._saved_db


class TestPdfProcessing(DbCase):
    def setUp(self):
        super().setUp()
        # These tests cover the CLIP image path; captioning (which calls Gemini) is tested separately.
        self._captioning = Config.IMAGE_CAPTIONING
        Config.IMAGE_CAPTIONING = False

    def tearDown(self):
        Config.IMAGE_CAPTIONING = self._captioning
        super().tearDown()

    @classmethod
    def setUpClass(cls):
        text1 = ("Fee Payment Policy. " + "Tuition fees for each semester must be paid on or before the 15th of the month. " * 9
                 + "A late fee of Rs. 200 per day applies after the due date.")
        pdf = fitz.open()
        p1 = pdf.new_page()
        p1.insert_textbox(fitz.Rect(40, 40, 550, 780), text1, fontsize=10)
        p2 = pdf.new_page()
        p2.insert_textbox(fitz.Rect(40, 40, 550, 200), "Fee structure is shown in the table below.", fontsize=11)
        p2.insert_image(fitz.Rect(60, 220, 460, 520), stream=png_bytes(fee_table_image()))
        cls.pdf_bytes = pdf.tobytes()

    def test_text_and_image_chunks_are_embedded_by_the_right_models(self):
        docs, embeddings = pdf_processor.process_pdf(self.pdf_bytes, "docT")
        self.assertEqual(len(docs), len(embeddings))
        self.assertIsInstance(embeddings, list)           # not one array: sizes differ

        text = [(d, e) for d, e in zip(docs, embeddings) if d.metadata["type"] == "text"]
        images = [(d, e) for d, e in zip(docs, embeddings) if d.metadata["type"] == "image"]
        self.assertGreaterEqual(len(text), 2, "page 1 is long enough to be split into several chunks")
        self.assertEqual(len(images), 1)

        for d, e in text:
            self.assertEqual(e.shape, (es.dimension,))
            self.assertEqual(d.metadata["embedding_model"], BGE)
        d, e = images[0]
        self.assertEqual(e.shape, (512,))
        self.assertEqual(d.metadata["embedding_model"], CLIP)
        self.assertEqual(d.metadata["page"], 1)          # 0-based page index of the second page
        for _, vec in text + images:
            self.assertAlmostEqual(float(np.linalg.norm(vec)), 1.0, places=4)

    def test_chunks_longer_than_clips_limit_are_embedded_whole(self):
        docs, _ = pdf_processor.process_pdf(self.pdf_bytes, "docT")
        longest = max((d for d in docs if d.metadata["type"] == "text"), key=lambda d: len(d.page_content))
        n_tokens = len(es._text.tokenizer(longest.page_content)["input_ids"])
        self.assertGreater(n_tokens, 77, "this fixture only proves something if a chunk exceeds CLIP's limit")
        self.assertLessEqual(n_tokens, es.max_tokens)

    def test_images_are_skipped_when_image_search_is_disabled(self):
        saved = es._clip
        es._clip = None
        try:
            docs, embeddings = pdf_processor.process_pdf(self.pdf_bytes, "docT")
        finally:
            es._clip = saved
        self.assertTrue(docs)
        self.assertTrue(all(d.metadata["type"] == "text" for d in docs))

    def test_storage_tags_every_chunk_with_the_model_that_produced_it(self):
        docs, embeddings = pdf_processor.process_pdf(self.pdf_bytes, "docT")
        asyncio.run(storage_service.store_chunks("docT", docs, embeddings, embedding_model=BGE))
        stored = self.db.collection("chunks").docs
        self.assertEqual(len(stored), len(docs))
        for chunk in stored.values():
            if chunk["type"] == "image":
                self.assertEqual((chunk["embeddingModel"], chunk["embeddingDim"]), (CLIP, 512))
            else:
                self.assertEqual((chunk["embeddingModel"], chunk["embeddingDim"]), (BGE, 384))
        # re-processing overwrites instead of duplicating
        asyncio.run(storage_service.store_chunks("docT", docs, embeddings, embedding_model=BGE))
        self.assertEqual(len(self.db.collection("chunks").docs), len(docs))


class TestRetrievalRouting(DbCase):
    TXT = "A late fee of Rs. 200 per day is charged after the due date for tuition fees."

    def setUp(self):
        super().setUp()
        d = self.db
        d.collection("documents").docs["d1"] = {"status": "Processed", "name": "Fees"}
        d.collection("documents").docs["d2"] = {"status": "Processing", "name": "Not ready"}
        chunks = d.collection("chunks").docs
        meta = lambda page, image_id=None: {"pageNumber": page, "imageId": image_id}
        chunks["t_bge"] = {"documentId": "d1", "type": "text", "content": self.TXT, "embedding": es.embed_text(self.TXT).tolist(),
                           "embeddingModel": BGE, "metadata": meta(0)}
        chunks["t_legacy_clip"] = {"documentId": "d1", "type": "text", "content": "old clip text", "embedding": [0.1] * 512, "metadata": meta(1)}
        chunks["t_other_model"] = {"documentId": "d1", "type": "text", "content": "other model", "embedding": [0.1] * 384,
                                   "embeddingModel": "someone/else", "metadata": meta(2)}
        chunks["t_unprocessed_doc"] = {"documentId": "d2", "type": "text", "content": self.TXT, "embedding": es.embed_text(self.TXT).tolist(),
                                       "embeddingModel": BGE, "metadata": meta(0)}
        chunks["i_fee"] = {"documentId": "d1", "type": "image", "content": "[Image]", "embedding": es.embed_image(fee_table_image()).tolist(),
                           "embeddingModel": CLIP, "metadata": meta(0, "fee")}
        chunks["i_map_legacy"] = {"documentId": "d1", "type": "image", "content": "[Image]", "embedding": es.embed_image(campus_map_image()).tolist(),
                                  "metadata": meta(1, "map")}     # stored before vectors were tagged: CLIP
        chunks["i_other_model"] = {"documentId": "d1", "type": "image", "content": "[Image]", "embedding": [0.1] * 64,
                                   "embeddingModel": "someone/else", "metadata": meta(2, "other")}
        self.q = es.embed_query("what is the late fee for tuition")
        self.qi = es.embed_image_query("show me the fee structure table")
        self._saved = (Config.MIN_IMAGE_SCORE, Config.IMAGE_TOP_K)

    def tearDown(self):
        Config.MIN_IMAGE_SCORE, Config.IMAGE_TOP_K = self._saved
        super().tearDown()

    def retrieve(self, **kwargs):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            docs = retrieval_service.retrieve_multimodal(self.q, **kwargs)
        return docs, buf.getvalue()

    def test_text_comes_only_from_chunks_made_by_the_current_text_model(self):
        docs, _ = self.retrieve(image_query_embedding=None)
        self.assertEqual([d.page_content for d in docs], [self.TXT])

    def test_text_chunks_of_unprocessed_documents_are_never_used(self):
        docs, _ = self.retrieve(image_query_embedding=None)
        self.assertNotIn("d2", [d.metadata["documentId"] for d in docs])

    def test_vectors_from_other_models_are_ignored_not_compared(self):
        # a 512-d or 64-d vector compared with a 384-d query would raise; reaching here proves it was skipped
        docs, log = self.retrieve(image_query_embedding=self.qi)
        self.assertIn("3 chunks were indexed with a different embedding model", log)
        self.assertTrue(docs)

    def test_no_images_when_no_image_query_is_given(self):
        docs, _ = self.retrieve(image_query_embedding=None)
        self.assertEqual([d for d in docs if d.metadata["type"] == "image"], [])

    def test_images_are_ranked_with_their_own_clip_scores(self):
        Config.MIN_IMAGE_SCORE, Config.IMAGE_TOP_K = 0.0, 5
        docs, _ = self.retrieve(image_query_embedding=self.qi)
        images = [d for d in docs if d.metadata["type"] == "image"]
        # both CLIP images (tagged and legacy-untagged) are used; the foreign-model one is not
        self.assertEqual({d.metadata["image_id"] for d in images}, {"fee", "map"})
        self.assertEqual([d.metadata["similarity"] for d in images], sorted((d.metadata["similarity"] for d in images), reverse=True))
        self.assertTrue(all(0.0 < d.metadata["similarity"] < 0.6 for d in images), "CLIP text-image scores are on a low scale")

    @unittest.skipUnless(HAVE_FONT, "needs the Arial font to render legible test figures")
    def test_the_figure_that_answers_the_question_ranks_first(self):
        Config.MIN_IMAGE_SCORE, Config.IMAGE_TOP_K = 0.0, 5
        docs, _ = self.retrieve(image_query_embedding=self.qi)
        images = [d for d in docs if d.metadata["type"] == "image"]
        self.assertEqual(images[0].metadata["image_id"], "fee")

    def test_image_top_k_and_floor_are_enforced(self):
        Config.MIN_IMAGE_SCORE, Config.IMAGE_TOP_K = 0.0, 1
        docs, _ = self.retrieve(image_query_embedding=self.qi)
        self.assertEqual(len([d for d in docs if d.metadata["type"] == "image"]), 1)
        Config.MIN_IMAGE_SCORE, Config.IMAGE_TOP_K = 0.99, 5
        docs, _ = self.retrieve(image_query_embedding=self.qi)
        self.assertEqual([d for d in docs if d.metadata["type"] == "image"], [])

    def test_text_chunks_come_before_images(self):
        Config.MIN_IMAGE_SCORE, Config.IMAGE_TOP_K = 0.0, 5
        docs, _ = self.retrieve(image_query_embedding=self.qi)
        types = [d.metadata["type"] for d in docs]
        self.assertEqual(types, sorted(types, key=lambda t: t == "image"))

    def test_nothing_is_returned_for_a_corpus_indexed_only_by_another_model(self):
        for c in list(self.db.collection("chunks").docs.values()):
            if c["type"] == "text":
                c["embeddingModel"] = "someone/else"
        bump_epoch(self.db)           # chunks changed behind this process: the epoch is how it finds out
        docs, log = self.retrieve(image_query_embedding=None)
        self.assertEqual(docs, [])
        self.assertIn("different embedding model", log)


class TestAnswerCacheModelSafety(DbCase):
    """The OPTIONAL semantic cache path (off by default, see P1-8): vectors from another model are never compared."""
    def setUp(self):
        super().setUp()
        self._semantic = Config.CACHE_SEMANTIC_MATCH
        Config.CACHE_SEMANTIC_MATCH = True

    def tearDown(self):
        Config.CACHE_SEMANTIC_MATCH = self._semantic
        super().tearDown()

    def _seed(self, **overrides):
        q = "how much is the late fee"
        entry = {"question": q, "fingerprint": "different-fingerprint", "entities": {}, "intent": "general",
                 "answer": "Rs. 200 per day", "sources": [], "confidence": None, "embedding": es.embed_query(q).tolist(),
                 "embeddingModel": BGE, "corpusEpoch": 0, "cachedAtMs": int(__import__("time").time() * 1000)}
        entry.update(overrides)
        self.db.collection("questions").docs[overrides.get("_id", "q1")] = {k: v for k, v in entry.items() if k != "_id"}

    def lookup(self, question="how much is the late fee"):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            return asyncio.run(cache_repository.find_similar_question(question, es.embed_query(question), "general", 0))

    def test_a_matching_entry_from_the_current_model_is_found(self):
        self._seed()
        hit = self.lookup()
        self.assertIsNotNone(hit)
        self.assertEqual(hit["answer"], "Rs. 200 per day")

    def test_an_untagged_legacy_clip_entry_is_ignored_and_does_not_crash(self):
        self._seed(embedding=[0.1] * 512, embeddingModel=None)
        self.assertIsNone(self.lookup())

    def test_an_entry_from_another_model_is_ignored(self):
        self._seed(embeddingModel="someone/else")
        self.assertIsNone(self.lookup())

    def test_new_cache_entries_are_tagged_with_the_model(self):
        qid = asyncio.run(cache_repository.store_question(
            "what is the late fee", es.embed_query("what is the late fee"), "answer", "general",
            {"level": "Low", "score": 0, "reasoning": ""}, []))
        self.assertEqual(self.db.collection("questions").docs[qid]["embeddingModel"], BGE)


if __name__ == "__main__":
    unittest.main()
