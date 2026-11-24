"""
Entities used to decide whether two questions may share a cached answer.

Two questions that are nearly identical in wording but differ in a detail that changes the
answer ("fees for sem 5" / "fees for sem 6", "BTech" / "MTech", "Rs 500" / "Rs 5000") must
NEVER share an answer, however similar their embeddings are. So the rule is strict: every
such detail in one question must be present, and equal, in the other.

Everything is matched on whole words/numbers. (The first version used substring tests, so
"ty" matched in "university" and "penalty", and only semesters 1-4 were recognised.)
"""
import re

_YEARS = {"fy": "FY", "sy": "SY", "ty": "TY", "ly": "LY"}
_PROGRAMS = {"btech": "BTech", "b.tech": "BTech", "mtech": "MTech", "m.tech": "MTech",
             "phd": "PhD", "diploma": "Diploma", "mba": "MBA", "bsc": "BSc", "msc": "MSc"}

_YEAR_RE = re.compile(r"\b(fy|sy|ty|ly)\b")
_PROGRAM_RE = re.compile(r"(?<![a-z])(b\.?tech|m\.?tech|phd|diploma|mba|bsc|msc)(?![a-z])")
_SEMESTER_RE = re.compile(r"\b(?:sem|semester)\s*[-:]?\s*(\d{1,2})\b")
_NUMBER_RE = re.compile(r"\d+(?:[.,]\d+)*")


def _numbers(q: str) -> list:
    """All numbers in the question ('Rs. 5,000' -> '5000'), sorted, as strings."""
    found = []
    for raw in _NUMBER_RE.findall(q):
        found.append(re.sub(r"(?<=\d),(?=\d{3}\b)", "", raw).rstrip(".,"))
    return sorted(found)


def extract_entities(question: str) -> dict:
    """
    Details that change an answer: academic year (FY/SY/TY/LY), programme, semester and every
    number in the question. Returns only what is present.
    """
    q = (question or "").lower()
    entities = {}

    years = sorted({_YEARS[m] for m in _YEAR_RE.findall(q)})
    if years:
        entities["year"] = years
    programs = sorted({_PROGRAMS[m] for m in _PROGRAM_RE.findall(q)})
    if programs:
        entities["program"] = programs
    semesters = sorted({int(m) for m in _SEMESTER_RE.findall(q)})
    if semesters:
        entities["semester"] = semesters
    numbers = _numbers(q)
    if numbers:
        entities["numbers"] = numbers
    return entities


def entities_match(a: dict, b: dict) -> bool:
    """True only if both questions mention exactly the same details."""
    return (a or {}) == (b or {})
