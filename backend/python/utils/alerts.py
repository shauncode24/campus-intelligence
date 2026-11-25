"""
Operator alerts (P1-9): a line in the log and, if ALERT_WEBHOOK_URL is set, a message to a chat or
phone-notification service.

The webhook receives a small JSON body with the message under both `text` (Slack, Mattermost, many
others) and `content` (Discord). Sending never blocks a request and never raises: an alert that
cannot be delivered is only logged. The same alert (same `key`) is sent at most once per
`min_interval` seconds, so an outage produces one message, not one per student.

Messages never contain a question, an answer or a user id.
"""
import json
import os
import threading
import time
import urllib.request

from utils.observability import log_event

_last_sent = {}
_lock = threading.Lock()


def webhook_url() -> str:
    return (os.getenv("ALERT_WEBHOOK_URL") or "").strip()


def _post(url: str, text: str) -> None:
    try:
        body = json.dumps({"text": text, "content": text}).encode("utf-8")
        request = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"}, method="POST")
        urllib.request.urlopen(request, timeout=5).close()
    except Exception as e:            # an undeliverable alert must never break anything
        log_event("alert_delivery_failed", error=type(e).__name__)


def send_alert(text: str, key: str = None, min_interval: float = 600.0, wait: bool = False) -> bool:
    """Returns True if the alert was sent (or logged), False if it was suppressed as a repeat."""
    key = key or text
    now = time.monotonic()
    with _lock:
        previous = _last_sent.get(key)
        if previous is not None and now - previous < min_interval:
            return False
        _last_sent[key] = now
    log_event("alert", message=text)
    url = webhook_url()
    if url:
        if wait:
            _post(url, text)
        else:
            threading.Thread(target=_post, args=(url, text), daemon=True, name="alert-webhook").start()
    return True


def reset_for_tests():
    with _lock:
        _last_sent.clear()
