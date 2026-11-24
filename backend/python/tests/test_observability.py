"""
Observability (AUDIT P2-5): request ids, one structured log event per question with per-stage
timings, tokens, cost and outcome, in-memory metrics, and the admin metrics endpoint.
Fake Gemini (no API calls).
"""
import _env  # noqa: F401  (must be first)

import asyncio
import contextlib
import io
import json
import types
import unittest

from config import Config
from test_chat_persistence import ChatCase
from test_streaming import StreamingFakeLLM
import main
from models import QueryRequest
from services.llm_service import llm_service
from utils import observability as obs

SECRET_QUESTION = "What is the late fee for tuition, asked by someone with a private situation?"


class UsageLLM:
    """A fake model that reports token usage, like Gemini does."""

    def __init__(self, tokens_in=1000, tokens_out=200, text="The late fee is Rs. 200 per day [Fees, p. 1]."):
        self.tokens_in, self.tokens_out, self.text, self.fail = tokens_in, tokens_out, text, False

    def _usage(self):
        return {"input_tokens": self.tokens_in, "output_tokens": self.tokens_out, "total_tokens": self.tokens_in + self.tokens_out}

    def invoke(self, messages):
        if self.fail:
            raise RuntimeError("model down")
        return types.SimpleNamespace(content=self.text, usage_metadata=self._usage())

    async def astream(self, messages):
        words = self.text.split(" ")
        for i, w in enumerate(words):
            last = i == len(words) - 1
            yield types.SimpleNamespace(content=w + ("" if last else " "), usage_metadata=self._usage() if last else None)
            await asyncio.sleep(0)


class ObsCase(ChatCase):
    def setUp(self):
        super().setUp()
        Config.QUERY_CONDENSING = False
        self.llm_fake = UsageLLM()
        llm_service.llm = self.llm_fake
        obs.metrics.reset()
        self._prices = (Config.GEMINI_PRICE_IN_PER_MTOK, Config.GEMINI_PRICE_OUT_PER_MTOK)
        Config.GEMINI_PRICE_IN_PER_MTOK, Config.GEMINI_PRICE_OUT_PER_MTOK = 1.0, 10.0   # easy sums

    def tearDown(self):
        Config.GEMINI_PRICE_IN_PER_MTOK, Config.GEMINI_PRICE_OUT_PER_MTOK = self._prices
        super().tearDown()

    def capture(self, fn):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            result = fn()
        events = []
        for line in buf.getvalue().splitlines():
            if line.startswith("{"):
                with contextlib.suppress(ValueError):
                    events.append(json.loads(line))
        return result, events

    def ask(self, question=SECRET_QUESTION, chat=None, headers=None, **extra):
        body = {"question": question, "chatId": chat or self.chat, **extra}
        return self.capture(lambda: self.client.post("/query", json=body, headers={**self.hdr(), **(headers or {})}))

    @staticmethod
    def done(events):
        return [e for e in events if e["event"] == "query_done"]


class TestRequestIds(ObsCase):
    def test_every_response_carries_an_id_and_a_good_caller_id_is_kept(self):
        r, _ = self.capture(lambda: self.client.get("/healthz"))
        self.assertRegex(r.headers["x-request-id"], r"^[a-f0-9]{16}$")
        r, events = self.ask(headers={"X-Request-ID": "trace-abc12345.def"})
        self.assertEqual(r.headers["x-request-id"], "trace-abc12345.def")
        self.assertTrue(all(e["requestId"] == "trace-abc12345.def" for e in events if e["event"] in ("http", "query_done")))

    def test_a_malformed_caller_id_is_replaced(self):
        for bad in ("short", "has space in it 12345", "x" * 200, "<script>alert(1)</script>"):
            r, _ = self.capture(lambda: self.client.get("/healthz", headers={"X-Request-ID": bad}))
            self.assertRegex(r.headers["x-request-id"], r"^[a-f0-9]{16}$", bad)

    def test_the_access_log_has_one_line_per_request_and_skips_the_liveness_probe(self):
        _, events = self.capture(lambda: (self.client.get("/healthz"), self.client.get("/faq")))
        http = [e for e in events if e["event"] == "http"]
        self.assertEqual([e["path"] for e in http], ["/faq"])
        self.assertEqual(http[0]["status"], 200)

    def test_errors_in_the_log_name_the_request(self):
        self.llm_fake.fail = True
        r, _ = self.capture(lambda: self.client.post("/query", json={"question": "boom?", "chatId": self.chat},
                                                      headers={**self.hdr(), "X-Request-ID": "trace-err-000001"}))
        self.assertEqual(r.status_code, 500)
        self.assertEqual(r.headers["x-request-id"], "trace-err-000001")


