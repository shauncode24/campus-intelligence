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
    def processed_document_ids(db) -> set:
        """
        Ids of documents that are fully processed and live. Chunks of any other
        document (deleted, still processing, errored, being deleted) must never
        be used to answer a question. Nothing but the id is downloaded.
        """
        return {
            d.id
            for d in db.collection('documents').where('status', '==', 'Processed').select(['status']).stream()
        }

    @staticmethod
    def retrieve_multimodal(query_embedding, document_ids=None, k=None, image_query_embedding=None):
        """
        Retrieve relevant chunks from Firebase.

        TEXT chunks are scored with the text-model question vector `query_embedding`
        and the top k are returned. IMAGE chunks are scored with the CLIP question
        vector `image_query_embedding` (a different similarity scale, so they are
        ranked and thresholded on their own): at most Config.IMAGE_TOP_K images
        scoring at least Config.MIN_IMAGE_SCORE are returned after the text chunks.
        Pass image_query_embedding=None to skip images.

        Chunks from documents that are not "Processed", and chunks whose vectors
        came from a different model than the one scoring them, are ignored.

        Returns:
            List[Document]: text chunks (best first) then image chunks (best first)
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

        # Only chunks of fully processed, still-existing documents may be used
        processed_ids = RetrievalService.processed_document_ids(db)

        # Only vectors from the model that produced the query vector can be compared
        # with it. Chunks stored before vectors were tagged came from CLIP.
        text_model = embedding_service.model_id
        image_model = embedding_service.image_model_id
        ignored_other_model = 0

        text_scored, image_scored = [], []

        for chunk_doc in chunks_snapshot:
            chunk_data = chunk_doc.to_dict()

            if 'embedding' not in chunk_data:
                continue

            if chunk_data.get('documentId') not in processed_ids:
                continue

            # Filter by document IDs if list is too large for 'in' query
            if document_ids and len(document_ids) > 10:
                if chunk_data.get('documentId') not in document_ids:
                    continue

            is_image = chunk_data.get('type', 'text') == 'image'
            chunk_model = chunk_data.get('embeddingModel') or Config.CLIP_MODEL_NAME

            if is_image:
                if image_query_embedding is None:
                    continue  # image search not requested/available
                if chunk_model != image_model:
                    ignored_other_model += 1
                    continue
                query_vector = image_query_embedding
            else:
                if chunk_model != text_model:
                    ignored_other_model += 1
                    continue
                query_vector = query_embedding

            similarity = embedding_service.cosine_similarity(
                query_vector,
                np.array(chunk_data['embedding'])
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
            (image_scored if is_image else text_scored).append((doc, similarity))

        if ignored_other_model:
            print(f"⚠️ {ignored_other_model} chunks were indexed with a different embedding model "
                  f"and were ignored (text: {text_model}). Re-process those documents "
                  f"(python scripts/reindex_all.py).")

        text_scored.sort(key=lambda x: x[1], reverse=True)
        image_scored.sort(key=lambda x: x[1], reverse=True)

        top_text = [doc for doc, score in text_scored[:k]]
        top_images = [
            doc for doc, score in image_scored[:Config.IMAGE_TOP_K]
            if score >= Config.MIN_IMAGE_SCORE
        ]

        print(f"✅ Retrieved {len(top_text)} text chunks and {len(top_images)} images")
        if text_scored:
            print(f"   Top text scores: {[f'{x[1]:.3f}' for x in text_scored[:3]]}")
        if image_scored:
            print(f"   Top image scores: {[f'{x[1]:.3f}' for x in image_scored[:3]]} (floor {Config.MIN_IMAGE_SCORE})")

        return top_text + top_images

    @staticmethod
    def filter_relevant(docs, min_score=None):
        """
        Drop chunks that are too dissimilar to the question to be worth showing
        the model. Only TEXT chunks are scored against the threshold (image
        chunks live on a different similarity scale); image chunks are kept only
        if at least one text chunk is relevant. Returns [] if nothing is
        relevant, which callers treat as "not in the documents".
        """
        if min_score is None:
            min_score = Config.MIN_RETRIEVAL_SCORE

        kept = [
            d for d in docs
            if d.metadata.get('type', 'text') != 'text'
            or d.metadata.get('similarity', 0) >= min_score
        ]
        if not any(d.metadata.get('type', 'text') == 'text' for d in kept):
            return []
        return kept

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
            
            # `page` is the 0-based index stored with the chunk (kept for
            # backwards compatibility). `displayPage` is the 1-based number a
            # human sees; it is the same number the LLM is shown in its prompt.
            raw_page = doc.metadata.get('page')
            sources.append({
                "page": raw_page,
                "displayPage": raw_page + 1 if isinstance(raw_page, int) else None,
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