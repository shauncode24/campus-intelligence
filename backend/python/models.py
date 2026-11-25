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
    # Re-processing a document that is live: keep it answering from its current version until the
    # new one is ready (ignored for a document that is not live)
    reprocess: bool = False

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
    # The chat this question belongs to. When given, the server checks the caller owns
    # it, reads the follow-up context from its own stored copy (ignoring `history`),
    # and saves the question and answer into it.
    chatId: Optional[str] = Field(default=None, max_length=128)
    # Optional metadata filters: only search documents of this department / type
    # "Try again": answer this question afresh, ignoring any stored answer for it
    regenerate: bool = False
    department: Optional[str] = Field(default=None, max_length=100)
    documentType: Optional[str] = Field(default=None, max_length=100)

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
    # When a stored answer was reused: when it was originally made (ms since the epoch)
    cachedAtMs: Optional[int] = None
    # Ids of what was stored for this exchange (null when nothing could be saved)
    historyId: Optional[str] = None
    messageId: Optional[str] = None
    # False if the answer could not be stored; the answer is still returned
    saved: bool = True
    # Set when citations the model invented were removed AFTER the text had been streamed: the
    # browser replaces what it showed with this
    answerCorrected: Optional[str] = None
    # True when the user stopped the answer part-way: `answer` is only what had been generated
    stopped: bool = False
    # Exactly what the chat shows beside the answer (and what is stored with it), so the
    # live view and a reload cannot differ
    metadata: Optional[Dict[str, Any]] = None

class HealthResponse(BaseModel):
    status: str
    chunks_in_firebase: int
    model: str
    firebase_connected: bool
