"""
Real token streaming (AUDIT P2-3) through /query/stream: the answer reaches the client as the model
produces it, a refusal is never flashed, a stop saves what was seen and cancels the model, and
problems before the answer starts are ordinary HTTP errors. Fake Gemini (no API calls).
"""
import _env  # noqa: F401  (must be first)

import asyncio
import contextlib
import io
import json
import types
import unittest

from config import Config
from test_chat_persistence import ChatCase, quiet
import main
from services.llm_service import llm_service, could_still_be_not_found
from models import QueryRequest


class StreamingFakeLLM:
    """Yields the configured pieces; records whether the stream was closed early."""

    def __init__(self):
        self.pieces = ["The maximum ", "late fee is ", "Rs. 5,000 ", "per semester [Fees, p. 1]."]
        self.fail_after = None
        self.closed_early = False
        self.started = 0
        self.gate = None          # an asyncio.Event the stream waits on after the first piece

    def invoke(self, messages):
        return types.SimpleNamespace(content="".join(self.pieces))

    async def astream(self, messages):
        self.started += 1
        finished = False
        try:
            for i, piece in enumerate(self.pieces):
                if self.fail_after is not None and i == self.fail_after:
                    raise RuntimeError("model went away")
                yield types.SimpleNamespace(content=piece)
                await asyncio.sleep(0)
                if i == 0 and self.gate is not None:
                    await self.gate.wait()
            finished = True
        finally:
            if not finished:
                self.closed_early = True


class StreamCase(ChatCase):
    def setUp(self):
        super().setUp()
        Config.QUERY_CONDENSING = False
        self.fake = StreamingFakeLLM()
        llm_service.llm = self.fake

    def stream(self, question="What is the maximum late fee?", chat=None, token="tokA", **extra):
        body = {"question": question, "chatId": chat or self.chat, **extra}
        with contextlib.redirect_stdout(io.StringIO()):
            with self.client.stream("POST", "/query/stream", json=body, headers=self.hdr(token)) as r:
                if r.status_code != 200:
                    r.read()
                    return r.status_code, r.text, []
                return 200, "", [json.loads(line) for line in r.iter_lines() if line]


def shown_text(events):
    return "".join(e["data"] for e in events if e["type"] == "text")


