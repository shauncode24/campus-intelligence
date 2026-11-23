"""
Main FastAPI application for the RAG service
"""
from fastapi import FastAPI, HTTPException, Depends, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
import warnings

warnings.filterwarnings('ignore')

from pydantic import BaseModel, Field

# Configuration and database
from config import Config
from auth import get_current_user_id, require_admin
from utils.errors import internal_error
from utils.rate_limit import (
    limiter,
    client_ip,
    too_many,
    general_user_limit,
    query_limit,
    admin_limit,
    consume_llm_budget,
)
from database.firebase_client import firebase_client
from database.cache_repository import cache_repository
from database.storage_service import storage_service

# Services
from services.embedding_service import embedding_service
from services.pdf_processor import pdf_processor
from services.retrieval_service import retrieval_service
from services.llm_service import llm_service, is_not_found

# Utilities
from utils.intent_detector import detect_intent
from utils.deadline_extractor import extract_deadline_info
from utils.confidence_calculator import calculate_confidence
from utils.file_security import (
    download_pdf,
    UnsafeFileUrl,
    FileTooLarge,
    InvalidPdf,
    DownloadFailed,
)

from typing import List, Optional

# Models
from models import (
    ProcessDocumentRequest,
    QueryRequest,
    QueryResponse,
    HealthResponse
)

# Import chat routes
from routes.chatRoutes import router as chat_router

class UpdateNoteRequest(BaseModel):
    note: str = Field(max_length=5000)

class BulkProcessRequest(BaseModel):
    documents: List[dict]

class ProcessingStatus(BaseModel):
    documentId: str
    fileName: str
    status: str
    stage: str
    progress: Optional[dict] = None
    error: Optional[str] = None
    chunksCreated: Optional[int] = None
    textChunks: Optional[int] = None
    visualChunks: Optional[int] = None

# Validate configuration
Config.validate()

# Initialize FastAPI app
app = FastAPI(title="Campus Intel RAG Service", version="1.0.0")

async def _ip_rate_limit(request: Request, call_next):
    """Coarse per-IP limit on every request (protects even unauthenticated endpoints)."""
    if request.method != "OPTIONS":
        wait = limiter.check(f"ip:{client_ip(request)}", Config.IP_RATE_PER_MINUTE, 60)
        if wait > 0:
            err = too_many(wait, "Too many requests. Please wait a moment and try again.")
            return JSONResponse(status_code=429, content={"detail": err.detail}, headers=err.headers)
    return await call_next(request)


app.add_middleware(BaseHTTPMiddleware, dispatch=_ip_rate_limit)

