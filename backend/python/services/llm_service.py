"""
LLM service for Gemini Vision integration
"""
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import HumanMessage
from config import Config

class LLMService:
    _instance = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(LLMService, cls).__new__(cls)
            cls._instance._initialize()
        return cls._instance
    
    def _initialize(self):
        """Initialize Gemini model"""
        print("📄 Initializing Gemini...")
        self.llm = ChatGoogleGenerativeAI(
            model=Config.GEMINI_MODEL_NAME,
            temperature=Config.GEMINI_TEMPERATURE
        )
        print("✅ Gemini initialized")
    
    def create_multimodal_message(self, query, retrieved_docs):
        """
        Create multimodal message with text and images for Gemini Vision
        
        Args:
            query: str - User question
            retrieved_docs: List[Document] - Retrieved context documents
            
        Returns:
            HumanMessage: Multimodal message for Gemini
        """
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
                f"[Page {doc.metadata['page']}]: {doc.page_content}"
                for doc in text_docs
            ])
            content.append({
                "type": "text",
                "text": f"Text excerpts:\n{text_context}\n"
            })
        
        # Add images with their base64 data
        for doc in image_docs:
            image_data = doc.metadata.get("imageData")
            if image_data:
                content.append({
                    "type": "text",
                    "text": f"\n[Image from page {doc.metadata['page']}]:\n"
                })
                content.append({
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:image/png;base64,{image_data}"
                    }
                })
        
        # Add instruction
        content.append({
            "type": "text",
            "text": "\n\nPlease answer the question based on the provided text and images. Be specific and cite page numbers."
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