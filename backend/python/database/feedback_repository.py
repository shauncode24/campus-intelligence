"""
Answer feedback (thumbs up/down) with the context needed to learn from it.

A rating on its own says little. Each feedback row therefore keeps the question, the answer and
exactly which passages (chunk ids) and documents it was built from, plus why the user was unhappy.
Those rows are the cheapest source of real evaluation cases and of failure analysis: a 👎 with
"the answer was in the documents" points at retrieval; a 👎 on an answer with no sources points at
the refusal rule; and so on.

One row per (user, answer message): rating again replaces it, rating "none" removes it.
Rows are private to the backend (clients cannot read or write the collection: see firestore.rules).
"""
from firebase_admin import firestore

from config import Config
from database.firebase_client import firebase_client
from services.embedding_service import embedding_service
from utils.threads import offload_async_methods


@offload_async_methods
class FeedbackRepository:
    @staticmethod
    async def set_feedback(user_id: str, message_id: str, rating, reason=None, comment=None):
        """
        Record, change or remove (rating=None) the user's rating of one answer.

        Returns {"rating": ..., "messageId": ...} or None when the message does not exist, is not
        an answer, or is in a chat the user does not own (the same "not found" for all three, so a
        message id reveals nothing).
        """
        db = firebase_client.db
        if not db:
            raise RuntimeError("Firebase not available")

        msg_ref = db.collection("chat_messages").document(message_id)
        msg = msg_ref.get()
        if not msg.exists:
            return None
        msg_data = msg.to_dict() or {}
        if msg_data.get("role") != "bot":
            return None
        chat = db.collection("chats").document(msg_data.get("chatId") or "-").get()
        if not chat.exists or (chat.to_dict() or {}).get("userId") != user_id:
            return None

        feedback_ref = db.collection("feedback").document(message_id)
        batch = db.batch()

        if rating is None:
            if feedback_ref.get().exists:
                batch.delete(feedback_ref)
            batch.update(msg_ref, {"metadata.feedback": firestore.DELETE_FIELD})
            batch.commit()
            return {"rating": None, "messageId": message_id}

        meta = msg_data.get("metadata") or {}
        sources = meta.get("sources") or []

        # The question as the user typed it lives on the history entry linked to this answer
        question = None
        history_id = meta.get("historyId")
        if history_id:
            history = db.collection("user_questions").document(history_id).get()
            if history.exists and (history.to_dict() or {}).get("userId") == user_id:
                question = history.to_dict().get("questionText")

        now = firestore.SERVER_TIMESTAMP
        batch.set(feedback_ref, {
            "userId": user_id,
            "chatId": msg_data.get("chatId"),
            "messageId": message_id,
            "historyId": history_id,
            "rating": rating,
            "reason": reason if rating == "down" else None,
            "comment": (comment or "").strip() or None,
            # what was asked and answered
            "question": question,
            "standaloneQuestion": meta.get("standaloneQuestion"),
            "answer": msg_data.get("content"),
            "answered": meta.get("answered") is not False,
            "cached": bool(meta.get("cached")),
            # exactly what the answer was built from
            "sources": [
                {
                    "documentId": s.get("documentId"),
                    "documentName": s.get("documentName"),
                    "version": s.get("version"),
                    "displayPage": s.get("displayPage"),
                    "chunkId": s.get("chunkId"),
                    "similarity": s.get("similarity"),
                }
                for s in sources
            ],
            "documentIds": sorted({s.get("documentId") for s in sources if s.get("documentId")}),
            "chunkIds": [s.get("chunkId") for s in sources if s.get("chunkId")],
            # what produced it
            "llmModel": Config.GEMINI_MODEL_NAME,
            "embeddingModel": embedding_service.model_id,
            "createdAt": now,
            "updatedAt": now,
        })
        batch.update(msg_ref, {"metadata.feedback": rating})
        batch.commit()
        return {"rating": rating, "messageId": message_id}


feedback_repository = FeedbackRepository()
