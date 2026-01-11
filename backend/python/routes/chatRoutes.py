"""
Chat management API routes
"""
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, List, Dict
from database.chat_repository import chat_repository

router = APIRouter()

class CreateChatRequest(BaseModel):
    userId: str
    title: Optional[str] = "New Chat"

class UpdateChatTitleRequest(BaseModel):
    title: str

class AutoTitleRequest(BaseModel):
    firstMessage: str

class AddMessageRequest(BaseModel):
    chatId: str
    role: str
    content: str
    metadata: Optional[Dict] = None

@router.post("/chats/create")
async def create_chat(request: CreateChatRequest):
    """Create a new chat session"""
    try:
        chat_id = await chat_repository.create_chat(
            request.userId,
            request.title
        )
        
        if chat_id:
            return {
                "success": True,
                "chatId": chat_id,
                "message": "Chat created successfully"
            }
        else:
            raise HTTPException(status_code=500, detail="Failed to create chat")
            
    except Exception as e:
        print(f"❌ Error in create_chat: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/chats/user/{userId}")
async def get_user_chats(
    userId: str,
    limit: int = Query(default=20, ge=1, le=100)
):
    """Get all chats for a user"""
    try:
        chats = await chat_repository.get_user_chats(userId, limit)
        
        return {
            "success": True,
            "chats": chats,
            "count": len(chats)
        }
        
    except Exception as e:
        print(f"❌ Error in get_user_chats: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/chats/{chatId}/user/{userId}")
async def delete_chat(chatId: str, userId: str):
    """Delete a chat and all its messages"""
    try:
        success = await chat_repository.delete_chat(userId, chatId)
        
        if success:
            return {
                "success": True,
                "message": "Chat deleted successfully"
            }
        else:
            raise HTTPException(status_code=404, detail="Chat not found or unauthorized")
            
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Error in delete_chat: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/chats/{chatId}/user/{userId}/title")
async def update_chat_title(
    chatId: str,
    userId: str,
    request: UpdateChatTitleRequest
):
    """Update chat title"""
    try:
        success = await chat_repository.update_chat_title(
            userId,
            chatId,
            request.title
        )
        
        if success:
            return {
                "success": True,
                "message": "Chat title updated successfully"
            }
        else:
            raise HTTPException(status_code=404, detail="Chat not found or unauthorized")
            
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Error in update_chat_title: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/chats/{chatId}/auto-title")
async def auto_generate_title(chatId: str, request: AutoTitleRequest):
    """Auto-generate chat title from first message"""
    try:
        success = await chat_repository.auto_generate_title(
            chatId,
            request.firstMessage
        )
        
        if success:
            return {
                "success": True,
                "message": "Title auto-generated successfully"
            }
        else:
            raise HTTPException(status_code=500, detail="Failed to auto-generate title")
            
    except Exception as e:
        print(f"❌ Error in auto_generate_title: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/chats/{chatId}/messages")
async def get_chat_messages(
    chatId: str,
    limit: int = Query(default=100, ge=1, le=500)
):
    """Get all messages in a chat"""
    try:
        messages = await chat_repository.get_chat_messages(chatId, limit)
        
        # ✅ Ensure createdAt timestamp is included in response
        formatted_messages = []
        for msg in messages:
            formatted_msg = {
                'id': msg['id'],
                'role': msg['role'],
                'content': msg['content'],
                'createdAt': msg['createdAt'],  # ✅ Include timestamp
                'metadata': msg.get('metadata', {})
            }
            formatted_messages.append(formatted_msg)
        
        return {
            "success": True,
            "messages": formatted_messages,
            "count": len(formatted_messages)
        }
        
    except Exception as e:
        print(f"❌ Error in get_chat_messages: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/chats/messages/add")
async def add_message(request: AddMessageRequest):
    """Add a message to a chat"""
    try:
        # ✅ Metadata already includes timestamp from frontend
        message_id = await chat_repository.add_message_to_chat(
            request.chatId,
            request.role,
            request.content,
            request.metadata
        )
        
        if message_id:
            return {
                "success": True,
                "messageId": message_id,
                "message": "Message added successfully"
            }
        else:
            raise HTTPException(status_code=500, detail="Failed to add message")
            
    except Exception as e:
        print(f"❌ Error in add_message: {e}")
        raise HTTPException(status_code=500, detail=str(e))