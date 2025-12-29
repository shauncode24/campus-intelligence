"""
Intent detection utility
"""

def detect_intent(question: str) -> str:
    """
    Detect the intent of a question
    
    Args:
        question: str - User question
        
    Returns:
        str: Detected intent category
    """
    q = question.lower()
    
    if any(pattern in q for pattern in ['how do i', 'how to', 'procedure', 'steps']):
        return "procedure"
    
    if any(pattern in q for pattern in ['what is', 'define', 'what does']):
        return "definition"
    
    if any(pattern in q for pattern in ['requirement', 'criteria', 'eligibility']):
        return "requirement"
    
    if any(pattern in q for pattern in ['deadline', 'when', 'last date', 'by when', 'due date']):
        return "deadline"
    
    return "general"