"""
Firebase storage service for chunks and documents
Images are NOT stored - only embeddings and metadata to avoid 1MB Firestore limit
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
            image_data_store: Dict - Base64 image data (NOT STORED - only used for embeddings)
        """
        db = firebase_client.db
        if not db:
            print("⚠️ Firebase not available")
            return
        
        try:
            batch = db.batch()
            batch_count = 0
            max_batch_size = 500  # Firestore batch limit
            
            print(f"📦 Storing {len(all_docs)} chunks in Firestore...")
            
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
                
                # NOTE: We do NOT store imageData to avoid Firestore's 1MB field limit
                # Image chunks only store embeddings and metadata for semantic search
                # If you need to display images, store them in Supabase Storage separately
                
                batch.set(chunk_ref, chunk_data)
                batch_count += 1
                
                # Commit batch if we hit the limit
                if batch_count >= max_batch_size:
                    batch.commit()
                    print(f"  ✅ Committed batch of {batch_count} chunks")
                    batch = db.batch()
                    batch_count = 0
            
            # Commit remaining chunks
            if batch_count > 0:
                batch.commit()
                print(f"  ✅ Committed final batch of {batch_count} chunks")
            
            print(f"✅ Stored {len(all_docs)} chunks in Firebase (embeddings only)")
            
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
            print(f"⚠️ Error updating document status: {e}")

    @staticmethod
    async def update_document_status_enhanced(doc_id: str, all_docs: List[Document], metadata: dict):
        """
        Update document processing status with enhanced metadata
        
        Args:
            doc_id: str - Document identifier
            all_docs: List[Document] - Processed document chunks
            metadata: dict - Additional document metadata
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
            print(f"✅ Updated document with enhanced metadata: {doc_id}")
            
        except Exception as e:
            print(f"⚠️ Error updating document status: {e}")

# Singleton instance
storage_service = StorageService()