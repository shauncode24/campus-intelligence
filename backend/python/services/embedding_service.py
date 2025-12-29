"""
CLIP embedding service for text and images
"""
import torch
import numpy as np
from transformers import CLIPProcessor, CLIPModel
from PIL import Image
from config import Config

class EmbeddingService:
    _instance = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(EmbeddingService, cls).__new__(cls)
            cls._instance._initialize()
        return cls._instance
    
    def _initialize(self):
        """Load CLIP model and processor"""
        print("📄 Loading CLIP model...")
        self.model = CLIPModel.from_pretrained(Config.CLIP_MODEL_NAME)
        self.processor = CLIPProcessor.from_pretrained(Config.CLIP_MODEL_NAME)
        self.model.eval()
        print("✅ CLIP model loaded")
    
    def embed_image(self, image_data):
        """
        Embed image using CLIP
        
        Args:
            image_data: PIL Image or path to image file
            
        Returns:
            numpy.ndarray: Image embedding
        """
        if isinstance(image_data, str):
            image = Image.open(image_data).convert("RGB")
        else:
            image = image_data
        
        inputs = self.processor(images=image, return_tensors="pt")
        
        with torch.no_grad():
            features = self.model.get_image_features(**inputs)
            features = features / features.norm(dim=-1, keepdim=True)
            return features.squeeze().numpy()
    
    def embed_text(self, text):
        """
        Embed text using CLIP
        
        Args:
            text: str - Text to embed
            
        Returns:
            numpy.ndarray: Text embedding
        """
        inputs = self.processor(
            text=text,
            return_tensors="pt",
            padding=True,
            truncation=True,
            max_length=77
        )
        
        with torch.no_grad():
            features = self.model.get_text_features(**inputs)
            features = features / features.norm(dim=-1, keepdim=True)
            return features.squeeze().numpy()
    
    @staticmethod
    def cosine_similarity(a, b):
        """Calculate cosine similarity between two vectors"""
        return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))

# Singleton instance
embedding_service = EmbeddingService()