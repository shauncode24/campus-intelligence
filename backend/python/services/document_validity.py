"""
Which documents may be used to answer a question, and which version is current.

A document is "live" only if ALL of these hold:
  * its status is "Processed" (not processing, errored, cancelled or being deleted);
  * it has not been superseded by a newer version (`supersededBy` is empty);
  * it is already in force (`effectiveDate` is today or earlier, or not set);
  * it has not expired (`expiryDate` is today or later, or not set; the expiry day itself
    still counts).

Dates are the `YYYY-MM-DD` strings an admin picks in the upload form, compared as
calendar dates in UTC. A date that cannot be read is ignored (treated as not set) and
logged, rather than hiding a document because of a typo.
"""
from datetime import date, datetime, timezone
from typing import Optional

# Reasons a processed document is not live (also shown to admins)
LIVE = "live"
SUPERSEDED = "superseded"
EXPIRED = "expired"
UPCOMING = "upcoming"
NOT_PROCESSED = "not_processed"


def today_utc() -> date:
    return datetime.now(timezone.utc).date()


def parse_day(value) -> Optional[date]:
    """'2025-03-01' (or a longer ISO timestamp) -> date; anything unreadable -> None."""
    if not value:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        print(f"⚠️ Ignoring unreadable document date: {str(value)[:40]!r}")
        return None


def document_state(record: dict, today: Optional[date] = None) -> str:
    """One of LIVE / SUPERSEDED / EXPIRED / UPCOMING / NOT_PROCESSED."""
    today = today or today_utc()
    if (record or {}).get("status") != "Processed":
        return NOT_PROCESSED
    if record.get("supersededBy"):
        return SUPERSEDED
    effective = parse_day(record.get("effectiveDate"))
    if effective and today < effective:
        return UPCOMING
    expiry = parse_day(record.get("expiryDate"))
    if expiry and today > expiry:
        return EXPIRED
    return LIVE


def is_live(record: dict, today: Optional[date] = None) -> bool:
    return document_state(record, today) == LIVE


def matches_filters(record: dict, filters: Optional[dict]) -> bool:
    """Optional exact-match filters on document metadata (department, documentType)."""
    for key, wanted in (filters or {}).items():
        if wanted and (record or {}).get(key) != wanted:
            return False
    return True


def describe(record: dict) -> str:
    """Short human label for the prompt and the UI, e.g. 'Fee Policy, version v2, effective 2025-01-01'."""
    parts = [(record or {}).get("name") or "Document"]
    if record.get("version"):
        parts.append(f"version {record['version']}")
    effective = parse_day(record.get("effectiveDate"))
    if effective:
        parts.append(f"effective {effective.isoformat()}")
    return ", ".join(parts)
