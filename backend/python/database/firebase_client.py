"""
Firebase client initialization and connection management
"""
import firebase_admin
from firebase_admin import credentials, firestore
from config import Config

class FirebaseClient:
    _instance = None
    _db = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(FirebaseClient, cls).__new__(cls)
            cls._instance._initialize()
        return cls._instance
    
    def _initialize(self):
        """Initialize Firebase Admin SDK"""
        try:
            cred = credentials.Certificate(Config.get_firebase_credentials())
            firebase_admin.initialize_app(cred)
            self._db = firestore.client()
            print("✅ Firebase initialized")
        except Exception as e:
            print(f"⚠️ Firebase initialization error: {e}")
            self._db = None
    
    @property
    def db(self):
        """Get Firestore database client"""
        return self._db
    
    @property
    def is_connected(self):
        """Check if Firebase is connected"""
        return self._db is not None

# Singleton instance
firebase_client = FirebaseClient()