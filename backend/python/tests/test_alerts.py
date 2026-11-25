"""
P1-9: the operator hears about trouble before the students do: the daily model budget passing
70 / 90 / 100 %, and the language model failing. Alerts are rate-limited, never block, never raise.
"""
import _env  # noqa: F401  (must be first)

import io
import json
import contextlib
import unittest
from unittest import mock

import utils.alerts as alerts
from utils.daily_budget import DailyBudget


def captured(fn):
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        result = fn()
    events = [json.loads(line) for line in out.getvalue().splitlines() if line.startswith("{")]
    return result, events


class TestAlerts(unittest.TestCase):
    def setUp(self):
        alerts.reset_for_tests()
        self.addCleanup(alerts.reset_for_tests)

    def test_an_alert_is_logged_without_a_webhook(self):
        with mock.patch.dict("os.environ", {"ALERT_WEBHOOK_URL": ""}):
            sent, events = captured(lambda: alerts.send_alert("disk full", key="a"))
        self.assertTrue(sent)
        self.assertEqual([e["message"] for e in events if e["event"] == "alert"], ["disk full"])

    def test_the_webhook_gets_a_json_body_that_works_for_slack_and_discord(self):
        posted = []

        def fake_urlopen(request, timeout=None):
            posted.append((request.full_url, json.loads(request.data), request.get_header("Content-type")))
            return mock.MagicMock()
        with mock.patch.dict("os.environ", {"ALERT_WEBHOOK_URL": "https://hooks.example/abc"}), \
                mock.patch("urllib.request.urlopen", fake_urlopen):
            captured(lambda: alerts.send_alert("budget 90%", key="b", wait=True))
        self.assertEqual(posted, [("https://hooks.example/abc", {"text": "budget 90%", "content": "budget 90%"}, "application/json")])

    def test_the_same_alert_is_sent_once_per_interval(self):
        with mock.patch.dict("os.environ", {"ALERT_WEBHOOK_URL": ""}):
            results = [captured(lambda: alerts.send_alert("down", key="k", min_interval=600))[0] for _ in range(5)]
            other = captured(lambda: alerts.send_alert("different", key="k2"))[0]
        self.assertEqual(results, [True, False, False, False, False])
        self.assertTrue(other)

    def test_a_dead_webhook_never_raises_or_blocks(self):
        def boom(*a, **k):
            raise OSError("network down")
        with mock.patch.dict("os.environ", {"ALERT_WEBHOOK_URL": "https://hooks.example/abc"}), \
                mock.patch("urllib.request.urlopen", boom):
            sent, events = captured(lambda: alerts.send_alert("x", key="c", wait=True))
        self.assertTrue(sent)
        self.assertTrue(any(e["event"] == "alert_delivery_failed" for e in events))


class TestBudgetThresholds(unittest.TestCase):
    def test_one_alert_per_threshold_per_day(self):
        calls = []
        day = ["2026-11-25"]
        b = DailyBudget(today=lambda: day[0])
        b.on_threshold = lambda pct, used, limit: calls.append((pct, used, limit))
        for _ in range(100):
            b.try_consume("u%d" % len(calls), 1000, 100)
        self.assertEqual(calls, [(70, 70, 100), (90, 90, 100), (100, 100, 100)])
        day[0] = "2026-11-26"                                   # a new day: heard again
        for _ in range(70):
            b.try_consume("v", 1000, 100)
        self.assertEqual(calls[-1], (70, 70, 100))
        self.assertEqual(len(calls), 4)

    def test_a_jump_past_two_thresholds_sends_one_message_for_the_highest(self):
        calls = []
        b = DailyBudget(today=lambda: "2026-11-25")
        b.on_threshold = lambda *a: calls.append(a)
        b._counts["GLOBAL"] = 89                                # e.g. loaded after a restart
        b.try_consume("u", 1000, 100)                           # 90
        self.assertEqual(calls, [(70, 90, 100), (90, 90, 100)][-1:])

    def test_no_limit_no_alerts_and_a_failing_callback_changes_nothing(self):
        calls = []
        b = DailyBudget(today=lambda: "2026-11-25")
        b.on_threshold = lambda *a: calls.append(a)
        for _ in range(10):
            b.try_consume("u", 0, 0)
        self.assertEqual(calls, [])
        b2 = DailyBudget(today=lambda: "2026-11-25")
        b2.on_threshold = lambda *a: 1 / 0
        for _ in range(100):
            self.assertIsNone(b2.try_consume("u", 1000, 100))   # the student's question is unaffected


class TestWiring(unittest.TestCase):
    def test_the_real_budget_alerts_through_the_alert_module_without_text_or_user_ids(self):
        import utils.rate_limit as rl
        from config import Config
        alerts.reset_for_tests()
        saved = (Config.LLM_CALLS_PER_USER_PER_DAY, Config.LLM_CALLS_GLOBAL_PER_DAY)
        Config.LLM_CALLS_PER_USER_PER_DAY, Config.LLM_CALLS_GLOBAL_PER_DAY = 1000, 10
        rl.daily_budget.reset()
        try:
            with mock.patch.dict("os.environ", {"ALERT_WEBHOOK_URL": ""}):
                _, events = captured(lambda: [rl.consume_llm_budget("SECRET-USER") for _ in range(7)])
        finally:
            Config.LLM_CALLS_PER_USER_PER_DAY, Config.LLM_CALLS_GLOBAL_PER_DAY = saved
            rl.daily_budget.reset()
        messages = [e["message"] for e in events if e["event"] == "alert"]
        self.assertEqual(len(messages), 1)
        self.assertIn("7 of 10", messages[0])
        self.assertNotIn("SECRET-USER", json.dumps(events))


if __name__ == "__main__":
    unittest.main()
