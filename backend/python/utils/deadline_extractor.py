"""
Deadline extraction for the "Add to calendar" button.

Offers a date only when the answer says a deadline-like thing about it ("due", "last date",
"before", ...), so an answer that merely mentions a future date ("the new building opens on
3 March 2027") does not get a calendar button. Numeric dates are read day first (05/03/2027 is
5 March), as in Indian documents.
"""
import re
from datetime import date, datetime
from typing import Optional, Dict, Any

MONTHS = {
    "january": 1, "jan": 1, "february": 2, "feb": 2, "march": 3, "mar": 3, "april": 4, "apr": 4,
    "may": 5, "june": 6, "jun": 6, "july": 7, "jul": 7, "august": 8, "aug": 8,
    "september": 9, "sept": 9, "sep": 9, "october": 10, "oct": 10, "november": 11, "nov": 11,
    "december": 12, "dec": 12,
}
_MONTH = r"(January|February|March|April|May|June|July|August|September|Sept|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?"
_ORD = r"(?:st|nd|rd|th)?"

# (compiled pattern, how to read the match as (year, month, day))
_PATTERNS = [
    # 5 May 2026, 5th of May, 2026
    (re.compile(rf"\b(\d{{1,2}}){_ORD}\s+(?:of\s+)?{_MONTH},?\s+(\d{{4}})\b", re.I),
     lambda m: (int(m.group(3)), MONTHS[m.group(2).lower()], int(m.group(1)))),
    # May 5, 2026 / May 5th 2026
    (re.compile(rf"\b{_MONTH}\s+(\d{{1,2}}){_ORD},?\s+(\d{{4}})\b", re.I),
     lambda m: (int(m.group(3)), MONTHS[m.group(1).lower()], int(m.group(2)))),
    # 2026-05-05 or 2026/05/05
    (re.compile(r"\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b"),
     lambda m: (int(m.group(1)), int(m.group(2)), int(m.group(3)))),
    # 05/05/2026, 5-5-2026 (day first)
    (re.compile(r"\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b"),
     lambda m: (int(m.group(3)), int(m.group(2)), int(m.group(1)))),
]

# Words that make a nearby date a deadline
_DEADLINE_WORDS = re.compile(
    r"\b(deadline|due|last\s+(?:date|day)|closes?|closing|ends?|by|before|until|till|no\s+later\s+than|"
    r"on\s+or\s+before|submit\w*|regist\w*|apply|application|payable|pay|fee\s+payment|cut-?off)\b", re.I)
_NEAR = 90        # characters either side of the date


def _find_dates(text: str):
    """Every valid calendar date in the text as (date, start, end), in order of appearance."""
    found = []
    for pattern, read in _PATTERNS:
        for m in pattern.finditer(text):
            try:
                y, mo, d = read(m)
                found.append((date(y, mo, d), m.start(), m.end()))
            except (ValueError, KeyError):
                continue
    # one date can match two patterns (e.g. year-first inside another form): keep distinct spans
    found.sort(key=lambda t: t[1])
    out, last_end = [], -1
    for item in found:
        if item[1] >= last_end:
            out.append(item)
            last_end = item[2]
    return out


def _sentence_around(text: str, start: int, end: int) -> str:
    left = max(text.rfind(". ", 0, start), text.rfind("\n", 0, start))
    left = 0 if left < 0 else left + 1
    stops = [i for i in (text.find(". ", end), text.find("\n", end)) if i >= 0]
    right = min(stops) + 1 if stops else len(text)
    return text[left:right].strip()


def extract_deadline_info(answer: str, sources: list, today: Optional[date] = None) -> Optional[Dict[str, Any]]:
    """
    The soonest upcoming date in `answer` that is described as a deadline, or None.

    Returns {'canAddToCalendar', 'date' (YYYY-MM-DD, an all-day event), 'title', 'description',
    'context', 'sourceDocument' (the document's NAME), 'allDay'}.
    """
    if not answer:
        return None
    today = today or datetime.now().date()
    text = re.sub(r"\*\*|__", "", answer)

    candidates = []
    for found_date, start, end in _find_dates(text):
        if found_date < today:
            continue
        window = text[max(0, start - _NEAR):end + _NEAR]
        if _DEADLINE_WORDS.search(window):
            candidates.append((found_date, start, end))
    if not candidates:
        return None

    found_date, start, end = min(candidates, key=lambda c: (c[0], c[1]))
    first = (sources or [{}])[0] if sources else {}
    document = (first.get("documentName") or first.get("name") or "").strip() if isinstance(first, dict) else ""
    sentence = _sentence_around(text, start, end)
    return {
        "canAddToCalendar": True,
        "date": found_date.isoformat(),
        "allDay": True,
        "title": f"Deadline: {document}" if document else "Deadline",
        "description": sentence[:300],
        "context": text,
        "sourceDocument": document or "Campus documents",
    }
