"""
Chat management API routes

All routes require a verified Firebase ID token. The owner is always the token's
uid; no route accepts a user id from the client. Any access to an existing chat
is checked for ownership and answered with 404 when the chat is missing or
belongs to someone else.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from typing import Optional
from auth import get_current_user_id
from utils.errors import internal_error
from utils.rate_limit import general_user_limit, write_user_limit
from database.chat_repository import chat_repository

router = APIRouter(dependencies=[Depends(general_user_limit)])

CHAT_NOT_FOUND = "Chat not found"


class CreateChatRequest(BaseModel):
    title: Optional[str] = Field(default="New Chat", max_length=200)

class UpdateChatTitleRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)

async def _require_chat_owner(user_id: str, chat_id: str):
    """Raise 404 unless chat_id exists and belongs to user_id."""
    if not await chat_repository.user_owns_chat(user_id, chat_id):
        raise HTTPException(status_code=404, detail=CHAT_NOT_FOUND)


@router.post("/chats/create", dependencies=[Depends(write_user_limit)])
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
        raise internal_error(e)

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
        raise internal_error(e)

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
        raise internal_error(e)

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
        raise internal_error(e)

@router.get("/chats/{chatId}/messages")
async def get_chat_messages(
    chatId: str,
    limit: int = Query(default=100, ge=1, le=500),
    before: Optional[str] = Query(default=None, max_length=128),
    user_id: str = Depends(get_current_user_id),
):
    """
    The newest `limit` messages of a chat the authenticated user owns, oldest first.
    `hasMore` says older ones exist; pass the oldest returned id as `before` to get them.
    """
    try:
        await _require_chat_owner(user_id, chatId)

        messages, has_more = await chat_repository.get_chat_messages(chatId, limit, before)

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
            "count": len(formatted_messages),
            "hasMore": has_more
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Error in get_chat_messages: {e}")
        raise internal_error(e)
