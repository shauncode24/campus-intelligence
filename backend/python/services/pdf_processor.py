"""
PDF processing service for extracting text and images
"""
import fitz  # PyMuPDF
import tempfile
import os
import io
import numpy as np
from PIL import Image
from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter
from config import Config
from services.embedding_service import embedding_service
from utils.file_security import InvalidPdf

class PDFProcessor:
    def __init__(self):
        self.text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=Config.CHUNK_SIZE,
            chunk_overlap=Config.CHUNK_OVERLAP
        )
    
    def process_pdf(self, pdf_bytes: bytes, doc_id: str):
        """
        Process PDF and extract text chunks and images with embeddings
        Images are NOT stored - only their embeddings
        
        Args:
            pdf_bytes: PDF file as bytes
            doc_id: Document identifier
            
        Returns:
            tuple: (documents, embeddings) with one vector per document. Each document's
            metadata['embedding_model'] says which model produced its vector.
        """
        all_docs = []
        all_embeddings = []
        
        with tempfile.NamedTemporaryFile(delete=False, suffix='.pdf') as tmp_file:
            tmp_file.write(pdf_bytes)
            tmp_path = tmp_file.name
        
        try:
            doc = fitz.open(tmp_path)
            if len(doc) > Config.MAX_PDF_PAGES:
                page_count = len(doc)
                doc.close()
                raise InvalidPdf(
                    f"PDF has {page_count} pages; the limit is {Config.MAX_PDF_PAGES}"
                )
            print(f"📄 Processing {len(doc)} pages...")
            
            for page_num, page in enumerate(doc):
                print(f"   Page {page_num + 1}/{len(doc)}...")
                
                # Process text
                text = page.get_text()
                if text.strip():
                    text_docs, text_embeddings = self._process_text(
                        text, page_num, doc_id
                    )
                    all_docs.extend(text_docs)
                    all_embeddings.extend(text_embeddings)
                
                # Process images - only embeddings
                image_docs, image_embeddings = self._process_images(
                    page, doc, page_num, doc_id
                )
                all_docs.extend(image_docs)
                all_embeddings.extend(image_embeddings)
            
            doc.close()
            print(f"✅ Processing complete: {len(all_docs)} chunks created")
            
        finally:
            os.unlink(tmp_path)
        
        # a list, not one array: text vectors and image vectors have different sizes
        return all_docs, all_embeddings
    
    def _process_text(self, text: str, page_num: int, doc_id: str):
        """Process text content from a page"""
        docs = []
        embeddings = []
        
        temp_doc = Document(
            page_content=text,
            metadata={"page": page_num, "type": "text", "documentId": doc_id}
        )
        
        text_chunks = self.text_splitter.split_documents([temp_doc])
        
        if not text_chunks:
            return docs, embeddings
        
        # Embed the whole page's chunks in one batch (much faster than one by one)
        vectors = embedding_service.embed_texts([c.page_content for c in text_chunks])
        for chunk, vector in zip(text_chunks, vectors):
            chunk.metadata["embedding_model"] = embedding_service.model_id
            embeddings.append(vector)
            docs.append(chunk)
        
        return docs, embeddings
    
    def _process_images(self, page, doc, page_num: int, doc_id: str):
        """
        Process images from a page
        Only store embeddings - NOT the actual image data
        """
        docs = []
        embeddings = []
        
        # Images are embedded with CLIP; skipped only if image search is disabled
        if not embedding_service.supports_images:
            return docs, embeddings
        
        for img_index, img in enumerate(page.get_images(full=True)):
            try:
                xref = img[0]
                base_image = doc.extract_image(xref)
                image_bytes = base_image["image"]
                
                # Convert to PIL Image
                pil_image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
                
                # Create unique identifier
                image_id = f"{doc_id}_page_{page_num}_img_{img_index}"
                
                # ✅ Embed image using CLIP
                embedding = embedding_service.embed_image(pil_image)
                embeddings.append(embedding)
                
                # ✅ Create document with metadata only (no image data)
                image_doc = Document(
                    page_content=f"[Image on page {page_num + 1}]",
                    metadata={
                        "page": page_num,
                        "type": "image",
                        "image_id": image_id,
                        "xref": xref,  # Store xref for potential re-extraction
                        "embedding_model": embedding_service.image_model_id,
                        "documentId": doc_id
                    }
                )
                docs.append(image_doc)
                print(f"      ✅ Processed image {img_index} (embedding only)")
                
            except Exception as e:
                print(f"      ⚠️ Error processing image {img_index}: {e}")
                continue
        
        return docs, embeddings

# Singleton instance
pdf_processor = PDFProcessor()