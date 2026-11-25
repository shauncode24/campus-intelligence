"""
Daily model-call budgets that survive a restart (P1-7).

The counters used to live only in memory, so restarting the service handed everyone a fresh
budget: a crash loop, or anyone who could make it restart, removed the spending cap. Now:

* the counts are kept in memory (checking a budget costs nothing and never waits for the database);
* changes are written to Firestore in the background every few seconds, and once more at shutdown
  (`llm_usage/{day}__{user or GLOBAL}` = {day, uid, count});
* at start-up today's counts are read back.

If the service is killed hard, the few seconds not yet written are lost: a small, bounded error in
the safe direction for the student, not an unlimited reset. The day is the UTC calendar day.
Single-instance design, like the other counters: two instances would each count on their own.
"""
import threading
import time
from datetime import datetime, timedelta, timezone

GLOBAL = "GLOBAL"
COLLECTION = "llm_usage"


def _today() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def seconds_until_tomorrow() -> int:
    now = datetime.now(timezone.utc)
    midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
    return max(1, int(86400 - (now - midnight).total_seconds()))


class DailyBudget:
    # Called as on_threshold(percent, used, limit) the first time each day the GLOBAL budget passes
    # one of these shares of its limit (so an operator hears before students are turned away)
    THRESHOLDS = (70, 90, 100)

    def __init__(self, today=_today):
        self._today_fn = today
        self._lock = threading.Lock()
        self._day = today()
        self._counts = {}          # key -> calls today
        self._unsaved = {}         # key -> calls not yet written
        self._alerted = set()
        self.on_threshold = None

    def _roll(self):
        day = self._today_fn()
        if day != self._day:
            self._day, self._counts, self._unsaved, self._alerted = day, {}, {}, set()

    def reset(self):
        with self._lock:
            self._day, self._counts, self._unsaved, self._alerted = self._today_fn(), {}, {}, set()

    def count(self, key: str) -> int:
        with self._lock:
            self._roll()
            return self._counts.get(key, 0)

    def try_consume(self, user_id: str, user_limit: int, global_limit: int):
        """
        Spend one call from the user's and the global budget, atomically (a refusal charges
        neither). Returns None if allowed, else "user" or "global" for the budget that is used up.
        A limit <= 0 disables that budget.
        """
        crossed = []
        with self._lock:
            self._roll()
            if user_limit > 0 and self._counts.get(user_id, 0) >= user_limit:
                return "user"
            if global_limit > 0 and self._counts.get(GLOBAL, 0) >= global_limit:
                return "global"
            for key in (user_id, GLOBAL):
                self._counts[key] = self._counts.get(key, 0) + 1
                self._unsaved[key] = self._unsaved.get(key, 0) + 1
            if global_limit > 0:
                used = self._counts[GLOBAL]
                for pct in self.THRESHOLDS:
                    if used * 100 >= pct * global_limit and pct not in self._alerted:
                        self._alerted.add(pct)
                        crossed.append((pct, used, global_limit))
        if crossed and self.on_threshold:
            try:
                self.on_threshold(*crossed[-1])        # one message, for the highest share just reached
            except Exception:
                pass
        return None

    # ------------------------------------------------------------------ persistence

    def load(self, db) -> int:
        """Read today's counts back (call once at start-up). Returns how many were loaded."""
        day = self._today_fn()
        loaded = {}
        for snap in db.collection(COLLECTION).where("day", "==", day).stream():
            data = snap.to_dict() or {}
            loaded[data.get("uid") or GLOBAL] = int(data.get("count") or 0)
        with self._lock:
            self._roll()
            if self._day == day:
                for key, n in loaded.items():
                    # whatever was counted before the load finished is added on top
                    self._counts[key] = max(self._counts.get(key, 0), n + self._unsaved.get(key, 0))
        return len(loaded)

    def flush(self, db) -> int:
        """Write what has not been saved yet. Safe to call at any time; failures keep the data for next time."""
        from firebase_admin import firestore
        with self._lock:
            self._roll()
            pending, day = dict(self._unsaved), self._day
            self._unsaved = {}
        if not pending:
            return 0
        try:
            items = list(pending.items())
            for i in range(0, len(items), 400):
                batch = db.batch()
                for key, delta in items[i:i + 400]:
                    ref = db.collection(COLLECTION).document(f"{day}__{key}")
                    batch.set(ref, {"day": day, "uid": key, "count": firestore.Increment(delta),
                                    "updatedAt": firestore.SERVER_TIMESTAMP,
                                    # lets a Firestore TTL policy on `expireAt` delete old days by itself
                                    "expireAt": datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=timezone.utc) + timedelta(days=8)},
                              merge=True)
                batch.commit()
            return len(items)
        except Exception:
            with self._lock:                       # put it back: try again at the next flush
                if self._day == day:
                    for key, delta in pending.items():
                        self._unsaved[key] = self._unsaved.get(key, 0) + delta
            raise


daily_budget = DailyBudget()
