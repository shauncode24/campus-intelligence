from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import fitz  # PyMuPDF
from transformers import CLIPProcessor, CLIPModel
from PIL import Image
import torch
import numpy as np
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import HumanMessage
from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter
import base64
import io
import os
from typing import List, Dict, Any, Optional
import tempfile
import firebase_admin
from firebase_admin import credentials, firestore
from dotenv import load_dotenv
import warnings
warnings.filterwarnings('ignore')

load_dotenv()

# Initialize Firebase
try:
    cred = credentials.Certificate({
        "type": "service_account",
        "project_id": os.getenv("FIREBASE_PROJECT_ID"),
        "private_key_id": os.getenv("FIREBASE_PRIVATE_KEY_ID"),
        "private_key": os.getenv("FIREBASE_PRIVATE_KEY").replace("\\n", "\n"),
        "client_email": os.getenv("FIREBASE_CLIENT_EMAIL"),
        "client_id": os.getenv("FIREBASE_CLIENT_ID"),
        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
        "token_uri": "https://oauth2.googleapis.com/token",
        "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
        "client_x509_cert_url": os.getenv("FIREBASE_CLIENT_X509_CERT_URL"),
    })
    firebase_admin.initialize_app(cred)
    db = firestore.client()
    print("✅ Firebase initialized")
except Exception as e:
    print(f"⚠️ Firebase initialization error: {e}")
    db = None

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

print("📄 Loading CLIP model...")
clip_model = CLIPModel.from_pretrained("openai/clip-vit-base-patch32")
clip_processor = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")
clip_model.eval()
print("✅ CLIP model loaded")

print("📄 Initializing Gemini...")
llm = ChatGoogleGenerativeAI(
    model="gemini-2.5-flash",
    temperature=0.2
)
print("✅ Gemini initialized")

class ProcessDocumentRequest(BaseModel):
    documentId: str
    fileUrl: str

class QueryRequest(BaseModel):
    question: str
    documentIds: Optional[List[str]] = None
    userId: Optional[str] = "anonymous"  # Add userId

class QueryResponse(BaseModel):
    answer: str
    sources: List[Dict[str, Any]]
    hasVisualContent: bool
    cached: bool = False
    similarity: Optional[float] = None

# Embedding functions (exactly like your notebook)
def embed_image(image_data):
    """Embed image using CLIP"""
    if isinstance(image_data, str):
        image = Image.open(image_data).convert("RGB")
    else:
        image = image_data

    inputs = clip_processor(images=image, return_tensors="pt")

    with torch.no_grad():
        features = clip_model.get_image_features(**inputs)
        features = features / features.norm(dim=-1, keepdim=True)
        return features.squeeze().numpy()

def embed_text(text):
    """Embed text using CLIP"""
    inputs = clip_processor(
        text=text,
        return_tensors="pt",
        padding=True,
        truncation=True,
        max_length=77
    )

    with torch.no_grad():
        features = clip_model.get_text_features(**inputs)
        features = features / features.norm(dim=-1, keepdim=True)
        return features.squeeze().numpy()

def cosine_similarity(a, b):
    """Calculate cosine similarity"""
    return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))

