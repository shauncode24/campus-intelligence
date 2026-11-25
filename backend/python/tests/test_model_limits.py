"""
P1-6: the model call has a timeout, a bounded retry and an output cap, so a stuck or failing model
cannot hang a request or cost without bound. Fake models; no API calls.
"""
import _env  # noqa: F401  (must be first)

import asyncio
import time
import types
import unittest

from test_streaming import StreamCase  # noqa: E402  (stubs the Gemini client first)
from langchain_core.messages import HumanMessage  # noqa: E402

from config import Config  # noqa: E402
from services.llm_service import llm_service, ModelUnavailable, is_transient  # noqa: E402


class ScriptedLLM:
    """astream() behaves as scripted per attempt: a list like ["ok"], ["503"], ["stall"], ["x", "stall"]."""

    def __init__(self, attempts):
        self.attempts, self.calls = list(attempts), 0

    def invoke(self, messages):
        self.calls += 1
        step = self.attempts[min(self.calls - 1, len(self.attempts) - 1)]
        if step and step[0] == "503":
            raise RuntimeError("503 Service Unavailable")
        return types.SimpleNamespace(content="answer")

    async def astream(self, messages):
        step = self.attempts[min(self.calls, len(self.attempts) - 1)]
        self.calls += 1
        for item in step:
            if item == "503":
                raise RuntimeError("503 Service Unavailable: the model is overloaded")
            if item == "400":
                raise RuntimeError("400 invalid argument")
            if item == "stall":
                await asyncio.sleep(30)
            else:
                yield types.SimpleNamespace(content=item)


async def collect(message):
    return [p async for p in llm_service.stream_answer(message)]


class TestLimits(unittest.TestCase):
    def setUp(self):
        self._saved = (llm_service.llm, Config.GEMINI_STREAM_STALL_SECONDS, Config.GEMINI_MAX_RETRIES)
        Config.GEMINI_STREAM_STALL_SECONDS = 0.2
        Config.GEMINI_MAX_RETRIES = 1
        self.msg = HumanMessage(content="q")

    def tearDown(self):
        llm_service.llm, Config.GEMINI_STREAM_STALL_SECONDS, Config.GEMINI_MAX_RETRIES = self._saved

    def run_stream(self, attempts):
        llm_service.llm = ScriptedLLM(attempts)
        return llm_service.llm

    def test_a_temporary_error_before_any_text_is_retried_once_and_succeeds(self):
        fake = self.run_stream([["503"], ["Hello ", "world"]])
        started = time.time()
        self.assertEqual(asyncio.run(collect(self.msg)), ["Hello ", "world"])
        self.assertEqual(fake.calls, 2)
        self.assertLess(time.time() - started, 5)

    def test_retries_are_bounded(self):
        fake = self.run_stream([["503"]])
        with self.assertRaises(ModelUnavailable):
            asyncio.run(collect(self.msg))
        self.assertEqual(fake.calls, 1 + Config.GEMINI_MAX_RETRIES)

    def test_no_retries_when_configured_off(self):
        Config.GEMINI_MAX_RETRIES = 0
        fake = self.run_stream([["503"], ["fine"]])
        with self.assertRaises(ModelUnavailable):
            asyncio.run(collect(self.msg))
        self.assertEqual(fake.calls, 1)

    def test_a_model_that_never_starts_is_given_up_on_and_retried(self):
        fake = self.run_stream([["stall"], ["stall"]])
        started = time.time()
        with self.assertRaises(ModelUnavailable):
            asyncio.run(collect(self.msg))
        self.assertEqual(fake.calls, 2)
        self.assertLess(time.time() - started, 5, "a stuck model must not hold the request for 30 s")

    def test_a_model_that_goes_quiet_midway_ends_the_answer_without_a_retry(self):
        fake = self.run_stream([["Part one. ", "stall"]])
        got = []

        async def go():
            async for p in llm_service.stream_answer(self.msg):
                got.append(p)
        with self.assertRaises(ModelUnavailable):
            asyncio.run(go())
        self.assertEqual(got, ["Part one. "])
        self.assertEqual(fake.calls, 1, "text was already shown, so it cannot be silently restarted")

    def test_a_bad_request_is_not_retried(self):
        fake = self.run_stream([["400"], ["fine"]])
        with self.assertRaises(RuntimeError) as ctx:
            asyncio.run(collect(self.msg))
        self.assertNotIsInstance(ctx.exception, ModelUnavailable)
        self.assertEqual(fake.calls, 1)

    def test_the_non_streaming_call_reports_a_temporary_failure_as_unavailable(self):
        self.run_stream([["503"]])
        with self.assertRaises(ModelUnavailable):
            llm_service.generate_answer(self.msg)

    def test_which_errors_count_as_temporary(self):
        for e in (TimeoutError(), asyncio.TimeoutError(), ConnectionError(), RuntimeError("429 Too Many Requests"),
                  RuntimeError("503 Service Unavailable"), RuntimeError("The read operation timed out")):
            self.assertTrue(is_transient(e), repr(e))
        for e in (ValueError("bad"), RuntimeError("400 invalid argument"), KeyError("x")):
            self.assertFalse(is_transient(e), repr(e))


class TestThroughTheApi(StreamCase):
    def setUp(self):
        super().setUp()
        self._cfg = (Config.GEMINI_STREAM_STALL_SECONDS, Config.GEMINI_MAX_RETRIES)
        Config.GEMINI_STREAM_STALL_SECONDS, Config.GEMINI_MAX_RETRIES = 0.2, 0

    def tearDown(self):
        Config.GEMINI_STREAM_STALL_SECONDS, Config.GEMINI_MAX_RETRIES = self._cfg
        super().tearDown()

    def test_a_stuck_model_gives_the_student_a_friendly_message_and_saves_nothing(self):
        llm_service.llm = ScriptedLLM([["stall"]])
        started = time.time()
        status, text, _ = self.stream()
        self.assertLess(time.time() - started, 8)
        self.assertEqual(status, 503)           # nothing had been sent yet, so it is an ordinary HTTP error
        self.assertIn("not able to answer right now", text)
        self.assertEqual(self.stored("questions"), {})
        self.assertEqual(self.stored("chat_messages"), {})


if __name__ == "__main__":
    unittest.main()
