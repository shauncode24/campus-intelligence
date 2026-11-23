"""
Configuration and environment variables for the RAG service
"""
import os
from dotenv import load_dotenv

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
    CLIP_MODEL_NAME = "openai/clip-vit-base-patch32"
    GEMINI_MODEL_NAME = "gemini-2.5-flash"
    GEMINI_TEMPERATURE = 0.2
    
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
    MIN_RETRIEVAL_SCORE = float(os.getenv("MIN_RETRIEVAL_SCORE", "0.70"))

    # Shown to the user when the documents do not contain the answer
    NO_ANSWER_MESSAGE = (
        "I couldn't find this in the uploaded campus documents, so I can't "
        "answer it reliably. Please check with the relevant office, or try "
        "rephrasing your question."
    )
    SIMILARITY_THRESHOLD = 0.90
    
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