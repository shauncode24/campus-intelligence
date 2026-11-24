"""
Chat repository for managing chat sessions
"""
from firebase_admin import firestore
from database.firebase_client import firebase_client
from utils.threads import offload_async_methods
from datetime import datetime, timedelta, timezone
from typing import List, Dict, Optional

@offload_async_methods
class ChatRepository:
    @staticmethod
    async def user_owns_chat(user_id: str, chat_id: str) -> bool:
        """
        Return True only if the chat exists AND belongs to user_id.

        Deliberately does not distinguish "missing" from "someone else's" so
        callers can answer both with the same 404 and not leak chat existence.
        Firestore errors propagate to the caller (they are NOT treated as
        "not owner").
        """
        db = firebase_client.db
        if not db:
            raise RuntimeError("Firebase not available")

        chat_doc = db.collection('chats').document(chat_id).get()
        if not chat_doc.exists:
            return False
        return chat_doc.to_dict().get('userId') == user_id

    @staticmethod
    async def create_chat(user_id: str, title: str = "New Chat") -> Optional[str]:
        """
        Create a new chat session
        
        Args:
            user_id: User identifier
            title: Chat title (default: "New Chat")
            
        Returns:
            str: Chat ID if successful, None otherwise
        """
        db = firebase_client.db
        if not db:
            print("⚠️ Firebase not available")
            return None
        
        try:
            chat_data = {
                'userId': user_id,
                'title': title,
                'createdAt': firestore.SERVER_TIMESTAMP,
                'updatedAt': firestore.SERVER_TIMESTAMP,
                'messageCount': 0
            }
            
            doc_ref = db.collection('chats').add(chat_data)
            chat_id = doc_ref[1].id
            print(f"✅ Chat created with ID: {chat_id}")
            return chat_id
            
        except Exception as e:
            print(f"❌ Error creating chat: {e}")
            return None
    
    @staticmethod
    async def get_user_chats(user_id: str, limit: int = 20) -> List[Dict]:
        """
        Get all chats for a user
        
        Args:
            user_id: User identifier
            limit: Maximum number of chats to return
            
        Returns:
            List[Dict]: List of chat objects
        """
        db = firebase_client.db
        if not db:
            print("⚠️ Firebase not available")
            return []
        
        try:
            query = db.collection('chats') \
                .where('userId', '==', user_id) \
                .order_by('updatedAt', direction=firestore.Query.DESCENDING) \
                .limit(limit)
            
            chats = query.stream()
            
            chat_list = []
            for chat in chats:
                chat_data = chat.to_dict()
                chat_list.append({
                    'id': chat.id,
                    'title': chat_data.get('title', 'New Chat'),
                    'createdAt': chat_data.get('createdAt'),
                    'updatedAt': chat_data.get('updatedAt'),
                    'messageCount': chat_data.get('messageCount', 0)
                })
            
            print(f"📋 Retrieved {len(chat_list)} chats for user {user_id}")
            return chat_list
            
        except Exception as e:
            print(f"❌ Error fetching chats: {e}")
            return []
    
    @staticmethod
    async def delete_chat(user_id: str, chat_id: str) -> bool:
        """
        Delete a chat and all its messages from Firebase
        
        Args:
            user_id: User identifier
            chat_id: Chat identifier
            
        Returns:
            bool: True if successful, False otherwise
        """
        db = firebase_client.db
        if not db:
            print("⚠️ Firebase not available")
            return False
        
        try:
            print(f"🗑️ Starting deletion of chat {chat_id} for user {user_id}")
            
            # Step 1: Verify the chat exists and belongs to the user
            chat_ref = db.collection('chats').document(chat_id)
            chat_doc = chat_ref.get()
            
            if not chat_doc.exists:
                print(f"⚠️ Chat {chat_id} not found")
                return False
            
            chat_data = chat_doc.to_dict()
            if chat_data.get('userId') != user_id:
                print(f"⚠️ User {user_id} not authorized to delete chat {chat_id}")
                return False
            
            print(f"✅ Chat verified, proceeding with deletion")
            
            # Step 2: Delete all messages in batches (Firebase batch limit is 500)
            messages_ref = db.collection('chat_messages').where('chatId', '==', chat_id)
            
            deleted_messages = 0
            while True:
                # Get messages in batches
                messages_batch = messages_ref.limit(500).stream()
                messages_list = list(messages_batch)
                
                if not messages_list:
                    break
                
                # Delete batch
                batch = db.batch()
                for msg in messages_list:
                    batch.delete(msg.reference)
                    deleted_messages += 1
                
                batch.commit()
                print(f"   Deleted {deleted_messages} messages so far...")
            
            print(f"✅ Deleted {deleted_messages} messages")
            
            # Step 3: Delete the chat document itself
            chat_ref.delete()
            print(f"✅ Deleted chat document {chat_id}")
            
            print(f"🎉 Successfully deleted chat {chat_id} with {deleted_messages} messages")
            return True
            
        except Exception as e:
            print(f"❌ Error deleting chat: {e}")
            import traceback
            traceback.print_exc()
            return False
    
    @staticmethod
    async def update_chat_title(user_id: str, chat_id: str, title: str) -> bool:
        """
        Update chat title
        
        Args:
            user_id: User identifier
            chat_id: Chat identifier
            title: New title
            
        Returns:
            bool: True if successful, False otherwise
        """
        db = firebase_client.db
        if not db:
            print("⚠️ Firebase not available")
            return False
        
        try:
            chat_ref = db.collection('chats').document(chat_id)
            chat_doc = chat_ref.get()
            
            if not chat_doc.exists:
                print(f"⚠️ Chat {chat_id} not found")
                return False
            
            chat_data = chat_doc.to_dict()
            if chat_data.get('userId') != user_id:
                print(f"⚠️ User {user_id} not authorized to update chat {chat_id}")
                return False
            
            chat_ref.update({
                'title': title,
                'updatedAt': firestore.SERVER_TIMESTAMP
            })
            
            print(f"✅ Updated chat {chat_id} title to: {title}")
            return True
            
        except Exception as e:
            print(f"❌ Error updating chat title: {e}")
            return False
    
    @staticmethod
    def derive_title(first_message: str) -> str:
        """A short chat title from the first question."""
        title = first_message[:50].split('?')[0].split('.')[0].strip()
        if len(title) < 3:
            title = first_message[:50].strip()
        if len(title) > 50:
            title = title[:47] + "..."
        return title or "New Chat"

    @staticmethod
    async def record_exchange(user_id: str, chat_id: str, question: str, answer: str,
                              metadata: Dict, history_extra: Dict, regenerated: bool = False) -> Dict:
        """
        Save one question and its answer: the ONLY place chat messages are written.

        One atomic batch holds the user message, the answer message, the entry in the
        user's question history (what the History and Saved pages list) and the chat's
        counters/title. Either all of it is stored or none is, and it happens on the
        server, so closing the tab mid-answer cannot leave the chat and the history
        disagreeing. Raises on failure: the caller must not report success.

        The answer message carries `historyId`, which is what "Save" and notes act on.
        Returns {"historyId", "messageId", "title"}.
        """
        db = firebase_client.db
        if not db:
            raise RuntimeError("Firebase not available")

        chat_ref = db.collection('chats').document(chat_id)
        chat = chat_ref.get()
        if not chat.exists or chat.to_dict().get('userId') != user_id:
            raise PermissionError("chat is not owned by this user")
        chat_data = chat.to_dict()

        # Explicit, distinct times (not SERVER_TIMESTAMP): inside one batch every server
        # timestamp is identical, which would let the answer sort before its question.
        asked_at = datetime.now(timezone.utc)
        answered_at = asked_at + timedelta(milliseconds=1)
        now_iso = answered_at.isoformat()
        user_msg_ref = db.collection('chat_messages').document()
        bot_msg_ref = db.collection('chat_messages').document()
        history_ref = db.collection('user_questions').document()

        bot_metadata = dict(metadata or {})
        bot_metadata['historyId'] = history_ref.id
        bot_metadata['messageId'] = bot_msg_ref.id     # what feedback is attached to
        bot_metadata['timestamp'] = now_iso
        bot_metadata['favorite'] = False

        batch = db.batch()
        # created in this order; the bot message sorts after the question
        batch.set(user_msg_ref, {
            'chatId': chat_id, 'userId': user_id, 'role': 'user', 'content': question,
            # `regenerated`: this "question" is the user pressing "try again", not a new question
            'metadata': {'timestamp': asked_at.isoformat(), **({'regenerated': True} if regenerated else {})},
            'createdAt': asked_at,
        })
        batch.set(bot_msg_ref, {
            'chatId': chat_id, 'userId': user_id, 'role': 'bot', 'content': answer,
            'metadata': bot_metadata, 'createdAt': answered_at,
        })
        batch.set(history_ref, {
            **history_extra,
            'userId': user_id, 'questionText': question, 'answer': answer,
            'favorite': False, 'personalNote': '',
            'chatId': chat_id, 'messageId': bot_msg_ref.id,
            'askedAt': firestore.SERVER_TIMESTAMP,
        })
        chat_update = {
            'updatedAt': firestore.SERVER_TIMESTAMP,
            'messageCount': firestore.Increment(2),
        }
        title = chat_data.get('title', 'New Chat')
        if not chat_data.get('messageCount'):
            title = ChatRepository.derive_title(question)
            chat_update['title'] = title
        batch.update(chat_ref, chat_update)
        batch.commit()

        return {"historyId": history_ref.id, "messageId": bot_msg_ref.id, "title": title}

    @staticmethod
    async def get_chat_messages(chat_id: str, limit: int = 100,
                                before: Optional[str] = None):
        """
        The NEWEST `limit` messages of a chat, oldest first (the order to display).

        Returns (messages, has_more). `before` is a message id: only messages older
        than it are returned, which is how a client pages further back. Firestore
        errors propagate (an unreadable chat is not an empty chat).
        """
        db = firebase_client.db
        if not db:
            raise RuntimeError("Firebase not available")

        query = db.collection('chat_messages')             .where('chatId', '==', chat_id)             .order_by('createdAt', direction=firestore.Query.DESCENDING)
        if before:
            anchor = db.collection('chat_messages').document(before).get()
            if anchor.exists and anchor.to_dict().get('chatId') == chat_id:
                query = query.start_after(anchor)
        docs = list(query.limit(limit + 1).stream())

        has_more = len(docs) > limit
        message_list = []
        for msg in reversed(docs[:limit]):
            msg_data = msg.to_dict()
            message_list.append({
                'id': msg.id,
                'role': msg_data.get('role'),
                'content': msg_data.get('content'),
                'metadata': msg_data.get('metadata', {}),
                'createdAt': msg_data.get('createdAt')
            })
        return message_list, has_more

    @staticmethod
    async def get_context_turns(chat_id: str, max_turns: int) -> List[Dict]:
        """
        The last few turns of a chat as {role, text}, for understanding follow-ups.
        Read from the server's own copy (never trusted from the browser). Refusals are
        left out: they are not information.
        """
        messages, _ = await ChatRepository.get_chat_messages(chat_id, max_turns * 3)
        turns = [
            {"role": m['role'], "text": m['content']}
            for m in messages
            if m.get('content') and not (m['role'] == 'bot' and (m.get('metadata') or {}).get('answered') is False)
        ]
        return turns[-max_turns:]

# Singleton instance
chat_repository = ChatRepository()