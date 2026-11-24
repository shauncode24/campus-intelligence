"""
Vector retrieval service for finding relevant chunks
"""
import numpy as np
from langchain_core.documents import Document
from fastapi import HTTPException
from database.firebase_client import firebase_client
from services.embedding_service import embedding_service
from config import Config
from services.document_validity import is_live, matches_filters
from services.vector_index import vector_index

class RetrievalService:
    LIVE_FIELDS = ['status', 'effectiveDate', 'expiryDate', 'supersededBy', 'department', 'documentType']

    @staticmethod
    def live_document_ids(db, filters=None, today=None) -> set:
        """
        Ids of documents that may be used to answer a question right now: fully
        processed, not superseded by a newer version, in force (effective date reached)
        and not expired, and matching the optional metadata `filters`
        ({'department': ..., 'documentType': ...}). Chunks of any other document
        (deleted, still processing, errored, being deleted, old version, expired) must
        never be used. Only the few fields needed for the decision are downloaded.
        """
        ids = set()
        query = db.collection('documents').where('status', '==', 'Processed').select(RetrievalService.LIVE_FIELDS)
        for d in query.stream():
            record = d.to_dict() or {}
            if is_live(record, today) and matches_filters(record, filters):
                ids.add(d.id)
        return ids

    @staticmethod
    def _scan_scored(db, query_embedding, document_ids, image_query_embedding, filters):
        """The original path: read every chunk from Firestore for this question. Used only when
        the in-memory index is off or the corpus is over its size cap."""
        chunks_ref = db.collection('chunks')

        # Build query
        if document_ids and len(document_ids) <= 10:
            query = chunks_ref.where('documentId', 'in', document_ids)
        else:
            query = chunks_ref

        chunks_snapshot = query.stream()

        # Only chunks of live documents may be used: processed, current version, in force, not expired
        processed_ids = RetrievalService.live_document_ids(db, filters)

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

            # A caption chunk is an image that was described in text: it is searched
            # exactly like text. Only image chunks WITHOUT a caption are CLIP vectors.
            is_caption = bool(chunk_data.get('isCaption'))
            is_image = chunk_data.get('type', 'text') == 'image' and not is_caption
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
                    'xref': chunk_data.get('metadata', {}).get('xref'),  # For re-extraction if needed
                    'caption': is_caption,
                    'chunkId': chunk_doc.id,   # lets feedback name the exact passages behind an answer
                }
            )
            (image_scored if is_image else text_scored).append((doc, similarity))

        return text_scored, image_scored, ignored_other_model

    _warned_cap = False

    @staticmethod
    def _as_document(chunk_id, doc_id, meta, similarity):
        return Document(
            page_content=meta.get('content', ''),
            metadata={
                'page': meta.get('page'),
                'type': meta.get('type', 'text'),
                'image_id': meta.get('image_id'),
                'documentId': doc_id,
                'similarity': float(similarity),
                'xref': meta.get('xref'),
                'caption': meta.get('caption', False),
                'chunkId': chunk_id,
            }
        )

    @staticmethod
    def _index_scored(db, query_embedding, document_ids, image_query_embedding, filters, k):
        """Same result as _scan_scored, from memory: only live documents (read fresh), best k text
        chunks and best IMAGE_TOP_K images."""
        allowed = RetrievalService.live_document_ids(db, filters)
        if document_ids:
            allowed &= set(document_ids)
        text_hits, ignored = vector_index.search(False, embedding_service.model_id, query_embedding, allowed, k)
        image_hits = []
        if image_query_embedding is not None:
            image_hits, ignored_img = vector_index.search(
                True, embedding_service.image_model_id, image_query_embedding, allowed, Config.IMAGE_TOP_K)
            ignored += ignored_img
        to_scored = lambda hits: [(RetrievalService._as_document(*h), h[3]) for h in hits]
        return to_scored(text_hits), to_scored(image_hits), ignored

    @staticmethod
    def retrieve_multimodal(query_embedding, document_ids=None, k=None, image_query_embedding=None,
                            filters=None):
        """
        Retrieve relevant chunks from Firebase.

        TEXT chunks are scored with the text-model question vector `query_embedding`
        and the top k are returned. IMAGE chunks are scored with the CLIP question
        vector `image_query_embedding` (a different similarity scale, so they are
        ranked and thresholded on their own): at most Config.IMAGE_TOP_K images
        scoring at least Config.MIN_IMAGE_SCORE are returned after the text chunks.
        Pass image_query_embedding=None to skip images. `filters` limits the search to
        documents whose metadata matches (e.g. {'department': 'Library'}).

        Chunks from documents that are not live (see live_document_ids), and chunks whose vectors
        came from a different model than the one scoring them, are ignored.

        Returns:
            List[Document]: text chunks (best first) then image chunks (best first)
        """
        if k is None:
            k = Config.TOP_K_RETRIEVAL

        db = firebase_client.db
        if not db:
            raise HTTPException(status_code=500, detail="Firebase not initialized")

        text_scored = image_scored = None
        if Config.VECTOR_INDEX_ENABLED:
            from database.corpus_epoch import get_epoch
            if vector_index.ensure(db, get_epoch(db), Config.VECTOR_INDEX_MAX_CHUNKS):
                text_scored, image_scored, ignored_other_model = RetrievalService._index_scored(
                    db, query_embedding, document_ids, image_query_embedding, filters, k)
            elif not RetrievalService._warned_cap:
                RetrievalService._warned_cap = True
                print(f"⚠️ More than {Config.VECTOR_INDEX_MAX_CHUNKS} chunks: not indexed in memory, "
                      f"scanning Firestore per question. Time for a real vector store (AUDIT P2-1).")
        if text_scored is None:
            text_scored, image_scored, ignored_other_model = RetrievalService._scan_scored(
                db, query_embedding, document_ids, image_query_embedding, filters)

        if ignored_other_model:
            print(f"⚠️ {ignored_other_model} chunks were indexed with a different embedding model "
                  f"and were ignored (text: {embedding_service.model_id}). Re-process those documents "
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
    def _is_textual(doc):
        """Plain text, or an image that was described in text (scored like text)."""
        return doc.metadata.get('type', 'text') == 'text' or bool(doc.metadata.get('caption'))

    @staticmethod
    def filter_relevant(docs, min_score=None):
        """
        Drop chunks that are too dissimilar to the question to be worth showing
        the model. Text chunks AND image descriptions are scored against the
        threshold. Legacy CLIP image chunks (no description) live on a different
        similarity scale and were already filtered at retrieval, so they are kept
        only if at least one textual chunk is relevant. Returns [] if nothing is
        relevant, which callers treat as "not in the documents".
        """
        if min_score is None:
            min_score = Config.MIN_RETRIEVAL_SCORE

        kept = [
            d for d in docs
            if not RetrievalService._is_textual(d)
            or d.metadata.get('similarity', 0) >= min_score
        ]
        if not any(RetrievalService._is_textual(d) for d in kept):
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
        doc_cache = {}      # several passages of one document: read it once

        for doc in context_docs:
            doc_id = doc.metadata.get('documentId')
            doc_name = "Document"
            file_url = None
            version = effective = expiry = None
            
            # Get document metadata from Firebase
            if doc_id and db:
                try:
                    if doc_id not in doc_cache:
                        snap = db.collection('documents').document(doc_id).get()
                        doc_cache[doc_id] = (snap.to_dict() or {}) if snap.exists else None
                    doc_data = doc_cache[doc_id]
                    if doc_data is not None:
                        doc_name = doc_data.get('name', 'Document')
                        file_url = doc_data.get('fileUrl')
                        version = doc_data.get('version')
                        effective = doc_data.get('effectiveDate')
                        expiry = doc_data.get('expiryDate')
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
                "chunkId": doc.metadata.get('chunkId'),
                "documentName": doc_name,
                "fileUrl": file_url,
                "version": version,
                "effectiveDate": effective,
                "expiryDate": expiry,
                "content": content,
                "similarity": doc.metadata.get('similarity', 0)
            })
        
        return sources

# Singleton instance
retrieval_service = RetrievalService()