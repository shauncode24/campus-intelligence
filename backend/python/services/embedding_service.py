"""
Embedding service: ONE text model for documents/questions, and CLIP for images.

TEXT (documents and questions) uses Config.EMBEDDING_BACKEND:
  bge-small (default)  BAAI/bge-small-en-v1.5, a retrieval model: 384 dimensions,
                       512-token input limit, English only, MIT licensed.
  clip                 openai/clip-vit-base-patch32, the original embedder. Kept
                       for comparison. Its text tower truncates input at 77
                       tokens, so most of a 500 character chunk was never embedded.

IMAGES always use CLIP (a text-only model cannot embed pixels). To find images
relevant to a question, the question is ALSO embedded with CLIP's text tower
(embed_image_query) and compared against the image vectors. Text and image
similarities live on different scales, so they are ranked and thresholded
separately (see retrieval_service).

Vectors from different models cannot be compared, so every stored vector is
tagged with its model id and ignored if it came from a different model.

Documents and questions are embedded differently on purpose (embed_text vs
embed_query): bge-v1.5 expects an instruction prefix on the question only.
"""
import numpy as np
import torch
from PIL import Image
from transformers import AutoModel, AutoTokenizer, CLIPModel, CLIPProcessor

from config import Config

# Prefix recommended by the model card for short questions searching long passages.
BGE_QUERY_INSTRUCTION = "Represent this sentence for searching relevant passages: "
BGE_MAX_TOKENS = 512          # the model's input limit (sentence_bert_config.json)
CLIP_MAX_TOKENS = 77          # CLIP's text-tower limit
ENCODE_BATCH_SIZE = 32


class _BgeEmbedder:
    """BAAI/bge-small-en-v1.5 via plain transformers: CLS pooling + L2 normalisation
    (exactly the pipeline in the model's modules.json / 1_Pooling config)."""

    backend = "bge-small"
    supports_images = False
    max_tokens = BGE_MAX_TOKENS

    def __init__(self, model_name: str):
        self.model_id = model_name
        self.tokenizer = AutoTokenizer.from_pretrained(model_name)
        self.model = AutoModel.from_pretrained(model_name, use_safetensors=True)
        self.model.eval()
        self.dimension = int(self.model.config.hidden_size)

    def _encode(self, texts):
        out = []
        for i in range(0, len(texts), ENCODE_BATCH_SIZE):
            batch = texts[i:i + ENCODE_BATCH_SIZE]
            inputs = self.tokenizer(
                batch, padding=True, truncation=True,
                max_length=self.max_tokens, return_tensors="pt",
            )
            with torch.no_grad():
                cls = self.model(**inputs).last_hidden_state[:, 0]
                cls = torch.nn.functional.normalize(cls, p=2, dim=1)
            out.append(cls.numpy())
        return np.concatenate(out, axis=0) if out else np.zeros((0, self.dimension), dtype=np.float32)

    def embed_texts(self, texts):
        """Embed document passages (no instruction). Returns an (n, dim) array."""
        return self._encode(list(texts))

    def embed_text(self, text):
        return self._encode([text])[0]

    def embed_query(self, text):
        """Embed a user question (with the retrieval instruction prefix)."""
        return self._encode([BGE_QUERY_INSTRUCTION + text])[0]

    def embed_image(self, image_data):
        raise NotImplementedError("The bge backend is text-only")


