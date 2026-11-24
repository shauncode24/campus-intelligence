"""
Safe error responses.

Unexpected exceptions must never be echoed to the client: they can contain
Firestore paths, internal URLs, query text or other implementation detail.
The full error is logged on the server under a short reference id; the client
only gets the id, which an operator can search for in the logs.
"""
import sys
import traceback
import uuid

from fastapi import HTTPException


def internal_error(exc: Exception, context: str = "") -> HTTPException:
    """Log `exc` with a reference id and return a generic 500 to raise."""
    ref = uuid.uuid4().hex[:8]
    where = context or sys._getframe(1).f_code.co_name
    from utils.observability import current_request_id
    print(f"❌ [{ref}] [request {current_request_id()}] {where}: {type(exc).__name__}: {exc}")
    traceback.print_exception(type(exc), exc, exc.__traceback__)
    return HTTPException(status_code=500, detail=f"Internal server error (ref {ref})")
