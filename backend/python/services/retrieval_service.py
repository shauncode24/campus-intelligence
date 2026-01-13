"""
Vector retrieval service for finding relevant chunks
"""
import numpy as np
from langchain_core.documents import Document
from fastapi import HTTPException
from database.firebase_client import firebase_client
from services.embedding_service import embedding_service
from config import Config

class RetrievalService:
    @staticmethod
    def retrieve_multimodal(query_embedding, document_ids=None, k=None):
        """
        Retrieve relevant chunks from Firebase using CLIP similarity
        """
        if k is None:
            k = Config.TOP_K_RETRIEVAL
        
        db = firebase_client.db
        if not db:
            raise HTTPException(status_code=500, detail="Firebase not initialized")
        
        print(f"🔍 Retrieving chunks from Firebase...")
        
        chunks_ref = db.collection('chunks')
        
        # Build query
        if document_ids and len(document_ids) <= 10:
            query = chunks_ref.where('documentId', 'in', document_ids)
        else:
            query = chunks_ref
        
        chunks_snapshot = query.stream()
        
        # Score all chunks
        scored_chunks = []
        
        for chunk_doc in chunks_snapshot:
            chunk_data = chunk_doc.to_dict()
            
            if 'embedding' not in chunk_data:
                continue
            
            # Filter by document IDs if list is too large for 'in' query
            if document_ids and len(document_ids) > 10:
                if chunk_data.get('documentId') not in document_ids:
                    continue
            
            # Calculate similarity
            chunk_embedding = np.array(chunk_data['embedding'])
            similarity = embedding_service.cosine_similarity(
                query_embedding, 
                chunk_embedding
            )
            
            # Create Document object - NO image data
            doc = Document(
                page_content=chunk_data.get('content', ''),
                metadata={
                    'page': chunk_data.get('metadata', {}).get('pageNumber'),
                    'type': chunk_data.get('type', 'text'),
                    'image_id': chunk_data.get('metadata', {}).get('imageId'),
                    'documentId': chunk_data.get('documentId'),
                    'similarity': float(similarity),
                    'xref': chunk_data.get('metadata', {}).get('xref')  # For re-extraction if needed
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
    
    @staticmethod
    def prepare_sources(context_docs):
        """
        Prepare source information from retrieved documents
        
        Args:
            context_docs: List[Document] - Retrieved documents
            
        Returns:
            List[Dict]: Formatted source information
        """
        db = firebase_client.db
        sources = []
        
        for doc in context_docs:
            doc_id = doc.metadata.get('documentId')
            doc_name = "Document"
            file_url = None
            
            # Get document metadata from Firebase
            if doc_id and db:
                try:
                    doc_ref = db.collection('documents').document(doc_id).get()
                    if doc_ref.exists:
                        doc_data = doc_ref.to_dict()
                        doc_name = doc_data.get('name', 'Document')
                        file_url = doc_data.get('fileUrl')
                except Exception as e:
                    print(f"Error fetching document metadata: {e}")
            
            content = doc.page_content
            if len(content) > 150:
                content = content[:150] + "..."
            
            sources.append({
                "page": doc.metadata.get('page'),
                "type": doc.metadata.get('type'),
                "documentId": doc_id,
                "documentName": doc_name,
                "fileUrl": file_url,
                "content": content,
                "similarity": doc.metadata.get('similarity', 0)
            })
        
        return sources

# Singleton instance
retrieval_service = RetrievalService()