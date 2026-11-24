"""
Configuration and environment variables for the RAG service
"""
import os
from dotenv import load_dotenv

# Secrets normally come from backend/.env. To keep them out of a synced project
# folder (OneDrive/Dropbox), set ENV_FILE to the full path of an env file stored
# elsewhere. If it is set but missing we stop rather than run without secrets.
_env_file = os.getenv("ENV_FILE")
if _env_file:
    if not os.path.isfile(_env_file):
        raise RuntimeError(f"ENV_FILE is set to {_env_file!r} but that file does not exist")
    load_dotenv(_env_file)
else:
    load_dotenv()

def _int_env(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


class Config:
    # Firebase Configuration
    FIREBASE_PROJECT_ID = os.getenv("FIREBASE_PROJECT_ID")
    FIREBASE_PRIVATE_KEY_ID = os.getenv("FIREBASE_PRIVATE_KEY_ID")
    FIREBASE_PRIVATE_KEY = os.getenv("FIREBASE_PRIVATE_KEY", "").replace("\\n", "\n")
    FIREBASE_CLIENT_EMAIL = os.getenv("FIREBASE_CLIENT_EMAIL")
    FIREBASE_CLIENT_ID = os.getenv("FIREBASE_CLIENT_ID")
    FIREBASE_CLIENT_X509_CERT_URL = os.getenv("FIREBASE_CLIENT_X509_CERT_URL")
    
    # Google AI Configuration
    GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
    
    # Model Configuration
    # Embedding backend: "bge-small" (default, text retrieval model) or "clip"
    # (the original embedder, kept for comparison). Vectors from different
    # backends are not comparable, so changing this means re-processing every
    # document (see scripts/reindex_all.py).
    EMBEDDING_BACKEND = os.getenv("EMBEDDING_BACKEND", "bge-small").strip().lower()
    BGE_MODEL_NAME = "BAAI/bge-small-en-v1.5"
    CLIP_MODEL_NAME = "openai/clip-vit-base-patch32"

    # Image search. Images are embedded with CLIP and searched with a CLIP
    # embedding of the question (a different similarity scale from text), so
    # they get their own ranking and relevance floor. Retrieved images are
    # re-extracted from the PDF and shown to Gemini as pixels.
    IMAGE_RETRIEVAL = os.getenv("IMAGE_RETRIEVAL", "true").lower() in ("1", "true", "yes")
    IMAGE_TOP_K = int(os.getenv("IMAGE_TOP_K", "3"))
    # In-memory vector index (services/vector_index.py). Above this many chunks (~1.5 KB each) the
    # service falls back to scanning Firestore per question and says so in the log; 0 = no cap.
    VECTOR_INDEX_MAX_CHUNKS = int(os.getenv("VECTOR_INDEX_MAX_CHUNKS", "150000"))
    VECTOR_INDEX_ENABLED = os.getenv("VECTOR_INDEX_ENABLED", "true").lower() != "false"

    # Image captioning: at upload, Gemini describes each meaningful image and the
    # description is indexed as text (same similarity scale as normal text). This
    # costs ONE Gemini call per captioned image, bounded by the limits below.
    # If a caption fails or captioning is off, the image falls back to CLIP.
    IMAGE_CAPTIONING = os.getenv("IMAGE_CAPTIONING", "true").lower() in ("1", "true", "yes")
    MAX_IMAGES_PER_DOCUMENT = int(os.getenv("MAX_IMAGES_PER_DOCUMENT", "30"))
    # Smaller images (icons, bullets, logos) are not indexed. PROVISIONAL values.
    MIN_IMAGE_SIDE = int(os.getenv("MIN_IMAGE_SIDE", "120"))
    MIN_IMAGE_PIXELS = int(os.getenv("MIN_IMAGE_PIXELS", "20000"))
    MIN_IMAGE_SCORE = float(os.getenv("MIN_IMAGE_SCORE", "0.26"))
    GEMINI_MODEL_NAME = "gemini-2.5-flash"
    # Identical questions asked at the same moment share one model call (utils/single_flight.py)
    SINGLE_FLIGHT = os.getenv("SINGLE_FLIGHT", "true").lower() != "false"
    SINGLE_FLIGHT_WAIT_SECONDS = float(os.getenv("SINGLE_FLIGHT_WAIT_SECONDS", "120"))
    GEMINI_TEMPERATURE = 0.2
    # Used only to ESTIMATE the cost shown in the metrics (US dollars per million tokens). These are
    # the list prices I knew for gemini-2.5-flash and may be out of date: check the current price
    # and set the env vars. They never affect behaviour.
    GEMINI_PRICE_IN_PER_MTOK = float(os.getenv("GEMINI_PRICE_IN_PER_MTOK", "0.30"))
    GEMINI_PRICE_OUT_PER_MTOK = float(os.getenv("GEMINI_PRICE_OUT_PER_MTOK", "2.50"))
    
    # RAG Configuration
    CHUNK_SIZE = 500
    CHUNK_OVERLAP = 100
    TOP_K_RETRIEVAL = 5

    # Relevance floor for TEXT chunks (raw cosine similarity). Chunks below it
    # are not given to the model; if none remain the question is declined
    # without calling the LLM. NOTE: CLIP text-to-text similarity separates
    # relevant from irrelevant text only weakly, so this is a coarse safety
    # floor, not the main defence (that is the grounded prompt + refusal).
    # Tune it on a real evaluation set (audit P1-1) via the env var.
    # The right floor depends on the embedding model (each has its own score
    # scale), so the default is per backend. bge: 0.50 sits below the lowest
    # answerable top score seen on the (synthetic, easy) demo set (0.59) with
    # margin; clip: 0.70 as before. Both are PROVISIONAL until measured on a real
    # question set (eval/). Override with the MIN_RETRIEVAL_SCORE env var.
    MIN_RETRIEVAL_SCORE = float(os.getenv(
        "MIN_RETRIEVAL_SCORE",
        {"bge-small": "0.50", "clip": "0.70"}.get(EMBEDDING_BACKEND, "0.50"),
    ))

    # Shown to the user when the documents do not contain the answer
    NO_ANSWER_MESSAGE = (
        "I couldn't find this in the uploaded campus documents, so I can't "
        "answer it reliably. Please check with the relevant office, or try "
        "rephrasing your question."
    )
    # Answer cache. Reuse is EXACT-question only by default. Matching a *different* question by
    # embedding similarity is off: on labelled pairs no threshold separated paraphrases from
    # near-duplicates needing another answer (eval/results/cache-threshold-bge-small.md).
    CACHE_SEMANTIC_MATCH = os.getenv("CACHE_SEMANTIC_MATCH", "false").lower() in ("1", "true", "yes")
    CACHE_SEMANTIC_THRESHOLD = float(os.getenv("CACHE_SEMANTIC_THRESHOLD", "0.95"))
    CACHE_MAX_CANDIDATES = int(os.getenv("CACHE_MAX_CANDIDATES", "500"))
    CACHE_TTL_DAYS = int(os.getenv("CACHE_TTL_DAYS", "30"))   # 0 = never expires
    
    # Document file safety (SSRF / resource limits)
    # Exact hostnames the server may download documents from (comma-separated
    # env var). Defaults to this project's Supabase storage host.
    ALLOWED_FILE_HOSTS = [
        h.strip().lower()
        for h in os.getenv(
            "ALLOWED_FILE_HOSTS", "qqdonjhgvuyjfusplexf.supabase.co"
        ).split(",")
        if h.strip()
    ]
    MAX_PDF_BYTES = int(os.getenv("MAX_PDF_BYTES", str(50 * 1024 * 1024)))
    MAX_PDF_PAGES = int(os.getenv("MAX_PDF_PAGES", "500"))
    DOWNLOAD_TIMEOUT_SECONDS = int(os.getenv("DOWNLOAD_TIMEOUT_SECONDS", "60"))

    # CORS: only the web app's own origin(s). Set CORS_ORIGINS (comma-separated)
    # or FRONTEND_URL in backend/.env; defaults to the local dev server.
    CORS_ORIGINS = [
        o.strip().rstrip("/")
        for o in (os.getenv("CORS_ORIGINS") or os.getenv("FRONTEND_URL") or "http://localhost:5173").split(",")
        if o.strip()
    ]

    # Behind a reverse proxy the client IP is in X-Forwarded-For. Only enable
    # this when a trusted proxy sets that header, otherwise it can be spoofed.
    TRUST_PROXY = os.getenv("TRUST_PROXY", "").lower() in ("1", "true", "yes")

    # The Node API forwards each student's real IP in `X-Client-IP` (without it every student
    # looks like the Node server and shares one rate-limit bucket). That header is believed
    # ONLY when the direct caller is one of these addresses; from anyone else it is ignored.
    # Default: this machine. In Docker, add the Node container's address or network.
    TRUSTED_PROXY_IPS = [
        ip.strip() for ip in os.getenv("TRUSTED_PROXY_IPS", "127.0.0.1,::1").split(",") if ip.strip()
    ]

    # Rate limits (requests per minute unless stated). 0 disables a limit.
    # These are starting points, not tuned values: adjust to real traffic.
    # Per-IP limits are deliberately generous because a whole campus can share
    # one public IP; the per-user limits are the real control.
    IP_RATE_PER_MINUTE = _int_env("IP_RATE_PER_MINUTE", 600)
    USER_RATE_PER_MINUTE = _int_env("USER_RATE_PER_MINUTE", 120)
    WRITE_RATE_PER_MINUTE = _int_env("WRITE_RATE_PER_MINUTE", 60)
    QUERY_RATE_PER_MINUTE = _int_env("QUERY_RATE_PER_MINUTE", 10)
    QUERY_RATE_PER_MINUTE_PER_IP = _int_env("QUERY_RATE_PER_MINUTE_PER_IP", 60)
    ADMIN_RATE_PER_MINUTE = _int_env("ADMIN_RATE_PER_MINUTE", 120)

    # Daily LLM budget: calls that actually reach the model (cache hits and
    # refusals are free). The global cap bounds spend even if someone creates
    # many (free) accounts.
    LLM_CALLS_PER_USER_PER_DAY = _int_env("LLM_CALLS_PER_USER_PER_DAY", 100)
    LLM_CALLS_GLOBAL_PER_DAY = _int_env("LLM_CALLS_GLOBAL_PER_DAY", 3000)

    # Input size limits
    MAX_QUESTION_CHARS = _int_env("MAX_QUESTION_CHARS", 2000)

    # Follow-up questions: the last few chat turns are used to rewrite a question
    # like "and the deadline?" into a standalone one (one cheap model call, only
    # when the question looks like it depends on earlier turns).
    QUERY_CONDENSING = os.getenv("QUERY_CONDENSING", "true").lower() in ("1", "true", "yes")
    MAX_HISTORY_MESSAGES = _int_env("MAX_HISTORY_MESSAGES", 6)
    # Documents processed at the same time. Parsing/embedding is CPU-heavy; one at a time
    # keeps question answering responsive. Further uploads wait in a queue.
    MAX_CONCURRENT_INGESTS = _int_env("MAX_CONCURRENT_INGESTS", 1)
    
    @classmethod
    def get_firebase_credentials(cls):
        """Get Firebase service account credentials as dict"""
        return {
            "type": "service_account",
            "project_id": cls.FIREBASE_PROJECT_ID,
            "private_key_id": cls.FIREBASE_PRIVATE_KEY_ID,
            "private_key": cls.FIREBASE_PRIVATE_KEY,
            "client_email": cls.FIREBASE_CLIENT_EMAIL,
            "client_id": cls.FIREBASE_CLIENT_ID,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
            "client_x509_cert_url": cls.FIREBASE_CLIENT_X509_CERT_URL,
        }
    
    @classmethod
    def validate(cls):
        """Validate required environment variables"""
        required = [
            "FIREBASE_PROJECT_ID",
            "FIREBASE_PRIVATE_KEY",
            "FIREBASE_CLIENT_EMAIL",
            "GOOGLE_API_KEY"
        ]
        
        missing = [var for var in required if not getattr(cls, var)]
        
        if missing:
            raise ValueError(f"Missing required environment variables: {', '.join(missing)}")