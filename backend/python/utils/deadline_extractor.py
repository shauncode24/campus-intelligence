"""
Deadline extraction utility for calendar integration
"""
import re
from datetime import datetime
from typing import Optional, Dict, Any

def extract_deadline_info(answer: str, sources: list) -> Optional[Dict[str, Any]]:
    """
    Extract deadline information from answer text
    
    Args:
        answer: str - Generated answer text
        sources: list - Source documents
        
    Returns:
        Optional[Dict]: Deadline info if found, None otherwise
    """
    # Remove markdown formatting
    clean_answer = re.sub(r'\*\*', '', answer)
    
    # Date patterns (day month year, month day year, etc.)
    patterns = [
        (r'(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})', '%d %B %Y'),
        (r'(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})', '%B %d %Y'),
        (r'(\d{1,2})[-/](\d{1,2})[-/](\d{4})', '%d-%m-%Y'),
        (r'(\d{4})[-/](\d{1,2})[-/](\d{1,2})', '%Y-%m-%d'),
    ]
    
    for pattern, fmt in patterns:
        match = re.search(pattern, clean_answer, re.IGNORECASE)
        if match:
            date_str = match.group(0)
            try:
                deadline_date = datetime.strptime(date_str, fmt)
                
                # Only return future dates
                if deadline_date > datetime.now():
                    return {
                        'canAddToCalendar': True,
                        'date': deadline_date.strftime('%Y-%m-%d'),
                        'title': 'Deadline',
                        'description': answer[:200],
                        'context': answer,
                        'sourceDocument': sources[0].get('documentId') if sources else 'Unknown'
                    }
            except ValueError:
                continue
    
    return None