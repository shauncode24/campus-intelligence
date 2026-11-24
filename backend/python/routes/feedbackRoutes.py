"""
Answer feedback routes. Requires a verified token; the rater is always the token's uid.
"""
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Path
from pydantic import BaseModel, Field

from auth import get_current_user_id
from database.feedback_repository import feedback_repository
from utils.errors import internal_error
from utils.rate_limit import write_user_limit

router = APIRouter(dependencies=[Depends(write_user_limit)])


class FeedbackRequest(BaseModel):
    # "up", "down", or null to take a rating back
    rating: Optional[Literal["up", "down"]] = None
    # Why a rating is "down" (a short fixed list, so the rows can be counted)
    reason: Optional[Literal["wrong", "missing", "outdated", "unclear", "other"]] = None
    comment: Optional[str] = Field(default=None, max_length=500)


@router.put("/messages/{message_id}/feedback")
async def rate_answer(
    request: FeedbackRequest,
    message_id: str = Path(max_length=128),
    user_id: str = Depends(get_current_user_id),
):
    """Rate (or un-rate) an answer in one of the caller's own chats."""
    try:
        saved = await feedback_repository.set_feedback(
            user_id, message_id, request.rating, request.reason, request.comment
        )
        if saved is None:
            raise HTTPException(status_code=404, detail="Message not found")
        return {"success": True, **saved}
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Error in rate_answer: {e}")
        raise internal_error(e)
