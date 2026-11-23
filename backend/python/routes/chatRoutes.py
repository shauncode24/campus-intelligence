"""
Chat management API routes

All routes require a verified Firebase ID token. The owner is always the token's
uid; no route accepts a user id from the client. Any access to an existing chat
is checked for ownership and answered with 404 when the chat is missing or
belongs to someone else.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from typing import Optional, Dict, Literal
from auth import get_current_user_id
from database.chat_repository import chat_repository

router = APIRouter()

CHAT_NOT_FOUND = "Chat not found"


class CreateChatRequest(BaseModel):
    title: Optional[str] = Field(default="New Chat", max_length=200)

class UpdateChatTitleRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)

class AutoTitleRequest(BaseModel):
    firstMessage: str

class AddMessageRequest(BaseModel):
    chatId: str
    role: Literal["user", "bot"]
    content: str
    metadata: Optional[Dict] = None


async def _require_chat_owner(user_id: str, chat_id: str):
    """Raise 404 unless chat_id exists and belongs to user_id."""
    if not await chat_repository.user_owns_chat(user_id, chat_id):
        raise HTTPException(status_code=404, detail=CHAT_NOT_FOUND)


@router.post("/chats/create")
async def create_chat(
    request: CreateChatRequest,
    user_id: str = Depends(get_current_user_id),
):
    """Create a new chat session owned by the authenticated user"""
    try:
        chat_id = await chat_repository.create_chat(
            user_id,
            request.title or "New Chat"
        )

        if chat_id:
            return {
                "success": True,
                "chatId": chat_id,
                "message": "Chat created successfully"
            }
        raise HTTPException(status_code=500, detail="Failed to create chat")

    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Error in create_chat: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/chats")
async def get_user_chats(
    limit: int = Query(default=20, ge=1, le=100),
    user_id: str = Depends(get_current_user_id),
):
    """Get all chats for the authenticated user"""
    try:
        chats = await chat_repository.get_user_chats(user_id, limit)

        return {
            "success": True,
            "chats": chats,
            "count": len(chats)
        }

    except Exception as e:
        print(f"❌ Error in get_user_chats: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/chats/{chatId}")
async def delete_chat(chatId: str, user_id: str = Depends(get_current_user_id)):
    """Delete a chat and all its messages"""
    try:
        print(f"🗑️ Deleting chat {chatId} and all its messages...")
        success = await chat_repository.delete_chat(user_id, chatId)

        if success:
            print(f"✅ Chat {chatId} and all messages deleted successfully")
            return {
                "success": True,
                "message": "Chat and all messages deleted successfully"
            }
        raise HTTPException(status_code=404, detail=CHAT_NOT_FOUND)

    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Error in delete_chat: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/chats/{chatId}/title")
async def update_chat_title(
    chatId: str,
    request: UpdateChatTitleRequest,
    user_id: str = Depends(get_current_user_id),
):
    """Update chat title"""
    try:
        success = await chat_repository.update_chat_title(
            user_id,
            chatId,
            request.title
        )

        if success:
            return {
                "success": True,
                "message": "Chat title updated successfully"
            }
        raise HTTPException(status_code=404, detail=CHAT_NOT_FOUND)

    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Error in update_chat_title: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/chats/{chatId}/auto-title")
async def auto_generate_title(
    chatId: str,
    request: AutoTitleRequest,
    user_id: str = Depends(get_current_user_id),
):
    """Auto-generate chat title from first message"""
    try:
        await _require_chat_owner(user_id, chatId)

        success = await chat_repository.auto_generate_title(
            chatId,
            request.firstMessage
        )

        if success:
            return {
                "success": True,
                "message": "Title auto-generated successfully"
            }
        raise HTTPException(status_code=500, detail="Failed to auto-generate title")

    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Error in auto_generate_title: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/chats/{chatId}/messages")
async def get_chat_messages(
    chatId: str,
    limit: int = Query(default=100, ge=1, le=500),
    user_id: str = Depends(get_current_user_id),
):
    """Get all messages in a chat the authenticated user owns"""
    try:
        await _require_chat_owner(user_id, chatId)

        messages = await chat_repository.get_chat_messages(chatId, limit)

        formatted_messages = []
        for msg in messages:
            formatted_messages.append({
                'id': msg['id'],
                'role': msg['role'],
                'content': msg['content'],
                'createdAt': msg['createdAt'],
                'metadata': msg.get('metadata', {})
            })

        return {
            "success": True,
            "messages": formatted_messages,
            "count": len(formatted_messages)
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Error in get_chat_messages: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/chats/messages/add")
async def add_message(
    request: AddMessageRequest,
    user_id: str = Depends(get_current_user_id),
):
    """Add a message to a chat the authenticated user owns"""
    try:
        await _require_chat_owner(user_id, request.chatId)

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
        raise HTTPException(status_code=500, detail="Failed to add message")

    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Error in add_message: {e}")
        raise HTTPException(status_code=500, detail=str(e))
