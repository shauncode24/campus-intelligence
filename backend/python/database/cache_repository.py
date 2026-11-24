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
        """
        if threshold is None:
            threshold = Config.SIMILARITY_THRESHOLD
        
        db = firebase_client.db
        if not db:
            print("⚠️ Firebase not available for cache lookup")
            return None
        
        try:
            fingerprint = CacheRepository.question_fingerprint(question)
            entities = extract_entities(question)
            
            print(f"🔍 Looking for cache hit - Fingerprint: {fingerprint[:8]}...")
            
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
            candidates_checked = 0
            
            for doc in candidates:
                candidates_checked += 1
                data = doc.to_dict()
                if "embedding" not in data:
                    continue
                
                # Vectors from another embedding model are not comparable
                if (data.get("embeddingModel") or Config.CLIP_MODEL_NAME) != embedding_service.model_id:
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
            
            print(f"📊 Checked {candidates_checked} candidates with intent '{intent}'")
            
            if best_match:
                print(f"✅ Entity-aware cache hit (similarity: {best_match['similarity']:.3f})")
                return best_match
            
            print("🔍 No suitable cache hit found")
            return None
            
        except Exception as e:
            print(f"❌ Error finding similar question: {e}")
            return None
    
    @staticmethod
    async def store_question(question: str, embedding, answer: str, intent: str, 
                            confidence: dict, sources: list, deadline=None):
        """
        Store new question in cache with proper confidence data
        """
        db = firebase_client.db
        if not db:
            print("⚠️ Firebase not available for storing question")
            return None
        
        try:
            fingerprint = CacheRepository.question_fingerprint(question)
            entities = extract_entities(question)
            
            # Ensure confidence has all required fields
            if not confidence:
                confidence = {"level": "Low", "score": 0, "reasoning": "No confidence data"}
            
            question_data = {
                "question": question,
                "fingerprint": fingerprint,
                "entities": entities,
                "embedding": embedding.tolist(),
                "embeddingModel": embedding_service.model_id,
                "answer": answer,
                "intent": intent,
                "confidence": {
                    "level": confidence.get("level", "Low"),
                    "score": confidence.get("score", 0),
                    "reasoning": confidence.get("reasoning", "")
                },
                "sources": sources,
                "deadline": deadline,
                "count": 1,
                "createdAt": firestore.SERVER_TIMESTAMP,
                "lastAskedAt": firestore.SERVER_TIMESTAMP,
            }
            
            print(f"💾 Storing question with confidence: {confidence.get('level')} ({confidence.get('score')}%)")
            
            doc_ref = db.collection("questions").add(question_data)
            question_id = doc_ref[1].id
            print(f"✅ Question stored with ID: {question_id}")
            return question_id
            
        except Exception as e:
            print(f"❌ Error storing question: {e}")
            return None
    
    @staticmethod
    async def increment_question_count(question_id: str):
        """Increment count for cached question"""
        db = firebase_client.db
        if not db:
            print("⚠️ Firebase not available for incrementing count")
            return
        
        try:
            doc_ref = db.collection('questions').document(question_id)
            doc_ref.update({
                'count': firestore.Increment(1),
                'lastAskedAt': firestore.SERVER_TIMESTAMP,
            })
            print(f"📈 Incremented count for question: {question_id}")
        except Exception as e:
            print(f"❌ Error incrementing question count: {e}")
    
    @staticmethod
    async def store_user_question(user_id: str, question_id: str, question_text: str, 
                                   answer: str = None, intent: str = None, 
                                   confidence: dict = None, sources: list = None,
                                   favorite: bool = False, personal_note: str = None):
        """Store user question in history with full data including favorite status and notes"""
        db = firebase_client.db
        if not db:
            print("⚠️ Firebase not available for storing user question")
            return None
        
        try:
            user_question_data = {
                'userId': user_id,
                'questionId': question_id,
                'questionText': question_text,
                'answer': answer,
                'intent': intent,
                'confidence': confidence,
                'sources': sources or [],
                'favorite': favorite,
                'personalNote': personal_note or "",
                'askedAt': firestore.SERVER_TIMESTAMP,
            }
            
            doc_ref = db.collection('user_questions').add(user_question_data)
            print(f"📝 Stored user question history for user: {user_id}, history ID: {doc_ref[1].id}")
            return doc_ref[1].id
        except Exception as e:
            print(f"❌ Error storing user question: {e}")
            return None
    
    @staticmethod
    async def toggle_favorite(user_id: str, history_id: str):
        """Toggle favorite status for a user question"""
        db = firebase_client.db
        if not db:
            print("⚠️ Firebase not available for toggling favorite")
            return None
        
        try:
            doc_ref = db.collection('user_questions').document(history_id)
            doc = doc_ref.get()
            
            if not doc.exists:
                print(f"⚠️ History item {history_id} not found")
                return None
            
            doc_data = doc.to_dict()
            if doc_data.get('userId') != user_id:
                print(f"⚠️ User {user_id} not authorized to modify history {history_id}")
                return None
            
            current_favorite = doc_data.get('favorite', False)
            new_favorite = not current_favorite
            
            # The answer message in the chat shows the same state after a reload, so
            # both are changed together.
            # (The chat may have been deleted since; the favourite still works then.)
            message_id = doc_data.get('messageId')
            message_ref = db.collection('chat_messages').document(message_id) if message_id else None
            if message_ref is not None and message_ref.get().exists:
                batch = db.batch()
                batch.update(doc_ref, {'favorite': new_favorite})
                batch.update(message_ref, {'metadata.favorite': new_favorite})
                batch.commit()
            else:
                doc_ref.update({'favorite': new_favorite})
            print(f"⭐ Toggled favorite for {history_id}: {new_favorite}")
            return new_favorite
            
        except Exception as e:
            print(f"❌ Error toggling favorite: {e}")
            return None
    
    @staticmethod
    async def update_personal_note(user_id: str, history_id: str, note: str):
        """Update personal note for a user question"""
        db = firebase_client.db
        if not db:
            print("⚠️ Firebase not available for updating note")
            return False
        
        try:
            doc_ref = db.collection('user_questions').document(history_id)
            doc = doc_ref.get()
            
            if not doc.exists:
                print(f"⚠️ History item {history_id} not found")
                return False
            
            doc_data = doc.to_dict()
            if doc_data.get('userId') != user_id:
                print(f"⚠️ User {user_id} not authorized to modify history {history_id}")
                return False
            
            doc_ref.update({
                'personalNote': note,
                'noteUpdatedAt': firestore.SERVER_TIMESTAMP
            })
            print(f"📝 Updated note for history {history_id}")
            return True
            
        except Exception as e:
            print(f"❌ Error updating note: {e}")
            return False
    
    @staticmethod
    async def delete_user_question(user_id: str, history_id: str):
        """Delete a specific question from user's history"""
        db = firebase_client.db
        if not db:
            print("⚠️ Firebase not available for deleting user question")
            return False
        
        try:
            doc_ref = db.collection('user_questions').document(history_id)
            doc = doc_ref.get()
            
            if not doc.exists:
                print(f"⚠️ History item {history_id} not found")
                return False
            
            doc_data = doc.to_dict()
            if doc_data.get('userId') != user_id:
                print(f"⚠️ User {user_id} not authorized to delete history {history_id}")
                return False
            
            doc_ref.delete()
            print(f"🗑️ Deleted history item {history_id} for user {user_id}")
            return True
            
        except Exception as e:
            print(f"❌ Error deleting user question: {e}")
            return False
    
    @staticmethod
    async def get_user_history(user_id: str, limit: int = 20, favorites_only: bool = False):
        """Get user's question history with proper data including personal notes"""
        db = firebase_client.db
        if not db:
            print("⚠️ Firebase not available for getting user history")
            return []
        
        try:
            print(f"📖 Fetching history for user: {user_id} (limit: {limit}, favorites_only: {favorites_only})")
            
            query = db.collection('user_questions').where('userId', '==', user_id)
            
            # Filter for favorites if requested
            if favorites_only:
                query = query.where('favorite', '==', True)
            
            query = query.order_by('askedAt', direction=firestore.Query.DESCENDING).limit(limit)
            
            user_questions = query.stream()
            
            history = []
            for doc in user_questions:
                data = doc.to_dict()
                
                history_item = {
                    "id": doc.id,
                    "questionText": data.get('questionText'),
                    "answer": data.get('answer', 'Answer not found'),
                    "intent": data.get('intent', 'general'),
                    "confidence": data.get('confidence'),
                    "sources": data.get('sources', []),
                    "favorite": data.get('favorite', False),
                    "personalNote": data.get('personalNote', ''),
                    "askedAt": data.get('askedAt'),
                }
                
                history.append(history_item)
            
            print(f"✅ Retrieved {len(history)} history items for user {user_id}")
            return history
            
        except Exception as e:
            # Not swallowed: an empty history must mean "nothing asked yet", never
            # "the query failed" (typically a missing Firestore index).
            print(f"❌ Error fetching user history: {e}")
            print("   If this is an 'index' error, create the composite index: collection user_questions, "
                  "userId (Ascending), askedAt (Descending)"
                  + ("; and userId, favorite, askedAt (Descending)" if favorites_only else ""))
            raise

# Singleton instance
cache_repository = CacheRepository()