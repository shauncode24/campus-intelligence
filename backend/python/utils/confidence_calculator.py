"""
Confidence calculation utility
"""

def calculate_confidence(sources: list) -> dict:
    """
    Calculate confidence based on source quality and similarity
    
    Args:
        sources: list - Source documents with similarity scores
        
    Returns:
        dict: Confidence information with level, score, and reasoning
    """
    if not sources or len(sources) == 0:
        return {
            "level": "Low",
            "score": 0,
            "reasoning": "No relevant sources found"
        }
    
    # Calculate average similarity from sources
    similarities = []
    for source in sources:
        if 'similarity' in source:
            similarities.append(source['similarity'])
    
    # Calculate score based on similarity
    if similarities:
        avg_similarity = sum(similarities) / len(similarities)
        score = int(avg_similarity * 100)
    else:
        # Fallback to count-based scoring
        num_sources = len(sources)
        score = min(60, num_sources * 20)
    
    # Determine confidence level
    if score >= 70:
        level = "High"
    elif score >= 50:
        level = "Medium"
    else:
        level = "Low"
    
    return {
        "level": level,
        "score": score,
        "reasoning": f"Found {len(sources)} relevant sources with average confidence {score}%"
    }