class TestQueryEvent(ObsCase):
    def test_one_event_per_question_with_stages_tokens_cost_and_outcome(self):
        r, events = self.ask()
        self.assertEqual(r.status_code, 200, r.text)
        (e,) = self.done(events)
        self.assertEqual(e["outcome"], "answered")
        self.assertEqual((e["tokensIn"], e["tokensOut"], e["modelCalls"]), (1000, 200, 1))
        self.assertAlmostEqual(e["costUsd"], (1000 * 1.0 + 200 * 10.0) / 1e6, places=9)
        for stage in ("context", "embed", "cache", "retrieve", "sources", "prompt", "generate", "save"):
            self.assertIn(stage, e["stagesMs"], stage)
        self.assertGreaterEqual(e["totalMs"], max(e["stagesMs"].values()))
        self.assertGreater(e["sources"], 0)

    def test_the_log_never_contains_the_question_the_answer_or_the_user_id(self):
        _, events = self.ask()
        text = json.dumps(events)
        self.assertNotIn("private situation", text)
        self.assertNotIn("late fee for tuition", text.lower())
        self.assertNotIn("Rs. 200", text)
        (e,) = self.done(events)
        self.assertRegex(e["user"], r"^[a-f0-9]{8}$")
        self.assertNotEqual(e["user"], "A")

    def test_a_reused_answer_costs_nothing_and_is_labelled(self):
        self.ask()
        _, events = self.ask(chat=self.make_chat("A"))
        (e,) = self.done(events)
        self.assertEqual((e["outcome"], e["modelCalls"], e["costUsd"]), ("cached", 0, 0))
        self.assertNotIn("generate", e["stagesMs"])

    def test_a_refusal_that_never_reaches_the_model_is_declined_and_free(self):
        main.retrieval_service.retrieve_multimodal = lambda *a, **k: []
        _, events = self.ask("completely unrelated question about volcanoes?")
        (e,) = self.done(events)
        self.assertEqual((e["outcome"], e["modelCalls"]), ("declined", 0))

    def test_rejections_and_failures_have_their_own_outcomes(self):
        r, events = self.ask(chat="no-such-chat")
        self.assertEqual(r.status_code, 404)
        self.assertEqual(self.done(events)[0]["outcome"], "rejected")
        self.llm_fake.fail = True
        r, events = self.ask("a fresh question that reaches the model?")
        self.assertEqual(r.status_code, 500)
        self.assertEqual(self.done(events)[0]["outcome"], "error")

    def test_a_streamed_answer_reports_time_to_first_word_and_the_final_usage(self):
        def run():
            with self.client.stream("POST", "/query/stream", json={"question": "streamed question please?", "chatId": self.chat},
                                    headers=self.hdr()) as r:
                return [json.loads(line) for line in r.iter_lines() if line]
        _, events = self.capture(run)
        (e,) = self.done(events)
        self.assertTrue(e["streamed"])
        self.assertIsNotNone(e["ttftMs"])
        self.assertLessEqual(e["ttftMs"], e["totalMs"])
        self.assertEqual((e["tokensIn"], e["tokensOut"]), (1000, 200))

    def test_a_stopped_answer_is_recorded_as_stopped(self):
        llm_service.llm = fake = StreamingFakeLLM()
        fake.gate = None

        async def go():
            fake.gate = asyncio.Event()
            first = asyncio.Event()

            async def on_token(piece):
                first.set()
            req = QueryRequest(question="What is the maximum late fee?", chatId=self.chat)
            task = asyncio.create_task(main._answer_question(req, "A", on_token))
            await asyncio.wait_for(first.wait(), 10)
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
        _, events = self.capture(lambda: asyncio.run(go()))
        self.assertEqual(self.done(events)[0]["outcome"], "stopped")

    def test_a_model_that_reports_no_usage_is_visible_as_such(self):
        self.llm_fake.invoke = lambda messages: types.SimpleNamespace(content="Answer [Fees, p. 1].")
        self.ask("question whose model reports nothing?")
        self.assertEqual(obs.metrics.snapshot()["cost"]["questionsWithoutUsageReport"], 1)


