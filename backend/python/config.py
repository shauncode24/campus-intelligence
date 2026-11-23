"""
Configuration and environment variables for the RAG service
"""
import os
from dotenv import load_dotenv

load_dotenv()

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

    # CORS Configuration
    CORS_ORIGINS = ["*"]
    
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