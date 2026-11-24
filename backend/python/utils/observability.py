"""
Observability for the RAG service (AUDIT P2-5), with no outside service required.

* Request ids: every request gets an id (taken from `X-Request-ID` when the caller sent a
  well-formed one, otherwise made up), returned in the response header and attached to every
  log event and error of that request, so one question can be followed across the Node API and
  this service.
* `log_event(...)`: one JSON object per line on stdout (`{"ts", "event", "requestId", ...}`),
  easy to search and ship to any log tool. It never contains a question, an answer or a raw user
  id (users appear as a short one-way hash).
* `QueryObservation`: per question, how long each stage took, time to first word, model tokens
  and the estimated cost, and how it ended (answered / cached / declined / stopped / error).
* `metrics`: the last few thousand questions kept in memory and summarised on request
  (percentiles per stage, cost per question, outcomes). Per process, lost on restart.
"""
import contextvars
import hashlib
import json
import re
import sys
import threading
import time
import uuid
from collections import deque

_REQUEST_ID = contextvars.ContextVar("request_id", default=None)
_QUERY = contextvars.ContextVar("query_observation", default=None)

_ID_FORMAT = re.compile(r"^[A-Za-z0-9._-]{8,64}$")


# ------------------------------------------------------------------ request ids

def new_request_id() -> str:
    return uuid.uuid4().hex[:16]


def accept_request_id(header_value) -> str:
    """The caller's id if it is well formed (so logs of two services line up), else a new one."""
    if isinstance(header_value, str) and _ID_FORMAT.match(header_value):
        return header_value
    return new_request_id()


def set_request_id(value):
    return _REQUEST_ID.set(value)


def current_request_id():
    return _REQUEST_ID.get()


# ------------------------------------------------------------------ log events

def user_tag(user_id) -> str:
    """A short one-way hash: enough to see that two events are the same person, not who."""
    return hashlib.sha256(str(user_id).encode("utf-8")).hexdigest()[:8] if user_id else "-"


def log_event(event: str, **fields) -> None:
    record = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + f".{int(time.time() * 1000) % 1000:03d}Z",
              "event": event, "requestId": current_request_id()}
    record.update({k: v for k, v in fields.items() if v is not None})
    try:
        sys.stdout.write(json.dumps(record, ensure_ascii=False, default=str) + "\n")
        sys.stdout.flush()
    except Exception:       # logging must never break a request
        pass


# ------------------------------------------------------------------ model usage and cost

def add_usage(response_or_chunk) -> None:
    """Add the token counts the model reported (if any) to the current question."""
    obs = _QUERY.get()
    usage = getattr(response_or_chunk, "usage_metadata", None)
    if obs is None or not usage:
        return
    get = usage.get if hasattr(usage, "get") else (lambda k, d=0: getattr(usage, k, d))
    obs.tokens_in += int(get("input_tokens", 0) or 0)
    obs.tokens_out += int(get("output_tokens", 0) or 0)


def note_model_call() -> None:
    obs = _QUERY.get()
    if obs is not None:
        obs.model_calls += 1


def estimate_cost(tokens_in: int, tokens_out: int) -> float:
    """Estimated dollars, from the configured per-million-token prices (see config.py)."""
    from config import Config
    return (tokens_in * Config.GEMINI_PRICE_IN_PER_MTOK + tokens_out * Config.GEMINI_PRICE_OUT_PER_MTOK) / 1_000_000


# ------------------------------------------------------------------ one question

