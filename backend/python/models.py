"""
Pydantic models for request/response validation
"""
from pydantic import BaseModel, Field
from config import Config
from typing import List, Dict, Any, Optional, Literal

class ProcessDocumentRequest(BaseModel):
    # Only the id is accepted. The file URL is always read from the stored
    # document record, never from the request (SSRF).
    documentId: str

class HistoryTurn(BaseModel):
    """One earlier message in the chat. Used only to understand follow-up questions."""
    role: Literal["user", "bot"]
    text: str = Field(max_length=1500)


class QueryRequest(BaseModel):
    # NOTE: the caller's identity comes from the verified Firebase ID token,
    # never from the request body.
    question: str = Field(min_length=1, max_length=Config.MAX_QUESTION_CHARS)
    documentIds: Optional[List[str]] = Field(default=None, max_length=50)
    # Recent chat turns (oldest first), so a follow-up like "and the deadline?" can be
    # understood. Never used as evidence for an answer.
    history: List[HistoryTurn] = Field(default_factory=list, max_length=12)

class SourceInfo(BaseModel):
    page: Optional[int]
    type: str
    documentId: str
    documentName: str
    fileUrl: Optional[str]
    content: str
    similarity: float

class DeadlineInfo(BaseModel):
    canAddToCalendar: bool
    date: str
    title: str
    description: str
    context: str
    sourceDocument: str

class ConfidenceInfo(BaseModel):
    level: str
    score: int
    reasoning: str

class QueryResponse(BaseModel):
    answer: str
    sources: List[Dict[str, Any]]
    hasVisualContent: bool
    cached: bool = False
    # False when the documents did not contain an answer (a refusal)
    answered: bool = True
    # Set when a follow-up was rewritten into a standalone question for searching
    standaloneQuestion: Optional[str] = None
    similarity: Optional[float] = None
    deadline: Optional[Dict[str, Any]] = None
    confidence: Optional[ConfidenceInfo] = None

class HealthResponse(BaseModel):
    status: str
    chunks_in_firebase: int
    model: str
    firebase_connected: bool

class FAQItem(BaseModel):
    id: str
    question: str
    answer: str
    count: int
    intent: str

class HistoryItem(BaseModel):
    id: str
    questionText: str
    answer: str
    askedAt: Any

class UpdateNoteRequest(BaseModel):
    note: str