class TestStreaming(StreamCase):
    def test_the_answer_arrives_in_pieces_then_metadata_then_done(self):
        status, _, events = self.stream()
        self.assertEqual(status, 200)
        self.assertEqual([e["type"] for e in events][-2:], ["metadata", "done"])
        texts = [e["data"] for e in events if e["type"] == "text"]
        self.assertGreater(len(texts), 1, "several pieces, not one block")
        self.assertEqual("".join(texts), "".join(self.fake.pieces))
        self.assertTrue(events[-2]["data"]["saved"])
        self.assertTrue(events[-2]["data"]["sources"])

    def test_the_exchange_is_saved_once_with_the_complete_answer_and_is_cacheable(self):
        self.stream()
        bots = [m for m in self.stored("chat_messages").values() if m["role"] == "bot"]
        self.assertEqual(len(bots), 1)
        self.assertEqual(bots[0]["content"], "".join(self.fake.pieces))
        self.assertNotIn("stopped", bots[0]["metadata"])
        again = self.ask_in(self.make_chat("A"), "What is the maximum late fee?").json()
        self.assertTrue(again["cached"], "a completed streamed answer is stored in the answer cache")
        self.assertEqual(self.fake.started, 1)

    def test_a_reused_answer_is_sent_whole_without_calling_the_model(self):
        self.stream()
        _, _, events = self.stream(chat=self.make_chat("A"))
        self.assertEqual(self.fake.started, 1)
        self.assertEqual([e["data"] for e in events if e["type"] == "text"], ["".join(self.fake.pieces)])
        self.assertTrue(events[-2]["data"]["cached"])

    def test_a_refusal_is_never_shown_as_it_arrives(self):
        self.fake.pieces = ["NOT", "_FO", "UND"]
        _, _, events = self.stream()
        shown = shown_text(events)
        self.assertNotIn("NOT_FOUND", shown)
        self.assertEqual(shown, Config.NO_ANSWER_MESSAGE)
        self.assertFalse(events[-2]["data"]["answered"])

    def test_an_answer_that_merely_starts_with_the_same_letters_is_shown_in_full(self):
        for i, pieces in enumerate((["No", " late fee applies."], ["N"], ["Not", " in the first week."])):
            self.fake.pieces = pieces
            _, _, events = self.stream(question=f"a different question number {i}")
            self.assertEqual(shown_text(events), "".join(pieces), pieces)

    def test_could_still_be_not_found(self):
        for yes in ("", "N", "NOT", "not_fo", "NOT_FOUND", "  `NOT_FOUND`", "NOT_FOUND.", "**NOT_FOUND"):
            self.assertTrue(could_still_be_not_found(yes), yes)
        for no in ("No fee", "The fee", "NOTE:", "N/A", "Not applicable"):
            self.assertFalse(could_still_be_not_found(no), no)

    def test_problems_before_the_answer_are_ordinary_http_errors(self):
        status, _, _ = self.stream(chat="no-such-chat")
        self.assertEqual(status, 404)
        status, _, _ = self.stream(chat=self.make_chat("B"))
        self.assertEqual(status, 404, "somebody else's chat is indistinguishable from a missing one")
        with contextlib.redirect_stdout(io.StringIO()):
            r = self.client.post("/query/stream", json={"question": "x"})
        self.assertEqual(r.status_code, 401)
        self.assertEqual(self.fake.started, 0)

    def test_the_per_user_budget_applies_before_any_model_call(self):
        Config.LLM_CALLS_PER_USER_PER_DAY = 1
        self.assertEqual(self.stream("first different question")[0], 200)
        status, _, _ = self.stream("second different question")
        self.assertEqual(status, 429)
        self.assertEqual(self.fake.started, 1)

    def test_a_model_failure_midway_is_reported_and_nothing_is_saved_or_cached(self):
        self.fake.fail_after = 2
        _, _, events = self.stream()
        self.assertEqual(events[-1]["type"], "error")
        self.assertNotIn("model went away", json.dumps(events))
        self.assertEqual(self.stored("chat_messages"), {})
        self.assertEqual(self.stored("questions"), {})


class TestStop(StreamCase):
    def run_until_stopped(self):
        """Start the real pipeline, cancel it after the first piece reached the client."""
        async def go():
            self.fake.gate = asyncio.Event()                 # the model "keeps generating" until cancelled
            seen, first = [], asyncio.Event()

            async def on_token(piece):
                seen.append(piece)
                first.set()
            req = QueryRequest(question="What is the maximum late fee?", chatId=self.chat)
            task = asyncio.create_task(main._answer_question(req, "A", on_token))
            await asyncio.wait_for(first.wait(), 10)
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
            return seen
        return quiet(asyncio.run, go())

    def test_stopping_cancels_the_model_and_saves_what_the_user_saw_as_stopped(self):
        seen = self.run_until_stopped()
        self.assertTrue(self.fake.closed_early, "the model stream was closed, not left running")
        bots = [m for m in self.stored("chat_messages").values() if m["role"] == "bot"]
        self.assertEqual(len(bots), 1)
        self.assertEqual(bots[0]["content"], "".join(seen))
        self.assertTrue(bots[0]["metadata"]["stopped"])
        users = [m for m in self.stored("chat_messages").values() if m["role"] == "user"]
        self.assertEqual(users[0]["content"], "What is the maximum late fee?")

    def test_a_stopped_answer_is_never_cached(self):
        self.run_until_stopped()
        self.assertEqual(self.stored("questions"), {})
        self.fake.gate = None
        self.fake.pieces = ["Complete answer."]
        r = self.ask_in(self.make_chat("A"), "What is the maximum late fee?").json()
        self.assertFalse(r["cached"])

    def test_stopping_before_anything_was_shown_saves_nothing(self):
        async def go():
            self.fake.pieces = ["NOT", "_FOUND"]            # held back: the user has seen nothing
            self.fake.gate = asyncio.Event()
            req = QueryRequest(question="What is the maximum late fee?", chatId=self.chat)

            async def ignore(piece):
                pass
            task = asyncio.create_task(main._answer_question(req, "A", ignore))
            await asyncio.sleep(0.3)
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
        quiet(asyncio.run, go())
        self.assertEqual(self.stored("chat_messages"), {})


if __name__ == "__main__":
    unittest.main()
