"""
Main FastAPI application for the RAG service
"""
from fastapi import FastAPI, HTTPException, Depends, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
import re
import time
import warnings
from contextlib import asynccontextmanager

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
from database.corpus_epoch import get_epoch
from database.chat_repository import chat_repository
from database.faq_repository import faq_repository
from database.storage_service import storage_service

# Services
from services.embedding_service import embedding_service
from services.pdf_processor import pdf_processor
from services.retrieval_service import retrieval_service
from services.llm_service import llm_service, is_not_found
from services.query_condenser import query_condenser, needs_condensing, CondenseResult
from services.ingestion import ingestion_manager, fail_interrupted_jobs
from services.document_validity import describe
from utils.threads import run_blocking

# Utilities
from utils.intent_detector import detect_intent
from utils.client_metadata import build_message_metadata
from utils.deadline_extractor import extract_deadline_info
from utils.confidence_calculator import calculate_confidence
from utils.file_security import (
    validate_file_url,
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
@asynccontextmanager
async def lifespan(_app):
    # Jobs live in this process: any document still "Processing" lost its job.
    try:
        await run_blocking(fail_interrupted_jobs)
    except Exception as e:
        print(f"⚠️ Could not check for interrupted ingestion jobs: {e}")
    yield


app = FastAPI(title="Campus Intel RAG Service", version="1.0.0", lifespan=lifespan)

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


async def _save_exchange(user_id: str, chat_id, typed_question: str, response: QueryResponse,
                         question_id: str, intent: str, confidence) -> QueryResponse:
    """
    Store the question and its answer and fill in what the browser needs to show
    them. The single place an exchange is saved: with a chat it goes into the chat and
    the user's history in one atomic write; without one, into the history alone.

    If storing fails the answer is still returned, marked `saved=False`, rather than
    throwing away a model call the user already paid for.
    """
    metadata = build_message_metadata(response)
    history_extra = {
        'questionId': question_id,
        'intent': intent,
        'confidence': confidence,
        'sources': response.sources,
    }
    try:
        if chat_id:
            saved = await chat_repository.record_exchange(
                user_id, chat_id, typed_question, response.answer, metadata, history_extra
            )
            response.historyId, response.messageId = saved["historyId"], saved["messageId"]
            metadata["historyId"] = saved["historyId"]
        else:
            response.historyId = await cache_repository.store_user_question(
                user_id, question_id, typed_question, answer=response.answer, intent=intent,
                confidence=confidence, sources=response.sources
            )
            if response.historyId:
                metadata["historyId"] = response.historyId
            else:
                response.saved = False
    except Exception as e:
        print(f"❌ Could not save the exchange: {e}")
        response.saved = False
    response.metadata = metadata
    return response


async def _decline(user_id: str, question: str, intent: str, reason: str,
                   standalone: str = None, chat_id: str = None) -> QueryResponse:
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
        standaloneQuestion=standalone,
    )
    return await _save_exchange(user_id, chat_id, question, response, "no_answer", intent, None)


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
        
        # Follow-ups: if the question leans on earlier turns, rewrite it into a
        # standalone question. History is used only for that, never as evidence.
        chat_id = request.chatId
        if chat_id:
            if not await chat_repository.user_owns_chat(user_id, chat_id):
                raise HTTPException(status_code=404, detail="Chat not found")
            # The server's own copy of the conversation; anything the browser sends is ignored
            try:
                history = await chat_repository.get_context_turns(chat_id, Config.MAX_HISTORY_MESSAGES)
            except Exception as e:
                print(f"⚠️ Could not read the chat for follow-up context: {e}")
                history = []
        else:
            history = [turn.model_dump() for turn in request.history]
        if Config.QUERY_CONDENSING and needs_condensing(request.question, history):
            consume_llm_budget(user_id)   # a model call: charged like any other
            condensed = await run_blocking(query_condenser.condense, request.question, history)
        else:
            condensed = CondenseResult(request.question, attempted=False, resolved=True)
        question = condensed.standalone          # what we search for and answer
        standalone_note = question if condensed.rewritten and question != request.question else None
        # A question that needed rewriting but could not be rewritten is still
        # ambiguous ("and the deadline?"), so it must never be read from or written
        # to the shared answer cache.
        # Answers are also not shared when the search was narrowed (specific documents or
        # filters): the cache key does not include that, so they would leak across searches.
        filters = {k: v for k, v in (("department", request.department),
                                     ("documentType", request.documentType)) if v}
        cacheable = condensed.resolved and not filters and not request.documentIds
        if standalone_note:
            print(f"✏️ Understood as: {question}")

        # Detect intent
        intent = detect_intent(question)
        print(f"🎯 Detected intent: {intent}")
        
        # Embed the query
        query_embedding = await run_blocking(embedding_service.embed_query, question)
        # CLIP vector of the question, used only to look for relevant images
        image_query_embedding = (
            await run_blocking(embedding_service.embed_image_query, question)
            if embedding_service.supports_images else None
        )
        print("✅ Query embedded")
        
        # Check cache first (only for questions that stand on their own)
        cached_question = None
        # The document set this answer is produced from. Read BEFORE searching and stored with
        # the answer: if documents change meanwhile, the stored answer is simply not reused.
        corpus_epoch = await run_blocking(get_epoch, firebase_client.db) if cacheable else 0
        if cacheable:
            cached_question = await cache_repository.find_similar_question(
                question,
                query_embedding,
                intent,
                corpus_epoch
            )
        
        if cached_question:
            # A cached answer may cite a document that has since been replaced by a newer
            # version, has expired, or was deleted. Serve it only if every cited document
            # is still live; otherwise answer afresh from the current documents.
            cited = {s.get('documentId') for s in cached_question.get('sources', []) if s.get('documentId')}
            live_ids = await run_blocking(retrieval_service.live_document_ids, firebase_client.db)
            if cited - live_ids:
                print(f"♻️ Cached answer ignored: it cites documents that are no longer current "
                      f"({len(cited - live_ids)})")
                cached_question = None

        if cached_question:
            print(f"♻️ Reusing cached answer (similarity: {cached_question.get('similarity', 1.0):.3f})")
            
            # Increment count
            await cache_repository.increment_question_count(cached_question['id'])
            
            # Extract deadline info for cached response
            deadline = extract_deadline_info(
                cached_question['answer'],
                cached_question.get('sources', [])
            )
            
            response = QueryResponse(
                answer=cached_question['answer'],
                sources=cached_question.get('sources', []),
                hasVisualContent=any(s.get('type') == 'image' for s in cached_question.get('sources', [])),
                cached=True,
                standaloneQuestion=standalone_note,
                similarity=cached_question.get('similarity'),
                deadline=deadline,
                confidence=cached_question.get('confidence')
            )
            return await _save_exchange(
                user_id, chat_id, request.question, response, cached_question['id'],
                cached_question.get('intent'), cached_question.get('confidence')
            )
        
        # No cache hit - generate new answer
        print("🤖 Generating new answer")
        
        # Retrieve relevant chunks
        context_docs = await run_blocking(
            retrieval_service.retrieve_multimodal,
            query_embedding,
            request.documentIds,
            image_query_embedding=image_query_embedding,
            filters=filters
        )
        
        # Only show the model chunks that are plausibly relevant. If nothing is,
        # decline without calling the LLM.
        relevant_docs = retrieval_service.filter_relevant(context_docs)
        if context_docs:
            top = max((d.metadata.get('similarity', 0) for d in context_docs), default=0)
            print(f"🎯 Top similarity {top:.3f} (floor {Config.MIN_RETRIEVAL_SCORE}); "
                  f"{len(relevant_docs)}/{len(context_docs)} chunks kept")

        if not relevant_docs:
            return await _decline(user_id, request.question, intent, "no relevant chunks", standalone_note, chat_id)

        print(f"📚 Using {len(relevant_docs)} relevant chunks")

        # About to spend a model call: charge the per-user and global daily budgets
        consume_llm_budget(user_id)

        # Sources first: they carry the document titles used to label the context
        sources = await run_blocking(retrieval_service.prepare_sources, relevant_docs)
        # The prompt names each document with its version and effective date, so the model can
        # say which version it is quoting and notice when two versions disagree
        doc_names = {
            s_['documentId']: describe({'name': s_['documentName'], 'version': s_.get('version'),
                                        'effectiveDate': s_.get('effectiveDate')})
            for s_ in sources
        }

        # Create multimodal message with labelled excerpts (async: re-extracts images)
        message = await llm_service.create_multimodal_message(
            question, relevant_docs, doc_names
        )

        # Generate answer (grounded: the model must reply NOT_FOUND if unsupported)
        answer = await run_blocking(llm_service.generate_answer, message)

        if is_not_found(answer):
            return await _decline(
                user_id, request.question, intent, "model found no support in context",
                standalone_note, chat_id
            )

        has_visual = any(doc.metadata.get('type') == 'image' for doc in relevant_docs)

        # Calculate confidence
        confidence = calculate_confidence(sources)
        print(f"📊 Confidence: {confidence.get('level')} ({confidence.get('score')}%)")
        
        # Extract deadline info
        deadline = extract_deadline_info(answer, sources)
        
        # Store in the shared cache under the STANDALONE question (never under an
        # unresolved follow-up)
        question_id = None
        if cacheable:
            question_id = await cache_repository.store_question(
                question,
                query_embedding,
                answer,
                intent,
                confidence,
                sources,
                deadline=deadline,
                corpus_epoch=corpus_epoch
            )
        
        print("✅ Answer generated")
        
        response = QueryResponse(
            answer=answer,
            sources=sources,
            hasVisualContent=has_visual,
            cached=False,
            deadline=deadline,
            confidence=confidence,
            standaloneQuestion=standalone_note
        )
        # The user's own entry keeps the question as THEY typed it
        return await _save_exchange(
            user_id, chat_id, request.question, response, question_id or "uncached", intent, confidence
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise internal_error(e, "query")

@app.post("/process-document", status_code=202, dependencies=[Depends(admin_limit)])
async def process_document(
    request: ProcessDocumentRequest,
    admin_id: str = Depends(require_admin),
):
    """
    Start processing a document in the background (admin only). Returns 202 at once;
    progress and the outcome are written to the document record
    (`status`, `processing`, `errorMessage`) for the admin UI to poll.
    """
    try:
        if not firebase_client.is_connected:
            raise HTTPException(status_code=500, detail="Firebase not initialized")

        # The file URL comes from the stored record, never from the request
        ref = firebase_client.db.collection('documents').document(request.documentId)
        doc_snapshot = await run_blocking(ref.get)
        if not doc_snapshot.exists:
            raise HTTPException(status_code=404, detail="Document not found")
        record = doc_snapshot.to_dict() or {}

        # Refuse an unsafe address now, so the admin sees it immediately
        try:
            validate_file_url(record.get('fileUrl'))
        except UnsafeFileUrl as e:
            raise HTTPException(status_code=400, detail=str(e))

        if record.get('status') in ('Deleting', 'Cancelled'):
            raise HTTPException(status_code=409, detail=f"Document is {record.get('status')}")
        if ingestion_manager.is_active(request.documentId):
            raise HTTPException(status_code=409, detail="This document is already being processed")

        await run_blocking(ref.update, {
            "status": "Processing",
            "processing": {"stage": "queued", "percent": 0, "message": "Queued",
                           "updatedAtMs": int(time.time() * 1000)},
        })
        ingestion_manager.start(request.documentId)
        print(f"📄 Queued processing for document: {request.documentId}")

        return {"accepted": True, "documentId": request.documentId, "status": "Processing"}

    except HTTPException:
        raise
    except Exception as e:
        raise internal_error(e)


@app.get("/health", response_model=HealthResponse)
def health_check():
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
        model=f"{embedding_service.model_id} + {Config.GEMINI_MODEL_NAME}",
        firebase_connected=firebase_client.is_connected
    )