class QueryObservation:
    """Timings, usage and outcome of one question. `mark(name)` closes the stage that just ended."""

    def __init__(self):
        self.started = time.perf_counter()
        self._last = self.started
        self.stages = {}
        self.outcome = None
        self.ttft_ms = None
        self._gen_start = None
        self.tokens_in = self.tokens_out = self.model_calls = 0
        self.sources = 0
        self.coalesced = False      # waited for an identical question already being answered

    def mark(self, stage: str) -> None:
        now = time.perf_counter()
        self.stages[stage] = self.stages.get(stage, 0.0) + (now - self._last) * 1000.0
        self._last = now

    def generation_started(self) -> None:
        self._gen_start = time.perf_counter()

    def first_piece(self) -> None:
        if self.ttft_ms is None and self._gen_start is not None:
            self.ttft_ms = (time.perf_counter() - self._gen_start) * 1000.0

    @property
    def total_ms(self) -> float:
        return (time.perf_counter() - self.started) * 1000.0

    def summary(self) -> dict:
        return {
            "outcome": self.outcome or "unknown",
            "totalMs": round(self.total_ms),
            "stagesMs": {k: round(v) for k, v in self.stages.items()},
            "ttftMs": None if self.ttft_ms is None else round(self.ttft_ms),
            "modelCalls": self.model_calls,
            "tokensIn": self.tokens_in,
            "tokensOut": self.tokens_out,
            "costUsd": round(estimate_cost(self.tokens_in, self.tokens_out), 6),
            "sources": self.sources,
            **({"coalesced": True} if self.coalesced else {}),
        }


def begin_query() -> QueryObservation:
    obs = QueryObservation()
    _QUERY.set(obs)
    return obs


def current_query():
    return _QUERY.get()


def mark(stage: str) -> None:
    obs = _QUERY.get()
    if obs is not None:
        obs.mark(stage)


def set_outcome(outcome: str) -> None:
    obs = _QUERY.get()
    if obs is not None and obs.outcome is None:
        obs.outcome = outcome


# ------------------------------------------------------------------ in-memory metrics

def _percentile(values, p):
    if not values:
        return None
    ordered = sorted(values)
    k = (len(ordered) - 1) * p / 100.0
    lo, hi = int(k), min(int(k) + 1, len(ordered) - 1)
    return ordered[lo] + (ordered[hi] - ordered[lo]) * (k - lo)


class Metrics:
    def __init__(self, keep: int = 2000):
        self._lock = threading.Lock()
        self._rows = deque(maxlen=keep)
        self.since = time.time()
        self.total_seen = 0

    def record(self, summary: dict) -> None:
        with self._lock:
            self._rows.append(summary)
            self.total_seen += 1

    def reset(self) -> None:
        with self._lock:
            self._rows.clear()
            self.total_seen = 0
            self.since = time.time()

    def snapshot(self) -> dict:
        with self._lock:
            rows = list(self._rows)
        outcomes = {}
        for r in rows:
            outcomes[r["outcome"]] = outcomes.get(r["outcome"], 0) + 1

        def dist(values):
            values = [v for v in values if v is not None]
            return {"n": len(values), "p50": _round(_percentile(values, 50)), "p95": _round(_percentile(values, 95)),
                    "max": _round(max(values) if values else None)}

        stage_names = sorted({s for r in rows for s in r["stagesMs"]})
        paid = [r for r in rows if r["modelCalls"] > 0]
        total_cost = sum(r["costUsd"] for r in rows)
        return {
            "since": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(self.since)),
            "questionsSinceStart": self.total_seen,
            "questionsInWindow": len(rows),
            "outcomes": outcomes,
            "totalMs": dist([r["totalMs"] for r in rows]),
            "timeToFirstWordMs": dist([r["ttftMs"] for r in rows]),
            "stagesMs": {s: dist([r["stagesMs"].get(s) for r in rows if s in r["stagesMs"]]) for s in stage_names},
            "cost": {
                "estimatedUsdInWindow": round(total_cost, 4),
                "perQuestionUsd": round(total_cost / len(rows), 6) if rows else None,
                "perModelQuestionUsd": round(sum(r["costUsd"] for r in paid) / len(paid), 6) if paid else None,
                "tokensIn": sum(r["tokensIn"] for r in rows),
                "tokensOut": sum(r["tokensOut"] for r in rows),
                "questionsWithoutUsageReport": sum(1 for r in paid if r["tokensIn"] == 0 and r["tokensOut"] == 0),
            },
            "note": "Per process, last %d questions, lost on restart. Cost is an estimate from the configured prices." % (self._rows.maxlen or 0),
        }


def _round(v):
    return None if v is None else round(v)


metrics = Metrics()
