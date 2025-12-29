"""
Main FastAPI application for the RAG service
"""
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import warnings
import aiohttp

warnings.filterwarnings('ignore')

# Configuration and database
from config import Config
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

# Models
from models import (
    ProcessDocumentRequest,
    QueryRequest,
    QueryResponse,
    HealthResponse
)

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


@app.post("/query", response_model=QueryResponse)
async def query_documents(request: QueryRequest):
    """
    Query the RAG system with caching and user history
    """
    try:
        if not firebase_client.is_connected:
            raise HTTPException(status_code=500, detail="Firebase not initialized")
        
        print(f"\n🔍 Query: {request.question}")
        print(f"👤 User: {request.userId}")
        
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
            print(f"♻️ Reusing cached answer")
            
            # Increment count and store user question
            await cache_repository.increment_question_count(cached_question['id'])
            await cache_repository.store_user_question(
                request.userId,
                cached_question['id'],
                request.question
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
                similarity=cached_question['similarity'],
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
            return QueryResponse(
                answer="I couldn't find any relevant information in the documents.",
                sources=[],
                hasVisualContent=False,
                cached=False
            )
        
        print(f"📚 Retrieved {len(context_docs)} documents")
        
        # Create multimodal message
        message = llm_service.create_multimodal_message(request.question, context_docs)
        
        # Generate answer
        answer = llm_service.generate_answer(message)
        
        # Prepare sources
        sources = retrieval_service.prepare_sources(context_docs)
        
        has_visual = any(doc.metadata.get('type') == 'image' for doc in context_docs)
        
        # Calculate confidence
        confidence = calculate_confidence(sources)
        
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
        
        # Store user question history
        if question_id:
            await cache_repository.store_user_question(
                request.userId,
                question_id,
                request.question
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
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/process-document")
async def process_document(request: ProcessDocumentRequest):
    """Process a document and store in Firebase"""
    try:
        print(f"📄 Processing document: {request.documentId}")
        
        # Download PDF
        async with aiohttp.ClientSession() as session:
            async with session.get(request.fileUrl) as response:
                if response.status != 200:
                    raise HTTPException(status_code=400, detail="Failed to download PDF")
                pdf_bytes = await response.read()
        
        print(f"✅ Downloaded PDF: {len(pdf_bytes)} bytes")
        
        # Process PDF
        all_docs, all_embeddings, image_data_store = pdf_processor.process_pdf(
            pdf_bytes,
            request.documentId
        )
        
        # Store in Firebase
        await storage_service.store_chunks(
            request.documentId,
            all_docs,
            all_embeddings,
            image_data_store
        )
        
        # Update document status
        await storage_service.update_document_status(request.documentId, all_docs)
        
        return {
            "success": True,
            "documentId": request.documentId,
            "totalChunks": len(all_docs),
            "textChunks": len([d for d in all_docs if d.metadata.get("type") == "text"]),
            "visualChunks": len([d for d in all_docs if d.metadata.get("type") == "image"]),
        }
        
    except Exception as e:
        print(f"❌ Error processing document: {e}")
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


@app.get("/history/{userId}")
async def get_user_history(userId: str, limit: int = 20):
    """Get user's question history"""
    if not firebase_client.is_connected:
        raise HTTPException(status_code=500, detail="Firebase not initialized")
    
    history = await cache_repository.get_user_history(userId, limit)
    return {"history": history}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)