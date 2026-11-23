"""
LLM service for Gemini Vision integration
"""
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import HumanMessage
from config import Config
import tempfile
import os
import fitz
import base64
from utils.file_security import download_pdf

def _page_label(page) -> str:
    """1-based page number shown to the model and the user (chunks store 0-based)."""
    return str(page + 1) if isinstance(page, int) else "unknown"


class LLMService:
    _instance = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(LLMService, cls).__new__(cls)
            cls._instance._initialize()
        return cls._instance
    
    def _initialize(self):
        """Initialize Gemini model"""
        print("🔄 Initializing Gemini...")
        self.llm = ChatGoogleGenerativeAI(
            model=Config.GEMINI_MODEL_NAME,
            temperature=Config.GEMINI_TEMPERATURE
        )
        print("✅ Gemini initialized")
    
    async def _re_extract_image(self, file_url: str, page_num: int, img_index: int):
        """
        Re-extract a specific image from PDF
        
        Args:
            file_url: URL to the PDF file
            page_num: Page number (0-indexed)
            img_index: Image index on that page
            
        Returns:
            str: Base64 encoded image
        """
        try:
            # Download PDF (allow-listed host, no redirects, size/time capped)
            pdf_bytes = await download_pdf(file_url)
            
            # Extract image
            with tempfile.NamedTemporaryFile(delete=False, suffix='.pdf') as tmp_file:
                tmp_file.write(pdf_bytes)
                tmp_path = tmp_file.name
            
            try:
                doc = fitz.open(tmp_path)
                page = doc[page_num]
                images = page.get_images(full=True)
                
                if img_index < len(images):
                    xref = images[img_index][0]
                    base_image = doc.extract_image(xref)
                    image_bytes = base_image["image"]
                    img_base64 = base64.b64encode(image_bytes).decode()
                    doc.close()
                    return img_base64
                else:
                    doc.close()
                    return None
                    
            finally:
                os.unlink(tmp_path)
                
        except Exception as e:
            print(f"❌ Error re-extracting image: {e}")
            return None
    
    async def create_multimodal_message(self, query, retrieved_docs):
        """
        Create multimodal message with text and re-extracted images
        
        Args:
            query: str - User question
            retrieved_docs: List[Document] - Retrieved context documents
            
        Returns:
            HumanMessage: Multimodal message for Gemini
        """
        from database.firebase_client import firebase_client
        
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
                f"[Page {_page_label(doc.metadata.get('page'))}]: {doc.page_content}"
                for doc in text_docs
            ])
            content.append({
                "type": "text",
                "text": f"Text excerpts:\n{text_context}\n"
            })
        
        # Re-extract and add images
        db = firebase_client.db
        for doc in image_docs[:3]:  # Limit to top 3 images to avoid token limits
            try:
                # Get document file URL from Firestore
                doc_id = doc.metadata.get('documentId')
                doc_ref = db.collection('documents').document(doc_id).get()
                
                if doc_ref.exists:
                    file_url = doc_ref.to_dict().get('fileUrl')
                    page_num = doc.metadata.get('page')
                    
                    # Parse image index from image_id (format: docId_page_N_img_INDEX)
                    image_id = doc.metadata.get('image_id', '')
                    img_index = int(image_id.split('_img_')[-1]) if '_img_' in image_id else 0
                    
                    print(f"🔄 Re-extracting image from page {_page_label(page_num)}...")
                    
                    # Re-extract the image
                    img_base64 = await self._re_extract_image(file_url, page_num, img_index)
                    
                    if img_base64:
                        content.append({
                            "type": "text",
                            "text": f"\n[Image from page {_page_label(page_num)}]:\n"
                        })
                        content.append({
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/png;base64,{img_base64}"
                            }
                        })
                        print(f"✅ Added image from page {_page_label(page_num)}")
                    else:
                        print(f"⚠️ Could not extract image from page {_page_label(page_num)}")
                        
            except Exception as e:
                print(f"❌ Error processing image: {e}")
                continue
        
        # Add instruction
        content.append({
            "type": "text",
            "text": "\n\nPlease answer the question based on the provided text and images. Be specific and cite page numbers when relevant."
        })
        
        return HumanMessage(content=content)
    
    def generate_answer(self, message):
        """
        Generate answer using Gemini
        
        Args:
            message: HumanMessage - Multimodal message
            
        Returns:
            str: Generated answer
        """
        print("🤖 Generating answer with Gemini Vision...")
        response = self.llm.invoke([message])
        return response.content

# Singleton instance
llm_service = LLMService()