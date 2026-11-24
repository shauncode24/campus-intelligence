"""
Question caching and history repository
"""
import re
import time
import hashlib
import numpy as np
from firebase_admin import firestore
from database.firebase_client import firebase_client
from utils.threads import offload_async_methods
from services.embedding_service import embedding_service
from utils.entity_extractor import extract_entities, entities_match
from config import Config

@offload_async_methods
class CacheRepository:
    @staticmethod
    def normalize_question(question: str) -> str:
        """Normalize question for fingerprint comparison"""
        # lower-case, drop punctuation, collapse runs of spaces/tabs/newlines
        return re.sub(r'\s+', ' ', re.sub(r'[^a-z0-9\s]+', '', question.lower())).strip()
    
    @staticmethod
    def question_fingerprint(question: str) -> str:
        """Generate fingerprint hash for question"""
        normalized = CacheRepository.normalize_question(question)
        return hashlib.sha256(normalized.encode()).hexdigest()
    
    @staticmethod
    def _is_fresh(data: dict, corpus_epoch: int) -> bool:
        """An entry may be served only if it was made under the current document set and has not aged out."""
        if data.get("corpusEpoch") != corpus_epoch:
            return False
        ttl_days = Config.CACHE_TTL_DAYS
        if ttl_days > 0:
            cached_at = data.get("cachedAtMs")
            if not isinstance(cached_at, (int, float)) or time.time() * 1000 - cached_at > ttl_days * 86400 * 1000:
                return False
        return True

    @staticmethod
    async def find_similar_question(question: str, question_embedding, intent: str,
                                    corpus_epoch: int, threshold: float = None):
        """
        Find a cached answer for this question.

        1. Exact match on the normalised question text (case, punctuation and spacing
           ignored). Always on; this is the safe path.
        2. Optional semantic match (Config.CACHE_SEMANTIC_MATCH, OFF by default): a different
           question whose vector is very close, with the same intent and the same entities
           (numbers, semester, programme, year). Off by default because on labelled pairs no
           similarity threshold separated paraphrases from near-duplicates that need a
           different answer (see eval/results/cache-threshold-bge-small.md).

        Either way the entry must come from the current `corpus_epoch` and be within the TTL.
        """
        if threshold is None:
            threshold = Config.CACHE_SEMANTIC_THRESHOLD

        db = firebase_client.db
        if not db:
            print("⚠️ Firebase not available for cache lookup")
            return None

        try:
            fingerprint = CacheRepository.question_fingerprint(question)

            # 1) exact: the entry's id IS the fingerprint, so this is one document read
            snap = db.collection("questions").document(fingerprint).get()
            if snap.exists:
                data = snap.to_dict()
                if CacheRepository._is_fresh(data, corpus_epoch):
                    print("♻️ Exact cache hit")
                    return {"id": snap.id, **data, "similarity": 1.0}
                print("♻️ Cached answer exists but is stale (documents changed or too old): ignored")

            if not Config.CACHE_SEMANTIC_MATCH or question_embedding is None:
                return None

            # 2) optional semantic match
            entities = extract_entities(question)
            candidates = db.collection("questions") \
                .where("intent", "==", intent) \
                .where("corpusEpoch", "==", corpus_epoch) \
                .limit(Config.CACHE_MAX_CANDIDATES) \
                .stream()

            best_match, highest = None, threshold
            for doc in candidates:
                data = doc.to_dict()
                if "embedding" not in data or not CacheRepository._is_fresh(data, corpus_epoch):
                    continue
                # Vectors from another embedding model are not comparable
                if (data.get("embeddingModel") or Config.CLIP_MODEL_NAME) != embedding_service.model_id:
                    continue
                # Any difference in a detail that changes the answer is a hard reject
                if not entities_match(entities, data.get("entities", {})):
                    continue
                similarity = embedding_service.cosine_similarity(question_embedding, np.array(data["embedding"]))
                if similarity > highest:
                    highest = similarity
                    best_match = {"id": doc.id, **data, "similarity": float(similarity)}

            if best_match:
                print(f"✅ Semantic cache hit (similarity: {best_match['similarity']:.3f})")
            return best_match

        except Exception as e:
            print(f"❌ Error finding cached answer: {e}")
            return None

    @staticmethod
    async def store_question(question: str, embedding, answer: str, intent: str,
                             confidence: dict, sources: list, deadline=None, corpus_epoch: int = 0):
        """
        Store an answer in the shared cache under the document set (`corpus_epoch`) it was
        produced from. One entry per distinct question: the entry id is the question's
        fingerprint, so storing again replaces the old (possibly stale) one.
        """
        db = firebase_client.db
        if not db:
            print("⚠️ Firebase not available for storing question")
            return None

        try:
            fingerprint = CacheRepository.question_fingerprint(question)

            if not confidence:
                confidence = {"level": "Low", "score": 0, "reasoning": "No confidence data"}

            question_data = {
                "question": question,
                "fingerprint": fingerprint,
                "entities": extract_entities(question),
                "embeddingModel": embedding_service.model_id,
                "answer": answer,
                "intent": intent,
                "confidence": {
                    "level": confidence.get("level", "Low"),
                    "score": confidence.get("score", 0),
                    "reasoning": confidence.get("reasoning", "")
                },
                "sources": sources,
                # flat list of the documents this answer cites (cheap to query / invalidate)
                "documentIds": sorted({s.get("documentId") for s in (sources or []) if s.get("documentId")}),
                "deadline": deadline,
                "count": 1,
                "corpusEpoch": corpus_epoch,
                "cachedAtMs": int(time.time() * 1000),
                "createdAt": firestore.SERVER_TIMESTAMP,
                "lastAskedAt": firestore.SERVER_TIMESTAMP,
            }
            # The vector is only needed for the optional semantic match
            if Config.CACHE_SEMANTIC_MATCH and embedding is not None:
                question_data["embedding"] = embedding.tolist()

            db.collection("questions").document(fingerprint).set(question_data)
            print(f"✅ Cached answer stored ({fingerprint[:8]}...)")
            return fingerprint

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