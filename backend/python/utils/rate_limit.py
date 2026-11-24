"""
Rate limiting and LLM budgets for the RAG service.

An in-memory sliding-window limiter. It is per process: counters reset on
restart and are not shared between several workers/instances. That is enough
as a first line of defence for a single instance; use a shared store (e.g.
Redis) if the service is scaled out.

Rejected attempts are NOT recorded, so hammering the endpoint does not extend
a lockout.
"""
import math
import threading
import time
from collections import deque

from fastapi import Depends, HTTPException, Request

from auth import get_current_user_id, require_admin
from config import Config


class SlidingWindowLimiter:
    def __init__(self, clock=time.monotonic, max_keys: int = 50000):
        self._clock = clock
        self._max_keys = max_keys
        self._hits = {}  # key -> (deque[timestamps], window_seconds)
        self._lock = threading.Lock()

    def check(self, key: str, limit: int, window: float) -> float:
        """
        Record one hit for `key` if it is within `limit` hits per `window`
        seconds. Returns 0.0 if allowed, otherwise the seconds to wait.
        A limit <= 0 disables the check.
        """
        if limit <= 0:
            return 0.0
        now = self._clock()
        with self._lock:
            if len(self._hits) > self._max_keys:
                self._prune(now)
            hits, _ = self._hits.setdefault(key, (deque(), window))
            self._hits[key] = (hits, window)
            while hits and hits[0] <= now - window:
                hits.popleft()
            if len(hits) >= limit:
                return max(hits[0] + window - now, 0.001)
            hits.append(now)
            return 0.0

    def _prune(self, now: float) -> None:
        """Drop keys with no hits inside their window (bounds memory)."""
        for k in [k for k, (h, w) in self._hits.items() if not h or h[-1] <= now - w]:
            del self._hits[k]


limiter = SlidingWindowLimiter()


def client_ip(request: Request) -> str:
    """
    Caller IP. Two headers are believed, each only from a caller we trust:
    `X-Client-IP` (set by our own Node API, which saw the real client) when the direct caller is in
    TRUSTED_PROXY_IPS, and `X-Forwarded-For` when TRUST_PROXY is set (a reverse proxy in front).
    """
    peer = request.client.host if request.client else None
    if peer and peer in Config.TRUSTED_PROXY_IPS:
        forwarded_ip = (request.headers.get("x-client-ip") or "").strip()
        if forwarded_ip and len(forwarded_ip) <= 64:
            return forwarded_ip
    if Config.TRUST_PROXY:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def too_many(wait: float, message: str) -> HTTPException:
    retry = max(1, math.ceil(wait))
    return HTTPException(
        status_code=429,
        detail=message,
        headers={"Retry-After": str(retry)},
    )


def _enforce(key: str, limit: int, window: float, message: str) -> None:
    wait = limiter.check(key, limit, window)
    if wait > 0:
        raise too_many(wait, message)


SLOW_DOWN = "Too many requests. Please wait a moment and try again."


def general_user_limit(user_id: str = Depends(get_current_user_id)) -> None:
    """Default per-user limit for ordinary authenticated endpoints."""
    _enforce(f"general:{user_id}", Config.USER_RATE_PER_MINUTE, 60, SLOW_DOWN)


def write_user_limit(user_id: str = Depends(get_current_user_id)) -> None:
    """Stricter per-user limit for endpoints that write data."""
    _enforce(f"write:{user_id}", Config.WRITE_RATE_PER_MINUTE, 60, SLOW_DOWN)


def query_limit(request: Request, user_id: str = Depends(get_current_user_id)) -> None:
    """
    Limit on asking questions: per user, and per IP (accounts are free to
    create, so the user limit alone is not enough).
    """
    _enforce(f"query:{user_id}", Config.QUERY_RATE_PER_MINUTE, 60,
             "You're asking questions too quickly. Please wait a moment and try again.")
    _enforce(f"query-ip:{client_ip(request)}", Config.QUERY_RATE_PER_MINUTE_PER_IP, 60,
             "Too many questions from your network. Please wait a moment and try again.")


def admin_limit(admin_id: str = Depends(require_admin)) -> None:
    """Limit on admin actions (document processing is CPU heavy)."""
    _enforce(f"admin:{admin_id}", Config.ADMIN_RATE_PER_MINUTE, 60, SLOW_DOWN)


def consume_llm_budget(user_id: str) -> None:
    """
    Spend one LLM call from the per-user and global daily budgets. Call it only
    immediately before an actual model call (cache hits and refusals that never
    reach the model cost nothing).
    """
    _enforce(f"llm-day:{user_id}", Config.LLM_CALLS_PER_USER_PER_DAY, 86400,
             "You've reached today's question limit. Please try again tomorrow.")
    _enforce("llm-day:GLOBAL", Config.LLM_CALLS_GLOBAL_PER_DAY, 86400,
             "The assistant has reached its daily capacity. Please try again tomorrow.")
