"""
One model call per identical question at a time (found by the P2-6 load tests).

Without this, when many users ask the same new question at the same moment (an exam date just
announced), every one of them misses the answer cache, because the answer is only cached after the
first call finishes, and every one pays for a model call. Here the first becomes the "leader"; the
others wait for it, then read the answer it cached.

* Per process (one event loop), no locks needed: join_or_lead() has no `await` in it.
* Key = the standalone question's fingerprint + the corpus epoch, so a document change in between
  never lets a follower take an answer made from other documents.
* If the leader refuses ("not in the documents"), the followers refuse too without calling the
  model again; if it is stopped or fails, the next waiter takes over as leader.
* Followers do not stream while they wait: they get the finished answer once the leader is done.
"""
import asyncio


class Flight:
    def __init__(self):
        self.done = asyncio.Event()
        self.outcome = None          # set by the leader when it finishes: "answered", "declined", "stopped", ...


class InFlight:
    def __init__(self):
        self._flights = {}

    def join_or_lead(self, key):
        """('leader', flight) if nobody is answering this question, else ('follower', their flight)."""
        flight = self._flights.get(key)
        if flight is None:
            flight = self._flights[key] = Flight()
            return "leader", flight
        return "follower", flight

    def release(self, key, flight, outcome):
        flight.outcome = outcome
        if self._flights.get(key) is flight:
            del self._flights[key]
        flight.done.set()

    async def wait(self, flight, timeout):
        """True if the leader finished within `timeout` seconds."""
        try:
            await asyncio.wait_for(flight.done.wait(), timeout)
            return True
        except asyncio.TimeoutError:
            return False

    def active(self):
        return len(self._flights)


in_flight = InFlight()


class Hold:
    """What one request is leading, so the wrapper can release it however the request ends."""

    def __init__(self):
        self.key = None
        self.flight = None

    def lead(self, key, flight):
        self.key, self.flight = key, flight

    def release(self, outcome):
        if self.flight is not None:
            in_flight.release(self.key, self.flight, outcome)
            self.flight = None
