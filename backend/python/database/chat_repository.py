"""
Chat repository for managing chat sessions
"""
from firebase_admin import firestore
from database.firebase_client import firebase_client
from typing import List, Dict, Optional

class ChatRepository:
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
    async def auto_generate_title(chat_id: str, first_message: str) -> bool:
        """
        Auto-generate chat title from first message
        
        Args:
            chat_id: Chat identifier
            first_message: First user message
            
        Returns:
            bool: True if successful, False otherwise
        """
        db = firebase_client.db
        if not db:
            return False
        
        try:
            # Take first 50 chars or up to first question mark/period
            title = first_message[:50].split('?')[0].split('.')[0].strip()
            if len(title) < 3:
                title = first_message[:50]
            
            if len(title) > 50:
                title = title[:47] + "..."
            
            chat_ref = db.collection('chats').document(chat_id)
            chat_ref.update({
                'title': title,
                'updatedAt': firestore.SERVER_TIMESTAMP
            })
            
            print(f"✅ Auto-generated title: {title}")
            return True
        except Exception as e:
            print(f"❌ Error auto-generating title: {e}")
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
    async def add_message_to_chat(chat_id: str, role: str, content: str, 
                                   metadata: Dict = None) -> Optional[str]:
        """
        Add a message to a chat
        
        Args:
            chat_id: Chat identifier
            role: Message role ('user' or 'bot')
            content: Message content
            metadata: Optional metadata (sources, confidence, etc.)
            
        Returns:
            str: Message ID if successful, None otherwise
        """
        db = firebase_client.db
        if not db:
            print("⚠️ Firebase not available")
            return None
        
        try:
            message_data = {
                'chatId': chat_id,
                'role': role,
                'content': content,
                'createdAt': firestore.SERVER_TIMESTAMP
            }
            
            if metadata:
                message_data['metadata'] = metadata
            
            doc_ref = db.collection('chat_messages').add(message_data)
            message_id = doc_ref[1].id
            
            # Update chat's updatedAt and messageCount
            chat_ref = db.collection('chats').document(chat_id)
            chat_ref.update({
                'updatedAt': firestore.SERVER_TIMESTAMP,
                'messageCount': firestore.Increment(1)
            })
            
            print(f"💬 Added message to chat {chat_id}")
            return message_id
            
        except Exception as e:
            print(f"❌ Error adding message: {e}")
            return None
    
    @staticmethod
    async def get_chat_messages(chat_id: str, limit: int = 100) -> List[Dict]:
        """
        Get all messages in a chat
        
        Args:
            chat_id: Chat identifier
            limit: Maximum number of messages to return
            
        Returns:
            List[Dict]: List of message objects
        """
        db = firebase_client.db
        if not db:
            print("⚠️ Firebase not available")
            return []
        
        try:
            query = db.collection('chat_messages') \
                .where('chatId', '==', chat_id) \
                .order_by('createdAt', direction=firestore.Query.ASCENDING) \
                .limit(limit)
            
            messages = query.stream()
            
            message_list = []
            for msg in messages:
                msg_data = msg.to_dict()
                message_list.append({
                    'id': msg.id,
                    'role': msg_data.get('role'),
                    'content': msg_data.get('content'),
                    'metadata': msg_data.get('metadata', {}),
                    'createdAt': msg_data.get('createdAt')
                })
            
            print(f"📨 Retrieved {len(message_list)} messages for chat {chat_id}")
            return message_list
            
        except Exception as e:
            print(f"❌ Error fetching messages: {e}")
            return []

# Singleton instance
chat_repository = ChatRepository()