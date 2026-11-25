"""
P1-7: the daily model-call budget survives a restart (counts are saved to the database and read
back), a refused call charges nothing, and a new UTC day starts fresh.
"""
import _env  # noqa: F401  (must be first)

import unittest

from fastapi import HTTPException

from fake_firestore import FakeDB
from utils.daily_budget import DailyBudget, GLOBAL
import utils.rate_limit as rate_limit
from config import Config


class Clock:
    day = "2026-11-25"

    def __call__(self):
        return self.day


class TestDailyBudget(unittest.TestCase):
    def setUp(self):
        self.clock, self.db = Clock(), FakeDB()

    def budget(self):
        return DailyBudget(today=self.clock)

    def test_counts_survive_a_restart(self):
        b = self.budget()
        for _ in range(3):
            self.assertIsNone(b.try_consume("alice", 5, 100))
        self.assertEqual(b.flush(self.db), 2)                    # alice and GLOBAL
        restarted = self.budget()
        self.assertEqual(restarted.load(self.db), 2)
        self.assertEqual((restarted.count("alice"), restarted.count(GLOBAL)), (3, 3))
        self.assertIsNone(restarted.try_consume("alice", 5, 100))
        self.assertIsNone(restarted.try_consume("alice", 5, 100))
        self.assertEqual(restarted.try_consume("alice", 5, 100), "user")      # 3 before + 2 after = 5

    def test_a_restart_does_not_hand_out_a_fresh_budget(self):
        b = self.budget()
        for _ in range(4):
            b.try_consume("bob", 100, 4)
        b.flush(self.db)
        again = self.budget()
        again.load(self.db)
        self.assertEqual(again.try_consume("someone-else", 100, 4), "global")

    def test_repeated_flushes_add_up_without_double_counting(self):
        b = self.budget()
        b.try_consume("a", 10, 100); b.flush(self.db)
        b.try_consume("a", 10, 100); b.try_consume("a", 10, 100); b.flush(self.db)
        b.flush(self.db)                                          # nothing new: no change
        again = self.budget(); again.load(self.db)
        self.assertEqual(again.count("a"), 3)

    def test_a_refused_call_charges_neither_budget(self):
        b = self.budget()
        for _ in range(2):
            b.try_consume("a", 2, 100)
        self.assertEqual(b.try_consume("a", 2, 100), "user")
        self.assertEqual((b.count("a"), b.count(GLOBAL)), (2, 2))
        for _ in range(2):
            b.try_consume("c", 100, 3)                            # global 4th... only one more fits
        self.assertEqual(b.try_consume("d", 100, 4), None)
        self.assertEqual(b.try_consume("e", 100, 4), "global")
        self.assertEqual(b.count("e"), 0, "the user refused by the global cap is not charged")

    def test_a_new_utc_day_starts_fresh(self):
        b = self.budget()
        b.try_consume("a", 1, 10)
        self.assertEqual(b.try_consume("a", 1, 10), "user")
        self.clock.day = "2026-11-26"
        self.assertIsNone(b.try_consume("a", 1, 10))
        b.flush(self.db)
        self.assertEqual({d["day"] for d in self.db.collection("llm_usage").docs.values()}, {"2026-11-26", })
        yesterday = self.budget(); self.clock.day = "2026-11-25"
        yesterday.load(self.db)
        self.assertEqual(yesterday.count("a"), 0, "yesterday's counts are not loaded today")

    def test_a_limit_of_zero_disables_that_budget(self):
        b = self.budget()
        for _ in range(50):
            self.assertIsNone(b.try_consume("a", 0, 0))

    def test_a_failed_save_keeps_the_counts_for_the_next_try(self):
        b = self.budget()
        b.try_consume("a", 10, 100)

        class Broken:
            def batch(self):
                raise RuntimeError("db down")
            def collection(self, *_): return self
            def document(self, *_): return self
        with self.assertRaises(RuntimeError):
            b.flush(Broken())
        self.assertEqual(b.flush(self.db), 2)                     # nothing lost
        again = self.budget(); again.load(self.db)
        self.assertEqual(again.count("a"), 1)


class TestThroughConsume(unittest.TestCase):
    def setUp(self):
        self._saved = (Config.LLM_CALLS_PER_USER_PER_DAY, Config.LLM_CALLS_GLOBAL_PER_DAY)
        rate_limit.daily_budget.reset()

    def tearDown(self):
        Config.LLM_CALLS_PER_USER_PER_DAY, Config.LLM_CALLS_GLOBAL_PER_DAY = self._saved
        rate_limit.daily_budget.reset()

    def test_the_refusal_is_a_429_with_a_message_and_a_retry_time(self):
        Config.LLM_CALLS_PER_USER_PER_DAY, Config.LLM_CALLS_GLOBAL_PER_DAY = 1, 100
        rate_limit.consume_llm_budget("u")
        with self.assertRaises(HTTPException) as ctx:
            rate_limit.consume_llm_budget("u")
        self.assertEqual(ctx.exception.status_code, 429)
        self.assertIn("today's question limit", ctx.exception.detail)
        self.assertTrue(1 <= int(ctx.exception.headers["Retry-After"]) <= 86400)
        Config.LLM_CALLS_PER_USER_PER_DAY, Config.LLM_CALLS_GLOBAL_PER_DAY = 100, 1
        with self.assertRaises(HTTPException) as ctx:
            rate_limit.consume_llm_budget("someone")
        self.assertIn("daily capacity", ctx.exception.detail)


if __name__ == "__main__":
    unittest.main()
