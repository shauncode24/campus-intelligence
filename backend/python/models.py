"""
Pydantic models for request/response validation
"""
from pydantic import BaseModel
from typing import List, Dict, Any, Optional

class ProcessDocumentRequest(BaseModel):
    documentId: str
    fileUrl: str

class QueryRequest(BaseModel):
    question: str
    documentIds: Optional[List[str]] = None
    userId: Optional[str] = "anonymous"

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