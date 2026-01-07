"""
FAQ routes for Python RAG service
Add this to your main.py or create a separate routes file
"""
from fastapi import APIRouter, Query
from typing import Optional
from database.cache_repository import cache_repository

router = APIRouter()

@router.get("/faq")
async def get_faq(
    limit: int = Query(default=10, ge=1, le=100),
    intent: Optional[str] = Query(default=None),
    sort_by: Optional[str] = Query(default="popular")
):
    """
    Get frequently asked questions with filtering and sorting
    
    Query Parameters:
    - limit: Number of FAQs to return (1-100)
    - intent: Filter by intent type (deadline, procedure, requirement, definition, general)
    - sort_by: Sort order (popular, recent, category)
    """
    try:
        # Get FAQs from cache repository with higher limit for filtering
        all_faqs = await cache_repository.get_faq(limit=100)
        
        # Filter by intent if specified
        if intent and intent != "all":
            all_faqs = [faq for faq in all_faqs if faq.get("intent") == intent]
        
        # Sort based on sort_by parameter
        if sort_by == "recent":
            # Sort by lastAskedAt or createdAt
            all_faqs.sort(
                key=lambda x: x.get("lastAskedAt", x.get("createdAt", 0)),
                reverse=True
            )
        elif sort_by == "category":
            # Sort by intent alphabetically
            all_faqs.sort(key=lambda x: x.get("intent", ""))
        else:  # popular (default)
            # Already sorted by count in get_faq
            pass
        
        # Limit results
        faqs = all_faqs[:limit]
        
        # Enrich FAQ data with additional information
        enriched_faqs = []
        for faq in faqs:
            enriched_faq = {
                "id": faq.get("id"),
                "question": faq.get("question"),
                "answer": faq.get("answer"),
                "intent": faq.get("intent", "general"),
                "count": faq.get("count", 0),
                "confidence": faq.get("confidence"),
                "sources": faq.get("sources", []),
                "createdAt": faq.get("createdAt"),
                "lastAskedAt": faq.get("lastAskedAt"),
            }
            enriched_faqs.append(enriched_faq)
        
        return {
            "faqs": enriched_faqs,
            "total": len(all_faqs),
            "returned": len(enriched_faqs),
            "filters": {
                "intent": intent,
                "sort_by": sort_by,
                "limit": limit
            }
        }
        
    except Exception as e:
        print(f"❌ Error fetching FAQs: {e}")
        return {
            "faqs": [],
            "total": 0,
            "returned": 0,
            "error": str(e)
        }


@router.get("/faq/stats")
async def get_faq_stats():
    """
    Get FAQ statistics (total questions, by category, etc.)
    """
    try:
        all_faqs = await cache_repository.get_faq(limit=1000)
        
        # Count by intent
        intent_counts = {}
        total_asks = 0
        
        for faq in all_faqs:
            intent = faq.get("intent", "general")
            count = faq.get("count", 0)
            
            intent_counts[intent] = intent_counts.get(intent, 0) + 1
            total_asks += count
        
        return {
            "total_questions": len(all_faqs),
            "total_asks": total_asks,
            "by_category": intent_counts,
            "most_asked": all_faqs[0] if all_faqs else None
        }
        
    except Exception as e:
        print(f"❌ Error fetching FAQ stats: {e}")
        return {
            "total_questions": 0,
            "total_asks": 0,
            "by_category": {},
            "error": str(e)
        }


@router.post("/faq/{faq_id}/report")
async def report_faq_issue(faq_id: str, issue_type: str, description: str):
    """
    Report an issue with an FAQ answer
    
    This could be stored in a separate collection for admin review
    """
    try:
        # TODO: Implement issue reporting to Firestore
        # For now, just log it
        print(f"🚨 FAQ Issue Report:")
        print(f"   FAQ ID: {faq_id}")
        print(f"   Type: {issue_type}")
        print(f"   Description: {description}")
        
        return {
            "success": True,
            "message": "Issue reported successfully"
        }
        
    except Exception as e:
        print(f"❌ Error reporting issue: {e}")
        return {
            "success": False,
            "error": str(e)
        }