@app.get("/faq")
def get_faq(limit: int = Query(default=50, ge=1, le=100)):
    """
    Public FAQ: only entries an administrator wrote and published. It is never
    built from users' questions (see database/faq_repository.py).
    """
    if not firebase_client.is_connected:
        raise HTTPException(status_code=500, detail="Firebase not initialized")

    return {"faqs": faq_repository.get_published(limit)}


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
def check_document_exists(documentId: str):
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
def check_duplicate_document(
    name: str = "",
    department: str = "",
    sha256: str = Query(default="", max_length=64),
    admin_id: str = Depends(require_admin),
):
    """
    Check an upload against what is already stored (admin only). Two independent checks:

    * `exactDuplicates`: a stored document whose file has the SAME BYTES (sha256), whatever it
      is called. Reliable: re-uploading the same PDF under another name is caught.
    * `similarDocuments`: a processed document in the same department whose NAME contains,
      or is contained in, this one's. Only a hint (names are free text).
    """
    try:
        db = firebase_client.db
        if not db:
            raise HTTPException(status_code=500, detail="Firebase not initialized")

        digest = sha256.strip().lower()
        if digest and not re.fullmatch(r"[0-9a-f]{64}", digest):
            raise HTTPException(status_code=400, detail="sha256 must be 64 hex characters")
        if not digest and not (name.strip() and department.strip()):
            raise HTTPException(status_code=400, detail="Give a sha256, or a name and a department")

        def brief(doc, data):
            return {
                'id': doc.id,
                'name': data.get('name'),
                'uploadedAt': data.get('uploadedAt'),
                'version': data.get('version'),
                'status': data.get('status'),
            }

        exact = []
        if digest:
            for doc in db.collection('documents').where('contentSha256', '==', digest).stream():
                data = doc.to_dict() or {}
                if data.get('status') not in ('Deleting', 'Cancelled'):
                    exact.append(brief(doc, data))

        similar = []
        if name.strip() and department.strip():
            name_lower = name.strip().lower()
            for doc in db.collection('documents') \
                    .where('department', '==', department) \
                    .where('status', '==', 'Processed').stream():
                data = doc.to_dict() or {}
                other = (data.get('name') or '').lower()
                if other and (name_lower in other or other in name_lower):
                    similar.append(brief(doc, data))

        exact_ids = {d['id'] for d in exact}
        similar = [d for d in similar if d['id'] not in exact_ids]
        return {
            "hasDuplicates": bool(exact or similar),
            "exactDuplicates": exact,
            "similarDocuments": similar,
        }

    except HTTPException:
        raise
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