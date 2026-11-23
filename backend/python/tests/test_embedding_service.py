"""
Tests for the embedding backends. These load the REAL models (the first run
downloads bge-small, ~130 MB; CLIP must be in the Hugging Face cache), so they
take a few seconds. Run from backend/:

    venv\\Scripts\\python.exe -m unittest discover -s python/tests -v
"""
import _env  # noqa: F401  (must be first)

import unittest

import numpy as np

from config import Config
from services import embedding_service as es


def cos(a, b):
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))


class TestBgeBackend(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bge = es._BgeEmbedder(Config.BGE_MODEL_NAME)

    def test_identity_and_dimension(self):
        self.assertEqual(self.bge.model_id, "BAAI/bge-small-en-v1.5")
        self.assertEqual(self.bge.dimension, 384)
        self.assertEqual(self.bge.max_tokens, 512)
        self.assertFalse(self.bge.supports_images)

    def test_vector_is_normalised_1d_of_the_right_size(self):
        v = self.bge.embed_text("Tuition fees are due on the 15th of the month.")
        self.assertEqual(v.shape, (384,))
        self.assertAlmostEqual(float(np.linalg.norm(v)), 1.0, places=5)

    def test_deterministic(self):
        a = self.bge.embed_text("Hostel gates close at 10 PM.")
        b = self.bge.embed_text("Hostel gates close at 10 PM.")
        self.assertTrue(np.allclose(a, b, atol=1e-6))

    def test_batch_matches_single(self):
        texts = ["late fee per day", "hostel gate timings", "revaluation of answer scripts"]
        batch = self.bge.embed_texts(texts)
        self.assertEqual(batch.shape, (3, 384))
        for t, row in zip(texts, batch):
            # padding in a batch must not change the result
            self.assertGreater(cos(row, self.bge.embed_text(t)), 0.9999)

    def test_batches_larger_than_the_batch_size_work(self):
        n = es.ENCODE_BATCH_SIZE * 2 + 5
        out = self.bge.embed_texts([f"passage number {i}" for i in range(n)])
        self.assertEqual(out.shape, (n, 384))

    def test_empty_inputs(self):
        self.assertEqual(self.bge.embed_texts([]).shape, (0, 384))
        self.assertEqual(self.bge.embed_text("").shape, (384,))

    def test_query_uses_the_instruction_prefix_and_documents_do_not(self):
        q = "what is the late fee"
        query_vec = self.bge.embed_query(q)
        self.assertTrue(np.allclose(query_vec, self.bge.embed_text(es.BGE_QUERY_INSTRUCTION + q), atol=1e-6))
        self.assertFalse(np.allclose(query_vec, self.bge.embed_text(q), atol=1e-4))

    def test_long_input_is_truncated_not_an_error(self):
        v = self.bge.embed_text("campus policy " * 3000)   # far beyond 512 tokens
        self.assertEqual(v.shape, (384,))

    def test_images_are_not_supported(self):
        with self.assertRaises(NotImplementedError):
            self.bge.embed_image(None)

    def test_matches_the_documented_sentence_transformers_pipeline(self):
        """
        The model's own config says: Transformer -> Pooling(CLS) -> Normalize.
        Re-do those three steps by hand and check we produce the same vector.
        """
        import torch
        text = "Minimum attendance of 75 percent is required."
        inputs = self.bge.tokenizer([text], padding=True, truncation=True, max_length=512, return_tensors="pt")
        with torch.no_grad():
            hidden = self.bge.model(**inputs).last_hidden_state
        by_hand = torch.nn.functional.normalize(hidden[:, 0], dim=1)[0].numpy()
        self.assertTrue(np.allclose(by_hand, self.bge.embed_text(text), atol=1e-6))
        # and NOT mean pooling (the config says CLS), which would be a different vector
        mean_pooled = torch.nn.functional.normalize(hidden.mean(dim=1), dim=1)[0].numpy()
        self.assertFalse(np.allclose(mean_pooled, self.bge.embed_text(text), atol=1e-3))

    def test_smoke_related_text_scores_higher_than_unrelated(self):
        """A sanity check that the model works, NOT a quality measurement."""
        fee = "A late fee of Rs. 200 per day is charged after the due date for tuition fees."
        hostel = "Hostel gates close at 10 PM for first-year students."
        q = self.bge.embed_query("how much is the late fee for tuition")
        self.assertGreater(cos(q, self.bge.embed_text(fee)), cos(q, self.bge.embed_text(hostel)))


class TestTruncationBugIsFixed(unittest.TestCase):
    """
    Audit finding R1: CLIP's text tower reads only 77 tokens, so for a 500
    character chunk the END of the chunk (often the number or date that answers
    the question) never influenced the embedding.
    """

    @classmethod
    def setUpClass(cls):
        cls.bge = es._BgeEmbedder(Config.BGE_MODEL_NAME)
        cls.clip = es._ClipEmbedder(Config.CLIP_MODEL_NAME)
        # ~190 tokens of shared text, so the sentence that differs sits far past CLIP's 77-token cutoff
        filler = "The accounts office collects tuition and examination fees from students every semester. " * 12
        cls.a = filler + "The late fee is Rs. 200 per day."
        cls.b = filler + "The refund of hostel deposit is made within 30 days."

    def test_the_two_passages_really_exceed_clips_limit(self):
        n_tokens = len(self.clip.processor.tokenizer(self.a)["input_ids"])
        self.assertGreater(n_tokens, es.CLIP_MAX_TOKENS + 20)
        # ...but fit comfortably inside bge's limit
        self.assertLess(len(self.bge.tokenizer(self.a)["input_ids"]), es.BGE_MAX_TOKENS)

    def test_clip_cannot_tell_the_passages_apart(self):
        self.assertGreater(cos(self.clip.embed_text(self.a), self.clip.embed_text(self.b)), 0.99999)

    def test_bge_can(self):
        self.assertLess(cos(self.bge.embed_text(self.a), self.bge.embed_text(self.b)), 0.99)

    def test_bge_ranks_the_passage_containing_the_answer_first(self):
        q = self.bge.embed_query("how much is the late fee per day")
        self.assertGreater(cos(q, self.bge.embed_text(self.a)), cos(q, self.bge.embed_text(self.b)))
        # CLIP sees the two passages as the same text, so it cannot rank them at all
        qc = self.clip.embed_query("how much is the late fee per day")
        self.assertAlmostEqual(cos(qc, self.clip.embed_text(self.a)), cos(qc, self.clip.embed_text(self.b)), places=5)


class TestClipBackendStillWorks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.clip = es._ClipEmbedder(Config.CLIP_MODEL_NAME)

    def test_shape_and_normalisation(self):
        v = self.clip.embed_text("hello campus")
        self.assertEqual(v.shape, (512,))
        self.assertEqual(self.clip.dimension, 512)
        self.assertAlmostEqual(float(np.linalg.norm(v)), 1.0, places=4)
        self.assertTrue(self.clip.supports_images)

    def test_query_equals_document_for_clip(self):
        self.assertTrue(np.allclose(self.clip.embed_query("fees"), self.clip.embed_text("fees")))

    def test_batch(self):
        self.assertEqual(self.clip.embed_texts(["a", "b", "c"]).shape, (3, 512))

    def test_matches_the_library_api_when_it_returns_tensors(self):
        """Our version-independent route must equal get_text_features / get_image_features."""
        import torch
        inputs = self.clip.processor(text="late fee for tuition", return_tensors="pt", padding=True, truncation=True, max_length=77)
        with torch.no_grad():
            api = self.clip.model.get_text_features(**inputs)
        if not isinstance(api, torch.Tensor):
            self.skipTest("this transformers version returns an output object; the manual route is the only one used")
        with torch.no_grad():
            manual = self.clip._text_features(inputs)
        self.assertTrue(torch.allclose(api, manual, atol=1e-5))


class TestBackendSelection(unittest.TestCase):
    def test_unknown_backend_is_rejected_with_a_clear_message(self):
        with self.assertRaises(ValueError) as ctx:
            es._build_backend("word2vec")
        self.assertIn("bge-small", str(ctx.exception))

    def test_default_backend_is_bge(self):
        self.assertEqual(Config.EMBEDDING_BACKEND, "bge-small")
        self.assertEqual(es.embedding_service.backend, "bge-small")
        self.assertEqual(es.embedding_service.dimension, 384)


if __name__ == "__main__":
    unittest.main()
