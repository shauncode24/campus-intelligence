"""
Firebase storage service for chunks and documents
Images are NOT stored - only embeddings and metadata to avoid 1MB Firestore limit
"""
import numpy as np
from typing import List, Dict
from firebase_admin import firestore
from database.firebase_client import firebase_client
from utils.threads import offload_async_methods
from langchain_core.documents import Document

@offload_async_methods
class StorageService:
    @staticmethod
    def delete_stale_chunks(doc_id: str, keep_ids: set) -> int:
        """
        Delete every chunk of `doc_id` whose id is not in `keep_ids`.

        Chunks used to get random ids, so re-processing a document appended a
        second copy of everything. Chunks now have deterministic ids
        (`{doc_id}_{index}`), so a re-run overwrites the same documents, and
        this removes whatever is left over: chunks from an earlier, longer run
        and legacy random-id chunks.
        """
        db = firebase_client.db
        if not db:
            return 0

        deleted = 0
        batch = db.batch()
        pending = 0
        # select(['documentId']) keeps the query from downloading embeddings
        for snap in db.collection('chunks').where('documentId', '==', doc_id).select(['documentId']).stream():
            if snap.id in keep_ids:
                continue
            batch.delete(snap.reference)
            pending += 1
            deleted += 1
            if pending >= 450:  # Firestore batch limit is 500
                batch.commit()
                batch = db.batch()
                pending = 0
        if pending:
            batch.commit()
        return deleted

    @staticmethod
    async def store_chunks(doc_id: str, all_docs: List[Document], 
                          all_embeddings: np.ndarray, embedding_model: str = None):
        """
        Store document chunks and embeddings in Firebase
        NO image data stored - only embeddings and metadata
        
        Args:
            doc_id: str - Document identifier
            all_docs: List[Document] - Document chunks
            all_embeddings: np.ndarray - Chunk embeddings
            embedding_model: str - id of the model that produced the embeddings. Stored
                with every chunk: vectors from different models cannot be compared, so
                retrieval ignores chunks produced by any other model.
        """
        db = firebase_client.db
        if not db:
            print("⚠️ Firebase not available")
            return
        
        try:
            batch = db.batch()
            batch_count = 0
            max_batch_size = 500  # Firestore batch limit
            keep_ids = set()
            
            print(f"📦 Storing {len(all_docs)} chunks in Firestore...")
            
            for idx, (doc, embedding) in enumerate(zip(all_docs, all_embeddings)):
                # Deterministic id: re-processing overwrites instead of duplicating
                chunk_id = f"{doc_id}_{idx}"
                keep_ids.add(chunk_id)
                chunk_ref = db.collection('chunks').document(chunk_id)
                
                chunk_data = {
                    'documentId': doc_id,
                    'index': idx,
                    'content': doc.page_content,
                    'type': doc.metadata.get('type', 'text'),
                    'embedding': embedding.tolist(),
                    'embeddingModel': doc.metadata.get('embedding_model') or embedding_model,
                    'embeddingDim': int(len(embedding)),
                    'isCaption': bool(doc.metadata.get('caption', False)),
                    'metadata': {
                        'pageNumber': doc.metadata.get('page'),
                        'imageId': doc.metadata.get('image_id'),
                        'xref': doc.metadata.get('xref'),  # ✅ Store PyMuPDF xref for re-extraction
                    },
                    'createdAt': firestore.SERVER_TIMESTAMP,
                    'isMultiModal': True
                }
                
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
            
            # Remove chunks left over from a previous run of this document
            stale = StorageService.delete_stale_chunks(doc_id, keep_ids)
            if stale:
                print(f"  🧹 Removed {stale} stale chunks from a previous run")

            print(f"✅ Stored {len(all_docs)} chunks in Firebase (embeddings only)")
            
        except Exception as e:
            print(f"❌ Error storing chunks: {e}")
            raise
    
    @staticmethod
    async def update_document_status(doc_id: str, all_docs: List[Document],
                                     extra: Dict = None, also: List = None):
        """
        Mark a document "Processed" in Firebase.

        Args:
            doc_id: str - Document identifier
            all_docs: List[Document] - Processed document chunks
            extra: optional further fields to set in the same write
            also: optional [(other_document_id, fields)] written in the SAME atomic batch, so
                  that for example the new version becomes current and the old one is retired
                  at the same instant (never both current, never neither)
        """
        db = firebase_client.db
        if not db:
            return

        try:
            doc_ref = db.collection("documents").document(doc_id)
            fields = {
                "status": "Processed",
                "processedAt": firestore.SERVER_TIMESTAMP,
                "chunksCount": len(all_docs),
                "textChunks": len([d for d in all_docs if d.metadata.get("type") == "text"]),
                "visualChunks": len([d for d in all_docs if d.metadata.get("type") == "image"]),
                "isMultiModal": True,
                **(extra or {}),
            }
            batch = db.batch()
            batch.update(doc_ref, fields)
            for other_id, other_fields in (also or []):
                batch.update(db.collection("documents").document(other_id), other_fields)
            batch.commit()
            print(f"✅ Updated document status: {doc_id}")
        except Exception as e:
            # Not swallowed: a document that finished indexing but could not be marked
            # "Processed" would stay hidden from answers forever without anyone knowing.
            print(f"❌ Error updating document status: {e}")
            raise

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