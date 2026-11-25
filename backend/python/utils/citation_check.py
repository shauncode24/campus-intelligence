"""
Checking the citations in a model's answer against what the model was actually shown (P1-5).

The model is told to cite as [Document name, p. N]. Nothing forced it to cite only what it was
given, and the sources list used to be every retrieved passage whether it was used or not. Now:

* a citation naming a document/page that was NOT among the passages shown to the model is
  fabricated: it is removed from the answer text (a wrong page reference is worse than none);
* the sources listed with the answer are the ones actually cited. If the answer cites nothing
  that checks out, every retrieved source is kept and the answer is flagged `uncited`, so the
  student still sees where it came from and the metrics can count it.
"""
import re
from dataclasses import dataclass, field

# "[Fee Policy, p. 2]", "[Fee Policy, version v2, effective 2025-01-01, p. 2]", "[Fee Policy, pp. 2-3]", "[Fee Policy, p. 2, 4]"
CITATION = re.compile(r"\[([^\[\]\n]{1,300}?),\s*(?:page|pp?)\.?\s*(\d+(?:\s*(?:[-–,]|and)\s*\d+)*)\s*\]", re.IGNORECASE)


def _norm(text) -> str:
    text = " ".join(str(text or "").split()).lower()
    return re.sub(r"^source:\s*", "", text)


def _pages(expression: str) -> list:
    """'2' -> [2]; '2-4' -> [2, 3, 4]; '2, 5' -> [2, 5]"""
    numbers = [int(n) for n in re.findall(r"\d+", expression)]
    if re.search(r"\d\s*[-–]\s*\d", expression) and len(numbers) == 2 and 0 < numbers[1] - numbers[0] <= 50:
        return list(range(numbers[0], numbers[1] + 1))
    return numbers


@dataclass
class CitationCheck:
    answer: str
    sources: list
    cited: int = 0             # citations that match a passage the model was shown
    removed: int = 0           # citations that do not (fabricated), taken out of the text
    uncited: bool = False      # nothing in the answer checked out against a source
    changed: bool = False      # the answer text differs from what the model wrote
    cited_pages: set = field(default_factory=set)


def check_citations(answer: str, sources: list) -> CitationCheck:
    """Validate `answer`'s citations against `sources` (the passages shown to the model)."""
    sources = list(sources or [])
    if not answer or not sources:
        return CitationCheck(answer=answer or "", sources=sources)

    known = set()
    for s in sources:
        name = _norm(s.get("documentName"))
        page = s.get("displayPage")
        known.add((name, page))
    names = {n for n, _ in known}

    cited_keys, stats = set(), {"cited": 0, "removed": 0}

    def judge(match):
        label, pages = _norm(match.group(1)), _pages(match.group(2))
        # "[Doc, version v2, effective 2025-01-01, p. 2]": the document name is the start of the label
        name = next((n for n in sorted(names, key=len, reverse=True) if label == n or label.startswith(n + ",")), None)
        ok = name is not None and bool(pages) and all((name, p) in known for p in pages)
        if ok:
            stats["cited"] += 1
            cited_keys.update((name, p) for p in pages)
            return match.group(0)
        stats["removed"] += 1
        return ""

    cleaned = CITATION.sub(judge, answer)
    changed = cleaned != answer
    if changed:
        cleaned = re.sub(r"[ \t]+([.,;:!?])", r"\1", cleaned)      # "fee is Rs. 5,000 ." after a removal
        cleaned = re.sub(r"[ \t]{2,}", " ", cleaned).strip()

    if cited_keys:
        kept = [s for s in sources if (_norm(s.get("documentName")), s.get("displayPage")) in cited_keys]
    else:
        kept = sources
    return CitationCheck(answer=cleaned, sources=kept, cited=stats["cited"], removed=stats["removed"],
                         uncited=not cited_keys, changed=changed, cited_pages=cited_keys)
