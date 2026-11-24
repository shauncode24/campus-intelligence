"""
Intent detection. The intent only partitions the answer cache (a question is looked up
among cached questions of the same intent), so a wrong label costs a cache miss, never a wrong
answer. Matching is on whole words/phrases (substring tests matched inside other words), and
the order matters: "what is the last date to pay fees" is a deadline question, not a definition.
"""
import re

# Checked in this order; the first match wins.
_PATTERNS = [
    ("procedure", r"\b(?:how (?:do|can|should|to)\b|procedure|steps?|process (?:for|to|of))"),
    ("deadline", r"\b(?:deadlines?|last date|due date|by when|when (?:is|are|do|does|will|can|should)|"
                 r"until when|closing date|cut-?off date)\b"),
    ("requirement", r"\b(?:requirements?|criteria|eligib\w*|eligible|prerequisites?|qualif\w+)\b"),
    ("definition", r"\b(?:what is|what are|what does|define|meaning of|stands? for)\b"),
]
_COMPILED = [(name, re.compile(pattern)) for name, pattern in _PATTERNS]


def detect_intent(question: str) -> str:
    q = (question or "").lower()
    for name, pattern in _COMPILED:
        if pattern.search(q):
            return name
    return "general"
