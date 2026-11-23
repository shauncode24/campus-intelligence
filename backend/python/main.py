"""
Main FastAPI application for the RAG service
"""
from fastapi import FastAPI, HTTPException, Depends, Query
from fastapi.middleware.cors import CORSMiddleware
import warnings

warnings.filterwarnings('ignore')

from pydantic import BaseModel

# Configuration and database
from config import Config
from auth import get_current_user_id, require_admin
from database.firebase_client import firebase_client
from database.cache_repository import cache_repository
from database.storage_service import storage_service

# Services
from services.embedding_service import embedding_service
from services.pdf_processor import pdf_processor
from services.retrieval_service import retrieval_service
from services.llm_service import llm_service

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
    note: str

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

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=Config.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include chat routes WITHOUT /api prefix - mount at root level
app.include_router(chat_router, tags=["chats"])


@app.post("/query", response_model=QueryResponse)
async def query_documents(
    request: QueryRequest,
    user_id: str = Depends(get_current_user_id),
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
        
        if not context_docs:
            response = QueryResponse(
                answer="I couldn't find any relevant information in the documents.",
                sources=[],
                hasVisualContent=False,
                cached=False,
                confidence={"level": "Low", "score": 0, "reasoning": "No relevant sources found"}
            )
            
            # Still store in history even if no answer
            await cache_repository.store_user_question(
                user_id,
                "no_answer",
                request.question,
                answer=response.answer,
                intent=intent,
                confidence=response.confidence,
                sources=[]
            )
            
            return response
        
        print(f"📚 Retrieved {len(context_docs)} documents")
        
        # ✅ Create multimodal message with re-extracted images (async)
        message = await llm_service.create_multimodal_message(request.question, context_docs)
        
        # Generate answer
        answer = llm_service.generate_answer(message)
        
        # Prepare sources
        sources = retrieval_service.prepare_sources(context_docs)
        
        has_visual = any(doc.metadata.get('type') == 'image' for doc in context_docs)
        
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
        
    except Exception as e:
        print(f"❌ Error in query: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/process-document")
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
        raise HTTPException(status_code=500, detail=str(e))
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


@app.get("/history")
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
        raise HTTPException(status_code=500, detail=str(e))


@app.put("/history/{historyId}/favorite")
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
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/history/{historyId}")
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
        raise HTTPException(status_code=500, detail=str(e))


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
        raise HTTPException(status_code=500, detail=str(e))
    

@app.put("/history/{history_id}/note")
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
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/check-duplicate")
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
        raise HTTPException(status_code=500, detail=str(e))


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