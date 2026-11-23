"""
Authentication dependency for the RAG service.

Every user-scoped endpoint must depend on `get_current_user_id`. The caller's
identity is taken ONLY from a verified Firebase ID token
(`Authorization: Bearer <token>`), never from a request body, query string or
path parameter.
"""
from typing import Optional

from fastapi import Header, HTTPException
from firebase_admin import auth as firebase_auth

from database.firebase_client import firebase_client


def get_current_user_id(authorization: Optional[str] = Header(default=None)) -> str:
    """Verify the Firebase ID token and return the caller's uid."""
    if not firebase_client.is_connected:
        raise HTTPException(status_code=503, detail="Authentication service unavailable")

    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(
            status_code=401,
            detail="Missing or malformed Authorization header",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        decoded = firebase_auth.verify_id_token(token.strip())
    except ValueError:
        # Covers invalid, expired and malformed tokens
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except firebase_auth.CertificateFetchError:
        raise HTTPException(status_code=503, detail="Authentication service unavailable")
    except Exception as e:
        # Never log the token itself
        print(f"❌ Unexpected token verification error: {type(e).__name__}")
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    uid = decoded.get("uid")
    if not uid:
        raise HTTPException(status_code=401, detail="Invalid token")
    return uid