class TestMetrics(ObsCase):
    def test_percentiles_outcomes_and_cost_per_question(self):
        self.ask("first distinct question number one?")
        self.ask("second distinct question number two?")
        self.ask("first distinct question number one?", chat=self.make_chat("A"))     # reused
        snap = obs.metrics.snapshot()
        self.assertEqual(snap["questionsInWindow"], 3)
        self.assertEqual(snap["outcomes"], {"answered": 2, "cached": 1})
        self.assertIn("retrieve", snap["stagesMs"])
        self.assertLessEqual(snap["totalMs"]["p50"], snap["totalMs"]["p95"])
        cost = snap["cost"]
        self.assertAlmostEqual(cost["estimatedUsdInWindow"], 2 * (1000 + 2000) / 1e6, places=6)
        self.assertAlmostEqual(cost["perQuestionUsd"], cost["estimatedUsdInWindow"] / 3, places=6)
        self.assertAlmostEqual(cost["perModelQuestionUsd"], 3000 / 1e6, places=6)

    def test_the_window_is_bounded_and_can_be_reset(self):
        m = obs.Metrics(keep=3)
        for i in range(10):
            m.record({"outcome": "answered", "totalMs": i, "stagesMs": {"x": i}, "ttftMs": None, "modelCalls": 1,
                      "tokensIn": 1, "tokensOut": 1, "costUsd": 0.1, "sources": 1})
        snap = m.snapshot()
        self.assertEqual((snap["questionsInWindow"], snap["questionsSinceStart"]), (3, 10))
        self.assertEqual(snap["totalMs"]["max"], 9)
        m.reset()
        self.assertEqual(m.snapshot()["questionsInWindow"], 0)
        self.assertIsNone(m.snapshot()["totalMs"]["p50"])

    def test_percentile_math(self):
        values = list(range(1, 101))
        self.assertAlmostEqual(obs._percentile(values, 50), 50.5)
        self.assertAlmostEqual(obs._percentile(values, 95), 95.05)
        self.assertIsNone(obs._percentile([], 50))
        self.assertEqual(obs._percentile([7], 95), 7)

    def test_the_metrics_endpoint_is_for_admins_only_and_returns_the_snapshot(self):
        self.ask()
        r, _ = self.capture(lambda: self.client.get("/admin/metrics", headers=self.hdr()))
        self.assertEqual(r.status_code, 403)
        r, _ = self.capture(lambda: self.client.get("/admin/metrics"))
        self.assertEqual(r.status_code, 401)
        import auth as authmod
        authmod.firebase_auth.verify_id_token = lambda t, *a, **k: {"uid": "boss", "admin": True}
        r, _ = self.capture(lambda: self.client.get("/admin/metrics", headers={"Authorization": "Bearer adm"}))
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertEqual(body["questionsInWindow"], 1)
        self.assertNotIn("private situation", json.dumps(body))


class TestLogEvent(unittest.TestCase):
    def test_one_json_line_without_empty_fields_and_never_raises(self):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            obs.log_event("something", a=1, b=None, c="x")
            obs.log_event("odd", thing=object())          # not JSON-serialisable: must not crash the request
        lines = buf.getvalue().splitlines()
        first = json.loads(lines[0])
        self.assertEqual((first["event"], first["a"], first["c"]), ("something", 1, "x"))
        self.assertNotIn("b", first)
        self.assertEqual(len(lines), 2)


if __name__ == "__main__":
    unittest.main()
