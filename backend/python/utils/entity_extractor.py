"""
Entity extraction utilities for academic queries
"""

def extract_entities(question: str) -> dict:
    """
    Extract academic entities from question (year, program, semester)
    
    Args:
        question: str - User question
        
    Returns:
        dict: Extracted entities
    """
    q = question.lower()
    entities = {}
    
    # Academic year
    if "fy" in q:
        entities["year"] = "FY"
    elif "sy" in q:
        entities["year"] = "SY"
    elif "ty" in q:
        entities["year"] = "TY"
    elif "ly" in q:
        entities["year"] = "LY"
    
    # Program
    if "btech" in q:
        entities["program"] = "BTech"
    elif "mtech" in q:
        entities["program"] = "MTech"
    
    # Semester
    if "sem 1" in q or "semester 1" in q:
        entities["semester"] = 1
    elif "sem 2" in q or "semester 2" in q:
        entities["semester"] = 2
    elif "sem 3" in q or "semester 3" in q:
        entities["semester"] = 3
    elif "sem 4" in q or "semester 4" in q:
        entities["semester"] = 4
    
    return entities


def entities_match(a: dict, b: dict) -> bool:
    """
    Check if two entity dictionaries match
    
    Args:
        a: dict - First entity dict
        b: dict - Second entity dict
        
    Returns:
        bool: True if entities match
    """
    return a == b