def process_pdf_to_documents(pdf_bytes: bytes, doc_id: str):
    """
    Process PDF exactly like your Jupyter notebook:
    - Extract text and create text embeddings
    - Extract images and create CLIP image embeddings
    - Store base64 images for later use with Gemini Vision
    """
    all_docs = []
    all_embeddings = []
    image_data_store = {}

    splitter = RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=100)

    with tempfile.NamedTemporaryFile(delete=False, suffix='.pdf') as tmp_file:
        tmp_file.write(pdf_bytes)
        tmp_path = tmp_file.name

    try:
        doc = fitz.open(tmp_path)
        print(f"📄 Processing {len(doc)} pages...")

        for i, page in enumerate(doc):
            print(f"   Page {i+1}/{len(doc)}...")
            
            # Process text
            text = page.get_text()
            if text.strip():
                temp_doc = Document(
                    page_content=text,
                    metadata={"page": i, "type": "text", "documentId": doc_id}
                )
                text_chunks = splitter.split_documents([temp_doc])

                for chunk in text_chunks:
                    embedding = embed_text(chunk.page_content)
                    all_embeddings.append(embedding)
                    all_docs.append(chunk)

            # Process images (exactly like your notebook)
            for img_index, img in enumerate(page.get_images(full=True)):
                try:
                    xref = img[0]
                    base_image = doc.extract_image(xref)
                    image_bytes = base_image["image"]

                    # Convert to PIL Image
                    pil_image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
                    
                    # Create unique identifier
                    image_id = f"{doc_id}_page_{i}_img_{img_index}"
                    
                    # Store image as base64 for Gemini Vision
                    buffered = io.BytesIO()
                    pil_image.save(buffered, format="PNG")
                    img_base64 = base64.b64encode(buffered.getvalue()).decode()
                    image_data_store[image_id] = img_base64
                    
                    # Embed image using CLIP (image embedding, not text!)
                    embedding = embed_image(pil_image)
                    all_embeddings.append(embedding)
                    
                    # Create document for image
                    image_doc = Document(
                        page_content=f"[Image: {image_id}]",
                        metadata={
                            "page": i,
                            "type": "image",
                            "image_id": image_id,
                            "documentId": doc_id
                        }
                    )
                    all_docs.append(image_doc)
                    print(f"      ✅ Processed image {img_index}")
                    
                except Exception as e:
                    print(f"      ⚠️ Error processing image {img_index}: {e}")
                    continue

        doc.close()
        print(f"✅ Processing complete: {len(all_docs)} chunks created")

    finally:
        os.unlink(tmp_path)

    return all_docs, np.array(all_embeddings), image_data_store

async def store_chunks_in_firebase(doc_id: str, all_docs: List[Document], 
                                   all_embeddings: np.ndarray, image_data_store: Dict):
    """Store chunks AND image data in Firebase"""
    if not db:
        print("⚠️ Firebase not available")
        return
    
    try:
        batch = db.batch()
        
        for idx, (doc, embedding) in enumerate(zip(all_docs, all_embeddings)):
            chunk_ref = db.collection('chunks').document()
            
            chunk_data = {
                'documentId': doc_id,
                'index': idx,
                'content': doc.page_content,
                'type': doc.metadata.get('type', 'text'),
                'embedding': embedding.tolist(),
                'metadata': {
                    'pageNumber': doc.metadata.get('page'),
                    'imageId': doc.metadata.get('image_id'),
                },
                'createdAt': firestore.SERVER_TIMESTAMP,
                'isMultiModal': True
            }
            
            # CRITICAL: Store base64 image data for image chunks
            if doc.metadata.get('type') == 'image':
                image_id = doc.metadata.get('image_id')
                if image_id and image_id in image_data_store:
                    chunk_data['imageData'] = image_data_store[image_id]
            
            batch.set(chunk_ref, chunk_data)
        
        batch.commit()
        print(f"✅ Stored {len(all_docs)} chunks in Firebase")
        
    except Exception as e:
        print(f"❌ Error storing chunks: {e}")
        raise

def retrieve_multimodal(query_embedding, document_ids=None, k=5):
    """
    Retrieve relevant chunks from Firebase using CLIP similarity
    Works exactly like your notebook's vector_store.similarity_search_by_vector
    """
    if not db:
        raise HTTPException(status_code=500, detail="Firebase not initialized")
    
    print(f"🔍 Retrieving chunks from Firebase...")
    
    chunks_ref = db.collection('chunks')
    
    if document_ids:
        if len(document_ids) <= 10:
            query = chunks_ref.where('documentId', 'in', document_ids)
        else:
            query = chunks_ref
    else:
        query = chunks_ref
    
    chunks_snapshot = query.stream()
    
    # Score all chunks
    scored_chunks = []
    
    for chunk_doc in chunks_snapshot:
        chunk_data = chunk_doc.to_dict()
        
        if 'embedding' not in chunk_data:
            continue
        
        if document_ids and len(document_ids) > 10:
            if chunk_data.get('documentId') not in document_ids:
                continue
        
        # Calculate similarity
        chunk_embedding = np.array(chunk_data['embedding'])
        similarity = cosine_similarity(query_embedding, chunk_embedding)
        
        # Create Document object (like your notebook)
        doc = Document(
            page_content=chunk_data.get('content', ''),
            metadata={
                'page': chunk_data.get('metadata', {}).get('pageNumber'),
                'type': chunk_data.get('type', 'text'),
                'image_id': chunk_data.get('metadata', {}).get('imageId'),
                'documentId': chunk_data.get('documentId'),
                'similarity': float(similarity),
                'imageData': chunk_data.get('imageData')  # Include base64 image
            }
        )
        
        scored_chunks.append((doc, similarity))
    
    # Sort by similarity and get top k
    scored_chunks.sort(key=lambda x: x[1], reverse=True)
    top_chunks = [doc for doc, score in scored_chunks[:k]]
    
    print(f"✅ Retrieved {len(top_chunks)} chunks")
    if top_chunks:
        print(f"   Top scores: {[f'{x[1]:.3f}' for x in scored_chunks[:3]]}")
    
    return top_chunks

