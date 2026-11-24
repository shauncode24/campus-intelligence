"""
PDF processing service for extracting text and images
"""
import fitz  # PyMuPDF
import tempfile
import os
import io
import hashlib
import numpy as np
from PIL import Image
from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter
from config import Config
from services.embedding_service import embedding_service
from utils.file_security import InvalidPdf
from services.image_captioner import ImageCaptioner, OK, SKIP_DECORATIVE

# After this many captioning failures in a row (e.g. an API outage) stop calling
# the model for the rest of the document and fall back to CLIP instead.
MAX_CONSECUTIVE_CAPTION_FAILURES = 3
MAX_CAPTION_IMAGE_SIDE = 1600   # larger images are shrunk before being sent

class PDFProcessor:
    def __init__(self):
        self.text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=Config.CHUNK_SIZE,
            chunk_overlap=Config.CHUNK_OVERLAP
        )
        self.captioner = ImageCaptioner()
        self.last_image_stats = {}
        self.last_text_stats = {}
    
    def process_pdf(self, pdf_bytes: bytes, doc_id: str, progress=None):
        """
        Process PDF and extract text chunks and images with embeddings
        Images are NOT stored - only their embeddings
        
        Args:
            pdf_bytes: PDF file as bytes
            doc_id: Document identifier
            progress: optional callable(pages_done, total_pages), called before the first
                page (0, n) and after each page. Whatever it raises (for example a
                cancellation) propagates and stops the processing.
            
        Returns:
            tuple: (documents, embeddings) with one vector per document. Each document's
            metadata['embedding_model'] says which model produced its vector.
        """
        all_docs = []
        all_embeddings = []
        pages_with_text = 0
        text_chars = 0
        self._image_state = {
            "seen": set(), "considered": 0, "consecutive_failures": 0,
            "stats": {"found": 0, "captioned": 0, "fell_back_to_clip": 0, "decorative": 0,
                      "small": 0, "duplicate": 0, "over_cap": 0, "caption_failed": 0, "not_indexed": 0},
        }
        
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
            total_pages = len(doc)
            print(f"📄 Processing {total_pages} pages...")
            if progress:
                progress(0, total_pages)
            
            for page_num, page in enumerate(doc):
                print(f"   Page {page_num + 1}/{len(doc)}...")
                
                # Process text
                text = page.get_text()
                page_chars = len(text.strip())
                text_chars += page_chars
                if page_chars >= Config.MIN_TEXT_CHARS_PER_PAGE:
                    pages_with_text += 1
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
                if progress:
                    progress(page_num + 1, total_pages)
            
            doc.close()
            self.last_text_stats = {"pages": total_pages, "pagesWithText": pages_with_text,
                                    "textChars": text_chars}
            self.last_image_stats = self._image_state["stats"]
            print(f"✅ Processing complete: {len(all_docs)} chunks created")
            if self.last_image_stats["found"]:
                print(f"🖼️ Images: {self.last_image_stats}")
            
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
    
    @staticmethod
    def _png_for_model(pil_image):
        """PNG bytes of the image, shrunk if very large (cheaper and faster to caption)."""
        image = pil_image.copy()
        image.thumbnail((MAX_CAPTION_IMAGE_SIDE, MAX_CAPTION_IMAGE_SIDE))
        buf = io.BytesIO()
        image.save(buf, format="PNG")
        return buf.getvalue()

    def _process_images(self, page, doc, page_num: int, doc_id: str):
        """
        Index the meaningful images on a page.

        Filters first (so no model is called for junk): exact duplicates within the
        document (a logo repeated on every page), images too small to carry
        information, and anything beyond Config.MAX_IMAGES_PER_DOCUMENT.

        Then, with captioning on, Gemini describes the image and the DESCRIPTION is
        indexed as text (metadata caption=True). If the model says the image is
        decorative it is dropped; if captioning fails or is off, the image falls
        back to a CLIP vector. Image data itself is never stored: it is re-extracted
        from the PDF when needed.
        """
        docs = []
        embeddings = []
        state = self._image_state
        stats = state["stats"]

        for img_index, img in enumerate(page.get_images(full=True)):
            stats["found"] += 1
            try:
                xref = img[0]
                image_bytes = doc.extract_image(xref)["image"]

                digest = hashlib.sha1(image_bytes).hexdigest()
                if digest in state["seen"]:
                    stats["duplicate"] += 1
                    continue
                state["seen"].add(digest)

                pil_image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
                width, height = pil_image.size
                if min(width, height) < Config.MIN_IMAGE_SIDE or width * height < Config.MIN_IMAGE_PIXELS:
                    stats["small"] += 1
                    continue

                if state["considered"] >= Config.MAX_IMAGES_PER_DOCUMENT:
                    stats["over_cap"] += 1
                    continue
                state["considered"] += 1

                image_id = f"{doc_id}_page_{page_num}_img_{img_index}"
                base_metadata = {
                    "page": page_num,
                    "type": "image",
                    "image_id": image_id,
                    "xref": xref,  # for re-extracting the pixels at question time
                    "documentId": doc_id,
                }

                caption = None
                if Config.IMAGE_CAPTIONING and state["consecutive_failures"] < MAX_CONSECUTIVE_CAPTION_FAILURES:
                    status, caption = self.captioner.caption(self._png_for_model(pil_image))
                    if status == SKIP_DECORATIVE:
                        stats["decorative"] += 1
                        state["consecutive_failures"] = 0
                        continue
                    if status == OK:
                        state["consecutive_failures"] = 0
                    else:
                        stats["caption_failed"] += 1
                        state["consecutive_failures"] += 1

                if caption:
                    docs.append(Document(
                        page_content=caption,
                        metadata={**base_metadata, "caption": True,
                                  "embedding_model": embedding_service.model_id},
                    ))
                    embeddings.append(embedding_service.embed_text(caption))
                    stats["captioned"] += 1
                    print(f"      ✅ Image {img_index}: described and indexed as text")
                elif embedding_service.supports_images:
                    docs.append(Document(
                        page_content=f"[Image on page {page_num + 1}]",
                        metadata={**base_metadata, "embedding_model": embedding_service.image_model_id},
                    ))
                    embeddings.append(embedding_service.embed_image(pil_image))
                    stats["fell_back_to_clip"] += 1
                    print(f"      ✅ Image {img_index}: indexed with CLIP (no description)")
                else:
                    stats["not_indexed"] += 1

            except Exception as e:
                print(f"      ⚠️ Error processing image {img_index}: {e}")
                continue

        return docs, embeddings

# Singleton instance
pdf_processor = PDFProcessor()