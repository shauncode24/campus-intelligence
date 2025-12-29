"""
PDF processing service for extracting text and images
"""
import fitz  # PyMuPDF
import tempfile
import os
import io
import base64
import numpy as np
from PIL import Image
from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter
from config import Config
from services.embedding_service import embedding_service

class PDFProcessor:
    def __init__(self):
        self.text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=Config.CHUNK_SIZE,
            chunk_overlap=Config.CHUNK_OVERLAP
        )
    
    def process_pdf(self, pdf_bytes: bytes, doc_id: str):
        """
        Process PDF and extract text chunks and images with embeddings
        
        Args:
            pdf_bytes: PDF file as bytes
            doc_id: Document identifier
            
        Returns:
            tuple: (documents, embeddings, image_data_store)
        """
        all_docs = []
        all_embeddings = []
        image_data_store = {}
        
        with tempfile.NamedTemporaryFile(delete=False, suffix='.pdf') as tmp_file:
            tmp_file.write(pdf_bytes)
            tmp_path = tmp_file.name
        
        try:
            doc = fitz.open(tmp_path)
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
                
                # Process images
                image_docs, image_embeddings, page_images = self._process_images(
                    page, doc, page_num, doc_id
                )
                all_docs.extend(image_docs)
                all_embeddings.extend(image_embeddings)
                image_data_store.update(page_images)
            
            doc.close()
            print(f"✅ Processing complete: {len(all_docs)} chunks created")
            
        finally:
            os.unlink(tmp_path)
        
        return all_docs, np.array(all_embeddings), image_data_store
    
    def _process_text(self, text: str, page_num: int, doc_id: str):
        """Process text content from a page"""
        docs = []
        embeddings = []
        
        temp_doc = Document(
            page_content=text,
            metadata={"page": page_num, "type": "text", "documentId": doc_id}
        )
        
        text_chunks = self.text_splitter.split_documents([temp_doc])
        
        for chunk in text_chunks:
            embedding = embedding_service.embed_text(chunk.page_content)
            embeddings.append(embedding)
            docs.append(chunk)
        
        return docs, embeddings
    
    def _process_images(self, page, doc, page_num: int, doc_id: str):
        """Process images from a page"""
        docs = []
        embeddings = []
        image_store = {}
        
        for img_index, img in enumerate(page.get_images(full=True)):
            try:
                xref = img[0]
                base_image = doc.extract_image(xref)
                image_bytes = base_image["image"]
                
                # Convert to PIL Image
                pil_image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
                
                # Create unique identifier
                image_id = f"{doc_id}_page_{page_num}_img_{img_index}"
                
                # Store image as base64
                buffered = io.BytesIO()
                pil_image.save(buffered, format="PNG")
                img_base64 = base64.b64encode(buffered.getvalue()).decode()
                image_store[image_id] = img_base64
                
                # Embed image using CLIP
                embedding = embedding_service.embed_image(pil_image)
                embeddings.append(embedding)
                
                # Create document for image
                image_doc = Document(
                    page_content=f"[Image: {image_id}]",
                    metadata={
                        "page": page_num,
                        "type": "image",
                        "image_id": image_id,
                        "documentId": doc_id
                    }
                )
                docs.append(image_doc)
                print(f"      ✅ Processed image {img_index}")
                
            except Exception as e:
                print(f"      ⚠️ Error processing image {img_index}: {e}")
                continue
        
        return docs, embeddings, image_store

# Singleton instance
pdf_processor = PDFProcessor()