def create_multimodal_message(query, retrieved_docs):
    """
    Create message with text and images for Gemini Vision
    Exactly like your notebook!
    """
    content = []
    
    # Add the query
    content.append({
        "type": "text",
        "text": f"Question: {query}\n\nContext:\n"
    })
    
    # Separate text and image documents
    text_docs = [doc for doc in retrieved_docs if doc.metadata.get("type") == "text"]
    image_docs = [doc for doc in retrieved_docs if doc.metadata.get("type") == "image"]
    
    # Add text context
    if text_docs:
        text_context = "\n\n".join([
            f"[Page {doc.metadata['page']}]: {doc.page_content}"
            for doc in text_docs
        ])
        content.append({
            "type": "text",
            "text": f"Text excerpts:\n{text_context}\n"
        })
    
    # Add images with their base64 data
    for doc in image_docs:
        image_data = doc.metadata.get("imageData")
        if image_data:
            content.append({
                "type": "text",
                "text": f"\n[Image from page {doc.metadata['page']}]:\n"
            })
            content.append({
                "type": "image_url",
                "image_url": {
                    "url": f"data:image/png;base64,{image_data}"
                }
            })
    
    # Add instruction
    content.append({
        "type": "text",
        "text": "\n\nPlease answer the question based on the provided text and images. Be specific and cite page numbers."
    })
    
    return HumanMessage(content=content)

# ============================================
# Question Caching & History Functions
# ============================================

async def find_similar_question(question_embedding, intent="general", threshold=0.9):
    """
    Search for similar questions in cache (like Node.js findSimilarQuestion)
    """
    if not db:
        return None
    
    try:
        questions_ref = db.collection('questions').where('intent', '==', intent).stream()
        
        best_match = None
        highest_similarity = threshold
        
        for doc in questions_ref:
            data = doc.to_dict()
            if 'embedding' not in data:
                continue
            
            stored_embedding = np.array(data['embedding'])
            similarity = cosine_similarity(question_embedding, stored_embedding)
            
            if similarity > highest_similarity:
                highest_similarity = similarity
                best_match = {
                    'id': doc.id,
                    'question': data.get('question'),
                    'answer': data.get('answer'),
                    'confidence': data.get('confidence'),
                    'sources': data.get('sources', []),
                    'deadline': data.get('deadline'),
                    'similarity': float(similarity)
                }
        
        if best_match:
            print(f"✅ Found cached question (similarity: {best_match['similarity']:.3f})")
        
        return best_match
        
    except Exception as e:
        print(f"Error finding similar question: {e}")
        return None

async def store_question(question, embedding, answer, intent, confidence, sources, deadline=None):
    """
    Store question and answer in cache (like Node.js storeQuestion)
    """
    if not db:
        return None
    
    try:
        question_data = {
            'question': question,
            'embedding': embedding.tolist(),
            'answer': answer,
            'intent': intent,
            'confidence': confidence,
            'sources': sources,
            'deadline': deadline,
            'count': 1,
            'createdAt': firestore.SERVER_TIMESTAMP,
            'lastAskedAt': firestore.SERVER_TIMESTAMP,
        }
        
        doc_ref = db.collection('questions').add(question_data)
        question_id = doc_ref[1].id
        
        print(f"💾 Stored new question: {question_id}")
        return question_id
        
    except Exception as e:
        print(f"Error storing question: {e}")
        return None