# CORS: only the web app's origin(s); the API uses bearer tokens, not cookies,
# so credentials are not allowed.
app.add_middleware(
    CORSMiddleware,
    allow_origins=Config.CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

# Include chat routes WITHOUT /api prefix - mount at root level
app.include_router(chat_router, tags=["chats"])


async def _decline(user_id: str, question: str, intent: str, reason: str) -> QueryResponse:
    """
    The documents do not contain an answer. Say so plainly, show no sources,
    record it in the user's history, and do NOT cache it (a refusal must never
    be served back as if it were a verified answer).
    """
    print(f"🚫 Declining to answer ({reason})")
    response = QueryResponse(
        answer=Config.NO_ANSWER_MESSAGE,
        sources=[],
        hasVisualContent=False,
        cached=False,
        answered=False,
    )
    await cache_repository.store_user_question(
        user_id,
        "no_answer",
        question,
        answer=response.answer,
        intent=intent,
        confidence=None,
        sources=[]
    )
    return response


@app.post("/query", response_model=QueryResponse)
async def query_documents(
    request: QueryRequest,
    user_id: str = Depends(get_current_user_id),
    _rate_limited: None = Depends(query_limit),
):
    """
    Query the RAG system with caching and user history
    Re-extracts images on-demand for multimodal responses
    """
    try:
        if not firebase_client.is_connected:
            raise HTTPException(status_code=500, detail="Firebase not initialized")

        print(f"\n🔍 Query: {request.question}")
        print(f"👤 User: {user_id}")
        
        # Detect intent
        intent = detect_intent(request.question)
        print(f"🎯 Detected intent: {intent}")
        
        # Embed the query
        query_embedding = embedding_service.embed_text(request.question)
        print("✅ Query embedded")
        
        # Check cache first
        cached_question = await cache_repository.find_similar_question(
            request.question,
            query_embedding,
            intent
        )
        
        if cached_question:
            print(f"♻️ Reusing cached answer (similarity: {cached_question.get('similarity', 1.0):.3f})")
            
            # Increment count
            await cache_repository.increment_question_count(cached_question['id'])
            
            # Store user question with full data
            await cache_repository.store_user_question(
                user_id,
                cached_question['id'],
                request.question,
                answer=cached_question['answer'],
                intent=cached_question.get('intent'),
                confidence=cached_question.get('confidence'),
                sources=cached_question.get('sources', [])
            )
            
            # Extract deadline info for cached response
            deadline = extract_deadline_info(
                cached_question['answer'],
                cached_question.get('sources', [])
            )
            
            return QueryResponse(
                answer=cached_question['answer'],
                sources=cached_question.get('sources', []),
                hasVisualContent=any(s.get('type') == 'image' for s in cached_question.get('sources', [])),
                cached=True,
                similarity=cached_question.get('similarity'),
                deadline=deadline,
                confidence=cached_question.get('confidence')
            )
        
        # No cache hit - generate new answer
        print("🤖 Generating new answer")
        
        # Retrieve relevant chunks
        context_docs = retrieval_service.retrieve_multimodal(
            query_embedding,
            request.documentIds
        )
        
        # Only show the model chunks that are plausibly relevant. If nothing is,
        # decline without calling the LLM.
        relevant_docs = retrieval_service.filter_relevant(context_docs)
        if context_docs:
            top = max((d.metadata.get('similarity', 0) for d in context_docs), default=0)
            print(f"🎯 Top similarity {top:.3f} (floor {Config.MIN_RETRIEVAL_SCORE}); "
                  f"{len(relevant_docs)}/{len(context_docs)} chunks kept")

        if not relevant_docs:
            return await _decline(user_id, request.question, intent, "no relevant chunks")

        print(f"📚 Using {len(relevant_docs)} relevant chunks")

        # About to spend a model call: charge the per-user and global daily budgets
        consume_llm_budget(user_id)

        # Sources first: they carry the document titles used to label the context
        sources = retrieval_service.prepare_sources(relevant_docs)
        doc_names = {s_['documentId']: s_['documentName'] for s_ in sources}

        # Create multimodal message with labelled excerpts (async: re-extracts images)
        message = await llm_service.create_multimodal_message(
            request.question, relevant_docs, doc_names
        )

        # Generate answer (grounded: the model must reply NOT_FOUND if unsupported)
        answer = llm_service.generate_answer(message)

        if is_not_found(answer):
            return await _decline(
                user_id, request.question, intent, "model found no support in context"
            )

        has_visual = any(doc.metadata.get('type') == 'image' for doc in relevant_docs)

        # Calculate confidence
        confidence = calculate_confidence(sources)
        print(f"📊 Confidence: {confidence.get('level')} ({confidence.get('score')}%)")
        
        # Extract deadline info
        deadline = extract_deadline_info(answer, sources)
        
        # Store in cache
        question_id = await cache_repository.store_question(
            request.question,
            query_embedding,
            answer,
            intent,
            confidence,
            sources,
            deadline=deadline
        )
        
        # Store user question history with full data
        if question_id:
            await cache_repository.store_user_question(
                user_id,
                question_id,
                request.question,
                answer=answer,
                intent=intent,
                confidence=confidence,
                sources=sources
            )
        
        print(f"✅ Answer generated and cached\n")
        
        return QueryResponse(
            answer=answer,
            sources=sources,
            hasVisualContent=has_visual,
            cached=False,
            deadline=deadline,
            confidence=confidence
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise internal_error(e, "query")

@app.post("/process-document", dependencies=[Depends(admin_limit)])
async def process_document(
    request: ProcessDocumentRequest,
    admin_id: str = Depends(require_admin),
):
    """Process a document and store in Firebase (admin only)"""
    try:
        print(f"📄 Processing document: {request.documentId}")

        if not firebase_client.is_connected:
            raise HTTPException(status_code=500, detail="Firebase not initialized")

        # The file URL comes from the stored record, never from the request
        doc_snapshot = firebase_client.db.collection('documents').document(request.documentId).get()
        if not doc_snapshot.exists:
            raise HTTPException(status_code=404, detail="Document not found")
        file_url = doc_snapshot.to_dict().get('fileUrl')

        # Download PDF (allow-listed host, no redirects, size/time capped)
        try:
            pdf_bytes = await download_pdf(file_url)
        except UnsafeFileUrl as e:
            raise HTTPException(status_code=400, detail=str(e))
        except FileTooLarge as e:
            raise HTTPException(status_code=413, detail=str(e))
        except InvalidPdf as e:
            raise HTTPException(status_code=415, detail=str(e))
        except DownloadFailed as e:
            raise HTTPException(status_code=502, detail=str(e))

        print(f"✅ Downloaded PDF: {len(pdf_bytes)} bytes")

        # Process PDF - returns (docs, embeddings) only
        try:
            all_docs, all_embeddings = pdf_processor.process_pdf(
                pdf_bytes,
                request.documentId
            )
        except InvalidPdf as e:
            raise HTTPException(status_code=422, detail=str(e))

        # Store in Firebase - no image data
        await storage_service.store_chunks(
            request.documentId,
            all_docs,
            all_embeddings
        )
        
        # Update document status
        await storage_service.update_document_status(request.documentId, all_docs)
        
        return {
            "success": True,
            "documentId": request.documentId,
            "totalChunks": len(all_docs),
            "textChunks": len([d for d in all_docs if d.metadata.get("type") == "text"]),
            "visualChunks": len([d for d in all_docs if d.metadata.get("type") == "image"]),
            "note": "Images stored as embeddings only"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Error processing document: {e}")
        import traceback
        traceback.print_exc()
        raise internal_error(e)
@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint"""
    chunk_count = 0
    
    if firebase_client.is_connected:
        try:
            db = firebase_client.db
            chunks_ref = db.collection('chunks')
            chunk_count = len(list(chunks_ref.limit(1000).stream()))
        except Exception as e:
            print(f"Error counting chunks: {e}")
    
    return HealthResponse(
        status="healthy",
        chunks_in_firebase=chunk_count,
        model="CLIP + Gemini Vision",
        firebase_connected=firebase_client.is_connected
    )


@app.get("/faq")
async def get_faq(limit: int = 10):
    """Get frequently asked questions"""
    if not firebase_client.is_connected:
        raise HTTPException(status_code=500, detail="Firebase not initialized")
    
    faqs = await cache_repository.get_faq(limit)
    return {"faqs": faqs}


@app.get("/history", dependencies=[Depends(general_user_limit)])
async def get_user_history(
    limit: int = Query(default=100, ge=1, le=200),
    favorites_only: bool = False,
    user_id: str = Depends(get_current_user_id),
):
    """Get the authenticated user's question history with optional favorites filter"""
    try:
        if not firebase_client.is_connected:
            raise HTTPException(status_code=500, detail="Firebase not initialized")

        print(f"📖 Fetching history for user: {user_id} (limit: {limit}, favorites_only: {favorites_only})")
        history = await cache_repository.get_user_history(user_id, limit, favorites_only)
        print(f"✅ Returning {len(history)} history items")

        return {"history": history}
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Error fetching history: {e}")
        import traceback
        traceback.print_exc()
        raise internal_error(e)


@app.put("/history/{historyId}/favorite", dependencies=[Depends(general_user_limit)])
async def toggle_favorite(historyId: str, user_id: str = Depends(get_current_user_id)):
    """Toggle favorite status for a question in the authenticated user's history"""
    try:
        if not firebase_client.is_connected:
            raise HTTPException(status_code=500, detail="Firebase not initialized")

        print(f"⭐ Toggling favorite for history {historyId} (user: {user_id})")

        new_status = await cache_repository.toggle_favorite(user_id, historyId)
        
        if new_status is None:
            raise HTTPException(status_code=404, detail="History item not found or unauthorized")
        
        print(f"✅ Favorite status updated to: {new_status}")
        return {"success": True, "favorite": new_status}
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Error toggling favorite: {e}")
        import traceback
        traceback.print_exc()
        raise internal_error(e)


@app.delete("/history/{historyId}", dependencies=[Depends(general_user_limit)])
async def delete_user_question(historyId: str, user_id: str = Depends(get_current_user_id)):
    """Delete a specific question from the authenticated user's history"""
    try:
        if not firebase_client.is_connected:
            raise HTTPException(status_code=500, detail="Firebase not initialized")

        print(f"🗑️ Attempting to delete history {historyId} for user {user_id}")

        success = await cache_repository.delete_user_question(user_id, historyId)
        
        if not success:
            raise HTTPException(status_code=404, detail="History item not found or unauthorized")
        
        print(f"✅ Successfully deleted history item {historyId}")
        return {"success": True, "message": "History item deleted"}
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Error deleting history item: {e}")
        import traceback
        traceback.print_exc()
        raise internal_error(e)


@app.get("/documents/{documentId}/exists")
async def check_document_exists(documentId: str):
    """Check if a document exists in Firebase"""
    try:
        if not firebase_client.is_connected:
            raise HTTPException(status_code=500, detail="Firebase not initialized")
        
        db = firebase_client.db
        doc_ref = db.collection('documents').document(documentId).get()
        
        exists = doc_ref.exists
        print(f"📄 Document {documentId} exists: {exists}")
        
        return {"exists": exists, "documentId": documentId}
        
    except Exception as e:
        print(f"❌ Error checking document: {e}")
        raise internal_error(e)
    

@app.put("/history/{history_id}/note", dependencies=[Depends(general_user_limit)])
async def update_personal_note(
    history_id: str,
    request: UpdateNoteRequest,
    user_id: str = Depends(get_current_user_id),
):
    """
    Update personal note for a history item owned by the authenticated user
    """
    try:
        if not firebase_client.is_connected:
            raise HTTPException(status_code=500, detail="Firebase not initialized")

        success = await cache_repository.update_personal_note(
            user_id,
            history_id,
            request.note
        )
        
        if not success:
            raise HTTPException(
                status_code=404, 
                detail="History item not found or unauthorized"
            )
        
        return {
            "success": True,
            "message": "Note updated successfully",
            "historyId": history_id
        }
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Error updating note: {e}")
        raise internal_error(e)

@app.post("/check-duplicate", dependencies=[Depends(admin_limit)])
async def check_duplicate_document(
    name: str,
    department: str,
    admin_id: str = Depends(require_admin),
):
    """
    Check if a document with similar name exists (admin only)
    """
    try:
        db = firebase_client.db
        if not db:
            raise HTTPException(status_code=500, detail="Firebase not initialized")
        
        # Query for documents with similar name and same department
        docs_ref = db.collection('documents') \
            .where('department', '==', department) \
            .where('status', '==', 'Processed') \
            .stream()
        
        similar_docs = []
        name_lower = name.lower()
        
        for doc in docs_ref:
            doc_data = doc.to_dict()
            doc_name_lower = doc_data.get('name', '').lower()
            
            # Simple similarity check
            if name_lower in doc_name_lower or doc_name_lower in name_lower:
                similar_docs.append({
                    'id': doc.id,
                    'name': doc_data.get('name'),
                    'uploadedAt': doc_data.get('uploadedAt'),
                    'version': doc_data.get('version')
                })
        
        return {
            "hasDuplicates": len(similar_docs) > 0,
            "similarDocuments": similar_docs
        }
        
    except Exception as e:
        print(f"❌ Error checking duplicates: {e}")
        raise internal_error(e)


# Enhance the existing update_document_status in storage_service.py
async def update_document_status_enhanced(doc_id: str, all_docs: List[Document], metadata: dict):
    """
    Update document processing status with enhanced metadata
    """
    db = firebase_client.db
    if not db:
        return
    
    try:
        doc_ref = db.collection("documents").document(doc_id)
        
        update_data = {
            "status": "Processed",
            "processedAt": firestore.SERVER_TIMESTAMP,
            "chunksCount": len(all_docs),
            "textChunks": len([d for d in all_docs if d.metadata.get("type") == "text"]),
            "visualChunks": len([d for d in all_docs if d.metadata.get("type") == "image"]),
            "isMultiModal": True,
        }
        
        # Add enhanced metadata if provided
        if metadata:
            update_data.update({
                'documentType': metadata.get('documentType'),
                'academicYear': metadata.get('academicYear'),
                'programs': metadata.get('programs', []),
                'years': metadata.get('years', []),
                'accessLevel': metadata.get('accessLevel', 'Public'),
                'version': metadata.get('version'),
                'owner': metadata.get('owner')
            })
        
        doc_ref.update(update_data)
        print(f"✅ Updated document status with enhanced metadata: {doc_id}")
        
    except Exception as e:
        print(f"Error updating document status: {e}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)