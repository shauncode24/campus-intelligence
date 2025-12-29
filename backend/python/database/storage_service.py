"""
Firebase storage service for chunks and documents
"""
import numpy as np
from typing import List, Dict
from firebase_admin import firestore
from database.firebase_client import firebase_client
from langchain_core.documents import Document

class StorageService:
    @staticmethod
    async def store_chunks(doc_id: str, all_docs: List[Document], 
                          all_embeddings: np.ndarray, image_data_store: Dict):
        """
        Store document chunks and embeddings in Firebase
        
        Args:
            doc_id: str - Document identifier
            all_docs: List[Document] - Document chunks
            all_embeddings: np.ndarray - Chunk embeddings
            image_data_store: Dict - Base64 image data
        """
        db = firebase_client.db
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
                
                # Store base64 image data for image chunks
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
    
    @staticmethod
    async def update_document_status(doc_id: str, all_docs: List[Document]):
        """
        Update document processing status in Firebase
        
        Args:
            doc_id: str - Document identifier
            all_docs: List[Document] - Processed document chunks
        """
        db = firebase_client.db
        if not db:
            return
        
        try:
            doc_ref = db.collection("documents").document(doc_id)
            doc_ref.update({
                "status": "Processed",
                "processedAt": firestore.SERVER_TIMESTAMP,
                "chunksCount": len(all_docs),
                "textChunks": len([d for d in all_docs if d.metadata.get("type") == "text"]),
                "visualChunks": len([d for d in all_docs if d.metadata.get("type") == "image"]),
                "isMultiModal": True,
            })
            print(f"✅ Updated document status: {doc_id}")
        except Exception as e:
            print(f"Error updating document status: {e}")

# Singleton instance
storage_service = StorageService()