async def increment_question_count(question_id):
    """
    Increment count for existing question (like Node.js incrementQuestionCount)
    """
    if not db:
        return
    
    try:
        doc_ref = db.collection('questions').document(question_id)
        doc_ref.update({
            'count': firestore.Increment(1),
            'lastAskedAt': firestore.SERVER_TIMESTAMP,
        })
        print(f"📈 Incremented count for question: {question_id}")
    except Exception as e:
        print(f"Error incrementing question count: {e}")

async def store_user_question(user_id, question_id, question_text):
    """
    Store user question history (like Node.js storeUserQuestion)
    """
    if not db:
        return
    
    try:
        user_question_data = {
            'userId': user_id,
            'questionId': question_id,
            'questionText': question_text,
            'askedAt': firestore.SERVER_TIMESTAMP,
        }
        
        db.collection('user_questions').add(user_question_data)
        print(f"📝 Stored user question history for user: {user_id}")
    except Exception as e:
        print(f"Error storing user question: {e}")

def calculate_confidence(sources):
    """
    Calculate confidence based on sources (like Node.js calculateConfidence)
    """
    if not sources or len(sources) == 0:
        return {
            "level": "Low",
            "score": 0,
            "reasoning": "No relevant sources found"
        }
    
    # Simple confidence based on number of sources
    num_sources = len(sources)
    
    if num_sources >= 3:
        return {
            "level": "High",
            "score": min(90, num_sources * 30),
            "reasoning": f"Found {num_sources} relevant sources"
        }
    elif num_sources >= 2:
        return {
            "level": "Medium",
            "score": min(90, num_sources * 30),
            "reasoning": f"Found {num_sources} relevant sources"
        }
    else:
        return {
            "level": "Low",
            "score": min(90, num_sources * 30),
            "reasoning": f"Found {num_sources} relevant source"
        }

def detect_intent(question):
    """
    Detect question intent (like Node.js detectIntent)
    """
    q = question.lower()
    
    if any(pattern in q for pattern in ['how do i', 'how to', 'procedure', 'steps']):
        return "procedure"
    
    if any(pattern in q for pattern in ['what is', 'define', 'what does']):
        return "definition"
    
    if any(pattern in q for pattern in ['requirement', 'criteria', 'eligibility']):
        return "requirement"
    
    if any(pattern in q for pattern in ['deadline', 'when', 'last date', 'by when', 'due date']):
        return "deadline"
    
    return "general"

