"""
The display metadata that goes with an answer: sources, deadline, flags.

Built in one place, stored with the answer message, and sent to the browser as-is, so
what a user sees live and what they see after reopening the chat are the same thing.
"""
import math


def _percent(similarity) -> int:
    return int(math.floor((similarity or 0) * 100 + 0.5))


def build_message_metadata(response) -> dict:
    return {
        "cached": bool(response.cached),
        "cachedAtMs": response.cachedAtMs,
        "answered": response.answered is not False,
        # set when a follow-up was rewritten into a standalone question
        "standaloneQuestion": response.standaloneQuestion,
        "similarity": response.similarity,
        "sources": [
            {
                "documentId": s.get("documentId"),
                "chunkId": s.get("chunkId"),
                "documentName": s.get("documentName") or "Document",
                "pageNumber": s.get("page"),               # 0-based, legacy
                "displayPage": s.get("displayPage"),       # 1-based, what users should see
                "type": s.get("type"),
                "excerpt": s.get("content"),
                "similarity": _percent(s.get("similarity")),
                "fileUrl": s.get("fileUrl"),
                "version": s.get("version"),
                "effectiveDate": s.get("effectiveDate"),
            }
            for s in (response.sources or [])
        ],
        "hasVisualContent": bool(response.hasVisualContent),
        "deadline": response.deadline,
        **({"stopped": True} if getattr(response, "stopped", False) else {}),
    }