class _ClipEmbedder:
    """The CLIP embedder (text and images)."""

    backend = "clip"
    supports_images = True
    max_tokens = CLIP_MAX_TOKENS

    def __init__(self, model_name: str):
        self.model_id = model_name
        self.model = CLIPModel.from_pretrained(model_name)
        self.processor = CLIPProcessor.from_pretrained(model_name)
        self.model.eval()
        self.dimension = int(self.model.config.projection_dim)

    # CLIP's get_text_features / get_image_features return a tensor in some
    # transformers versions and an output object in others (5.x). These two
    # helpers compute the same thing from the documented parts (encoder, then
    # projection), which is identical across versions (verified against the API
    # in both 4.57 and 5.24).
    def _text_features(self, inputs):
        pooled = self.model.text_model(
            input_ids=inputs["input_ids"], attention_mask=inputs.get("attention_mask")
        ).pooler_output
        return self.model.text_projection(pooled)

    def _image_features(self, inputs):
        pooled = self.model.vision_model(pixel_values=inputs["pixel_values"]).pooler_output
        return self.model.visual_projection(pooled)

    def embed_image(self, image_data):
        image = Image.open(image_data).convert("RGB") if isinstance(image_data, str) else image_data
        inputs = self.processor(images=image, return_tensors="pt")
        with torch.no_grad():
            features = self._image_features(inputs)
            features = features / features.norm(dim=-1, keepdim=True)
            return features.squeeze().numpy()

    def embed_text(self, text):
        inputs = self.processor(
            text=text, return_tensors="pt", padding=True,
            truncation=True, max_length=self.max_tokens,
        )
        with torch.no_grad():
            features = self._text_features(inputs)
            features = features / features.norm(dim=-1, keepdim=True)
            return features.squeeze().numpy()

    def embed_texts(self, texts):
        return np.stack([self.embed_text(t) for t in texts]) if texts else np.zeros((0, self.dimension))

    def embed_query(self, text):
        return self.embed_text(text)


def _build_text_backend(name: str):
    if name == "bge-small":
        return _BgeEmbedder(Config.BGE_MODEL_NAME)
    if name == "clip":
        return _ClipEmbedder(Config.CLIP_MODEL_NAME)
    raise ValueError(f"Unknown EMBEDDING_BACKEND {name!r}; expected 'bge-small' or 'clip'")


# kept for tests / callers that build a backend directly
_build_backend = _build_text_backend


class EmbeddingService:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(EmbeddingService, cls).__new__(cls)
            cls._instance._initialize()
        return cls._instance

    def _initialize(self):
        print(f"🔄 Loading embedding models (text: {Config.EMBEDDING_BACKEND})...")
        self._text = _build_text_backend(Config.EMBEDDING_BACKEND)
        if self._text.backend == "clip":
            self._clip = self._text                      # one CLIP instance serves both
        elif Config.IMAGE_RETRIEVAL:
            self._clip = _ClipEmbedder(Config.CLIP_MODEL_NAME)
        else:
            self._clip = None
        images = f", images: {self._clip.model_id}" if self._clip else ", images: disabled"
        print(f"✅ Embedding models loaded: text {self._text.model_id} ({self._text.dimension}-d){images}")

    # ---- identity (stored with every vector) ----
    @property
    def backend(self):
        return self._text.backend

    @property
    def model_id(self):
        """Id of the TEXT model (the one used for document and question vectors)."""
        return self._text.model_id

    @property
    def dimension(self):
        return self._text.dimension

    @property
    def max_tokens(self):
        return self._text.max_tokens

    @property
    def supports_images(self):
        return self._clip is not None

    @property
    def image_model_id(self):
        return self._clip.model_id if self._clip else None

    # ---- text ----
    def embed_text(self, text):
        """Embed ONE document passage. Returns a 1-D normalised vector."""
        return self._text.embed_text(text)

    def embed_texts(self, texts):
        """Embed many document passages in batches. Returns an (n, dim) array."""
        return self._text.embed_texts(texts)

    def embed_query(self, text):
        """Embed a user question for searching document TEXT."""
        return self._text.embed_query(text)

    # ---- images ----
    def embed_image(self, image_data):
        if not self._clip:
            raise NotImplementedError("Image embedding is disabled (IMAGE_RETRIEVAL=false)")
        return self._clip.embed_image(image_data)

    def embed_image_query(self, text):
        """Embed a user question in CLIP space, to search IMAGE vectors."""
        if not self._clip:
            raise NotImplementedError("Image embedding is disabled (IMAGE_RETRIEVAL=false)")
        return self._clip.embed_text(text)

    @staticmethod
    def cosine_similarity(a, b):
        """Cosine similarity between two vectors"""
        return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))


# Singleton instance
embedding_service = EmbeddingService()