@app.post("/query", response_model=QueryResponse)
async def query_documents(request: QueryRequest):
    """
    Query the RAG system with caching and user history
    """
    try:
        if not db:
            raise HTTPException(status_code=500, detail="Firebase not initialized")
        
        print(f"\n🔍 Query: {request.question}")
        print(f"👤 User: {request.userId}")
        
        # Detect intent
        intent = detect_intent(request.question)
        print(f"🎯 Detected intent: {intent}")
        
        # Embed the query using CLIP text embedding
        query_embedding = embed_text(request.question)
        print("✅ Query embedded")
        
        # Check cache first
        cached_question = await find_similar_question(query_embedding, intent)
        
        if cached_question:
            print(f"♻️ Reusing cached answer")
            
            # Increment count and store user question
            await increment_question_count(cached_question['id'])
            await store_user_question(
                request.userId, 
                cached_question['id'], 
                request.question
            )
            
            return QueryResponse(
                answer=cached_question['answer'],
                sources=cached_question.get('sources', []),
                hasVisualContent=any(s.get('type') == 'image' for s in cached_question.get('sources', [])),
                cached=True,
                similarity=cached_question['similarity']
            )
        
        # No cache hit - generate new answer
        print("🤖 Generating new answer")
        
        # Retrieve relevant chunks (text + images)
        context_docs = retrieve_multimodal(
            query_embedding,
            request.documentIds,
            k=5
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
        message = create_multimodal_message(request.question, context_docs)
        
        # Get response from Gemini Vision
        print("🤖 Generating answer with Gemini Vision...")
        response = llm.invoke([message])
        answer = response.content
        
        # Prepare sources
        sources = []
        for doc in context_docs:
            sources.append({
                "page": doc.metadata.get('page'),
                "type": doc.metadata.get('type'),
                "documentId": doc.metadata.get('documentId'),
                "content": doc.page_content[:150] + "..." if len(doc.page_content) > 150 else doc.page_content
            })
        
        has_visual = any(doc.metadata.get('type') == 'image' for doc in context_docs)
        
        # Calculate confidence
        confidence = calculate_confidence(sources)
        
        # Store in cache
        question_id = await store_question(
            request.question,
            query_embedding,
            answer,
            intent,
            confidence,
            sources,
            deadline=None  # You can add deadline extraction logic if needed
        )
        
        # Store user question history
        if question_id:
            await store_user_question(request.userId, question_id, request.question)
        
        print(f"✅ Answer generated and cached\n")
        
        return QueryResponse(
            answer=answer,
            sources=sources,
            hasVisualContent=has_visual,
            cached=False
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
        import aiohttp
        async with aiohttp.ClientSession() as session:
            async with session.get(request.fileUrl) as response:
                if response.status != 200:
                    raise HTTPException(status_code=400, detail="Failed to download PDF")
                pdf_bytes = await response.read()
        
        print(f"✅ Downloaded PDF: {len(pdf_bytes)} bytes")
        
        # Process PDF (your notebook logic)
        all_docs, all_embeddings, image_data_store = process_pdf_to_documents(
            pdf_bytes, request.documentId
        )
        
        # Store in Firebase with image data
        await store_chunks_in_firebase(
            request.documentId, 
            all_docs, 
            all_embeddings,
            image_data_store
        )
        
        # Update document status
        if db:
            doc_ref = db.collection("documents").document(request.documentId)
            doc_ref.update({
                "status": "Processed",
                "processedAt": firestore.SERVER_TIMESTAMP,
                "chunksCount": len(all_docs),
                "textChunks": len([d for d in all_docs if d.metadata.get("type") == "text"]),
                "visualChunks": len([d for d in all_docs if d.metadata.get("type") == "image"]),
                "isMultiModal": True,
            })
        
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

@app.get("/health")
async def health_check():
    """Health check"""
    chunk_count = 0
    
    if db:
        try:
            chunks_ref = db.collection('chunks')
            chunk_count = len(list(chunks_ref.limit(1000).stream()))
        except Exception as e:
            print(f"Error counting chunks: {e}")
    
    return {
        "status": "healthy",
        "chunks_in_firebase": chunk_count,
        "model": "CLIP + Gemini Vision (like your notebook!)",
        "firebase_connected": db is not None
    }

@app.get("/faq")
async def get_faq(limit: int = 10):
    """
    Get frequently asked questions (like Node.js /faq endpoint)
    """
    if not db:
        raise HTTPException(status_code=500, detail="Firebase not initialized")
    
    try:
        questions_ref = db.collection('questions').order_by('count', direction=firestore.Query.DESCENDING).limit(limit)
        questions = questions_ref.stream()
        
        faqs = []
        for doc in questions:
            data = doc.to_dict()
            faqs.append({
                "id": doc.id,
                "question": data.get('question'),
                "answer": data.get('answer'),
                "count": data.get('count', 0),
                "intent": data.get('intent'),
            })
        
        return {"faqs": faqs}
        
    except Exception as e:
        print(f"Error fetching FAQs: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/history/{userId}")
async def get_user_history(userId: str, limit: int = 20):
    """
    Get user's question history (like Node.js /history/:userId endpoint)
    """
    if not db:
        raise HTTPException(status_code=500, detail="Firebase not initialized")
    
    try:
        # Get user questions
        user_questions_ref = db.collection('user_questions').where('userId', '==', userId).stream()
        
        history = []
        for doc in user_questions_ref:
            data = doc.to_dict()
            question_id = data.get('questionId')
            
            # Fetch the full question details
            question_data = None
            if question_id:
                try:
                    question_doc = db.collection('questions').document(question_id).get()
                    if question_doc.exists:
                        question_data = question_doc.to_dict()
                except Exception as err:
                    print(f"Error fetching question details: {err}")
            
            history.append({
                "id": doc.id,
                "questionText": data.get('questionText'),
                "answer": question_data.get('answer') if question_data else "Answer not found",
                "askedAt": data.get('askedAt'),
            })
        
        # Sort by timestamp (descending - newest first)
        history.sort(key=lambda x: x.get('askedAt') or 0, reverse=True)
        
        # Limit results
        history = history[:limit]
        
        return {"history": history}
        
    except Exception as e:
        print(f"Error fetching user history: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)