"""
Question caching and history repository
"""
import re
import hashlib
import numpy as np
from firebase_admin import firestore
from database.firebase_client import firebase_client
from services.embedding_service import embedding_service
from utils.entity_extractor import extract_entities, entities_match
from config import Config

class CacheRepository:
    @staticmethod
    def normalize_question(question: str) -> str:
        """Normalize question for fingerprint comparison"""
        return re.sub(r'[^a-z0-9 ]+', '', question.lower()).strip()
    
    @staticmethod
    def question_fingerprint(question: str) -> str:
        """Generate fingerprint hash for question"""
        normalized = CacheRepository.normalize_question(question)
        return hashlib.sha256(normalized.encode()).hexdigest()
    
    @staticmethod
    async def find_similar_question(question: str, question_embedding, intent: str, 
                                    threshold: float = None):
        """
        Find cached similar question using fingerprint and semantic similarity
        
        Args:
            question: str - User question
            question_embedding: numpy.ndarray - Question embedding
            intent: str - Question intent
            threshold: float - Similarity threshold (default from config)
            
        Returns:
            Optional[Dict]: Cached question if found, None otherwise
        """
        if threshold is None:
            threshold = Config.SIMILARITY_THRESHOLD
        
        db = firebase_client.db
        if not db:
            return None
        
        try:
            fingerprint = CacheRepository.question_fingerprint(question)
            entities = extract_entities(question)
            
            # 1️⃣ FAST PATH - exact fingerprint match
            exact_match = db.collection("questions") \
                .where("fingerprint", "==", fingerprint) \
                .limit(1) \
                .stream()
            
            for doc in exact_match:
                data = doc.to_dict()
                print("♻️ Exact fingerprint cache hit")
                return {
                    "id": doc.id,
                    **data,
                    "similarity": 1.0
                }
            
            # 2️⃣ ENTITY-AWARE SEMANTIC MATCH
            candidates = db.collection("questions") \
                .where("intent", "==", intent) \
                .stream()
            
            best_match = None
            highest_similarity = threshold
            
            for doc in candidates:
                data = doc.to_dict()
                if "embedding" not in data:
                    continue
                
                # 🚫 Entity mismatch = hard reject
                if not entities_match(entities, data.get("entities", {})):
                    continue
                
                stored_embedding = np.array(data["embedding"])
                similarity = embedding_service.cosine_similarity(
                    question_embedding, 
                    stored_embedding
                )
                
                if similarity > highest_similarity:
                    highest_similarity = similarity
                    best_match = {
                        "id": doc.id,
                        **data,
                        "similarity": float(similarity)
                    }
            
            if best_match:
                print(f"✅ Entity-aware cache hit (similarity: {best_match['similarity']:.3f})")
                return best_match
            
            print("🔍 No suitable cache hit found", best_match['similarity'])
            return None
            
        except Exception as e:
            print(f"Error finding similar question: {e}")
            return None
    
    @staticmethod
    async def store_question(question: str, embedding, answer: str, intent: str, 
                            confidence: dict, sources: list, deadline=None):
        """
        Store new question in cache
        
        Args:
            question: str - Question text
            embedding: numpy.ndarray - Question embedding
            answer: str - Generated answer
            intent: str - Question intent
            confidence: dict - Confidence info
            sources: list - Source documents
            deadline: Optional[dict] - Deadline info
            
        Returns:
            Optional[str]: Question document ID
        """
        db = firebase_client.db
        if not db:
            return None
        
        try:
            fingerprint = CacheRepository.question_fingerprint(question)
            entities = extract_entities(question)
            
            question_data = {
                "question": question,
                "fingerprint": fingerprint,
                "entities": entities,
                "embedding": embedding.tolist(),
                "answer": answer,
                "intent": intent,
                "confidence": confidence,
                "sources": sources,
                "deadline": deadline,
                "count": 1,
                "createdAt": firestore.SERVER_TIMESTAMP,
                "lastAskedAt": firestore.SERVER_TIMESTAMP,
            }
            
            doc_ref = db.collection("questions").add(question_data)
            return doc_ref[1].id
            
        except Exception as e:
            print(f"Error storing question: {e}")
            return None
    
    @staticmethod
    async def increment_question_count(question_id: str):
        """Increment count for cached question"""
        db = firebase_client.db
        if not db:
            return
        
        try:
            doc_ref = db.collection('questions').document(question_id)
            doc_ref.update({
                'count': firestore.Increment(1),
                'lastAskedAt': firestore.SERVER_TIMESTAMP,
            })
            print(f"📈 Incremented count for question: {question_id}")
        except Exception as e:
            print(f"Error incrementing question count: {e}")
    
    @staticmethod
    async def store_user_question(user_id: str, question_id: str, question_text: str):
        """Store user question in history"""
        db = firebase_client.db
        if not db:
            return
        
        try:
            user_question_data = {
                'userId': user_id,
                'questionId': question_id,
                'questionText': question_text,
                'askedAt': firestore.SERVER_TIMESTAMP,
            }
            
            db.collection('user_questions').add(user_question_data)
            print(f"📝 Stored user question history for user: {user_id}")
        except Exception as e:
            print(f"Error storing user question: {e}")
    
    @staticmethod
    async def get_faq(limit: int = 10):
        """Get frequently asked questions"""
        db = firebase_client.db
        if not db:
            return []
        
        try:
            questions_ref = db.collection('questions') \
                .order_by('count', direction=firestore.Query.DESCENDING) \
                .limit(limit)
            questions = questions_ref.stream()
            
            faqs = []
            for doc in questions:
                data = doc.to_dict()
                faqs.append({
                    "id": doc.id,
                    "question": data.get('question'),
                    "answer": data.get('answer'),
                    "count": data.get('count', 0),
                    "intent": data.get('intent'),
                })
            
            return faqs
            
        except Exception as e:
            print(f"Error fetching FAQs: {e}")
            return []
    
    @staticmethod
    async def get_user_history(user_id: str, limit: int = 20):
        """Get user's question history"""
        db = firebase_client.db
        if not db:
            return []
        
        try:
            user_questions_ref = db.collection('user_questions') \
                .where('userId', '==', user_id) \
                .stream()
            
            history = []
            for doc in user_questions_ref:
                data = doc.to_dict()
                question_id = data.get('questionId')
                
                # Fetch full question details
                question_data = None
                if question_id:
                    try:
                        question_doc = db.collection('questions').document(question_id).get()
                        if question_doc.exists:
                            question_data = question_doc.to_dict()
                    except Exception as err:
                        print(f"Error fetching question details: {err}")
                
                history.append({
                    "id": doc.id,
                    "questionText": data.get('questionText'),
                    "answer": question_data.get('answer') if question_data else "Answer not found",
                    "askedAt": data.get('askedAt'),
                })
            
            # Sort by timestamp (descending)
            history.sort(key=lambda x: x.get('askedAt') or 0, reverse=True)
            
            return history[:limit]
            
        except Exception as e:
            print(f"Error fetching user history: {e}")
            return []

# Singleton instance
cache_repository = CacheRepository()