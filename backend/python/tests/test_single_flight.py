"""
Identical questions asked at the same moment share ONE model call (found by the P2-6 load tests).
The real pipeline, answer cache and embedding model; fake database and fake Gemini.
"""
import _env  # noqa: F401  (must be first)

import asyncio
import contextlib
import io
import time
import types
import unittest

from config import Config
from test_followup_endpoint import FollowUpCase
import main
from models import QueryRequest
from services.llm_service import llm_service
from utils.single_flight import in_flight
from utils import observability as obs

QUESTION = "When is the last date to pay the semester fee without a fine?"


class SlowLLM:
    """A model that takes a while and counts its calls; can be told to refuse or fail on the first call."""

    def __init__(self, delay=0.4):
        self.delay, self.calls, self.text = delay, 0, "The last date is the 15th [Fees, p. 1]."
        self.first_call = None          # "fail" | "refuse"
        self.concurrent = 0

    def invoke(self, messages):
        self.calls += 1
        n = self.calls
        self.concurrent += 1
        try:
            time.sleep(self.delay)
            if n == 1 and self.first_call == "fail":
                raise RuntimeError("model down")
            if n == 1 and self.first_call == "refuse":
                return types.SimpleNamespace(content="NOT_FOUND")
            return types.SimpleNamespace(content=self.text)
        finally:
            self.concurrent -= 1


class FlightCase(FollowUpCase):
    def setUp(self):
        super().setUp()
        Config.QUERY_CONDENSING = False
        self.llm_fake = SlowLLM()
        llm_service.llm = self.llm_fake
        self._saved_sf = (Config.SINGLE_FLIGHT, Config.SINGLE_FLIGHT_WAIT_SECONDS)
        Config.SINGLE_FLIGHT, Config.SINGLE_FLIGHT_WAIT_SECONDS = True, 30.0

    def tearDown(self):
        Config.SINGLE_FLIGHT, Config.SINGLE_FLIGHT_WAIT_SECONDS = self._saved_sf
        super().tearDown()

    def burst(self, users=8, question=QUESTION, **extra):
        """`users` different people ask at the same moment. Returns their results (response or exception)."""
        async def one(i):
            try:
                return await main._answer_question(QueryRequest(question=question, **extra), f"user{i}")
            except BaseException as e:      # noqa: BLE001  (the tests inspect failures)
                return e

        async def go():
            return await asyncio.gather(*(one(i) for i in range(users)))
        with contextlib.redirect_stdout(io.StringIO()):
            return asyncio.run(go())


class TestIdenticalQuestions(FlightCase):
    def test_a_burst_of_the_same_new_question_costs_one_model_call(self):
        results = self.burst(8)
        self.assertEqual(self.llm_fake.calls, 1)
        self.assertTrue(all(not isinstance(r, BaseException) for r in results), results)
        self.assertEqual({r.answer for r in results}, {self.llm_fake.text})
        self.assertEqual(sorted(r.cached for r in results), [False] + [True] * 7)
        self.assertEqual(in_flight.active(), 0, "nothing is left registered")

    def test_every_user_still_gets_their_own_saved_history_entry(self):
        self.burst(5)
        mine = [q for q in self.db.collection("user_questions").docs.values()]
        self.assertEqual(sorted(q["userId"] for q in mine), [f"user{i}" for i in range(5)])

    def test_different_questions_do_not_wait_for_each_other(self):
        async def go():
            t = time.perf_counter()
            await asyncio.gather(*(main._answer_question(QueryRequest(question=f"{QUESTION} variant {i} programme {i * 7}"), f"u{i}") for i in range(4)))
            return time.perf_counter() - t
        with contextlib.redirect_stdout(io.StringIO()):
            elapsed = asyncio.run(go())
        self.assertEqual(self.llm_fake.calls, 4)
        self.assertLess(elapsed, 4 * 0.4 * 0.85, "they ran in parallel, not one after another")

    def test_followers_are_marked_as_coalesced_in_the_log_and_cost_nothing(self):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            async def go():
                await asyncio.gather(*(main._answer_question(QueryRequest(question=QUESTION), f"u{i}") for i in range(4)))
            asyncio.run(go())
        import json
        events = [json.loads(l) for l in buf.getvalue().splitlines() if l.startswith("{") and '"query_done"' in l]
        self.assertEqual(len(events), 4)
        followers = [e for e in events if e.get("coalesced")]
        self.assertEqual(len(followers), 3)
        self.assertTrue(all(e["modelCalls"] == 0 and e["outcome"] == "cached" for e in followers))

    def test_try_again_never_waits_and_the_switch_can_turn_it_off(self):
        self.burst(3, regenerate=True)
        self.assertEqual(self.llm_fake.calls, 3, "try again always asks the model")
        self.llm_fake.calls = 0
        Config.SINGLE_FLIGHT = False
        self.burst(3, question=QUESTION + " (second ask)")
        self.assertEqual(self.llm_fake.calls, 3)


class TestWhenTheLeaderDoesNotAnswer(FlightCase):
    def test_a_refusal_is_shared_without_more_model_calls(self):
        self.llm_fake.first_call = "refuse"
        results = self.burst(6)
        self.assertEqual(self.llm_fake.calls, 1)
        self.assertTrue(all(r.answered is False for r in results), [getattr(r, "answered", r) for r in results])
        self.assertEqual(in_flight.active(), 0)

    def test_if_the_leader_fails_one_waiter_takes_over_and_the_rest_reuse_its_answer(self):
        self.llm_fake.first_call = "fail"
        results = self.burst(5)
        failures = [r for r in results if isinstance(r, BaseException)]
        good = [r for r in results if not isinstance(r, BaseException)]
        self.assertEqual(len(failures), 1, "only the leader's own request fails")
        self.assertEqual(len(good), 4)
        self.assertEqual(self.llm_fake.calls, 2, "one failed call and one successful call, not five")
        self.assertEqual(in_flight.active(), 0)

    def test_if_the_leader_is_stopped_a_waiter_takes_over(self):
        async def go():
            leader = asyncio.create_task(main._answer_question(QueryRequest(question=QUESTION), "leader"))
            await asyncio.sleep(0.25)               # the leader is inside its model call
            follower = asyncio.create_task(main._answer_question(QueryRequest(question=QUESTION), "follower"))
            await asyncio.sleep(0.1)
            leader.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await leader
            return await asyncio.wait_for(follower, 20)
        with contextlib.redirect_stdout(io.StringIO()):
            answer = asyncio.run(go())
        self.assertEqual(answer.answer, self.llm_fake.text)
        self.assertEqual(in_flight.active(), 0)

    def test_a_waiter_does_not_wait_forever(self):
        Config.SINGLE_FLIGHT_WAIT_SECONDS = 0.15
        self.llm_fake.delay = 0.8
        t = time.perf_counter()
        results = self.burst(2)
        self.assertTrue(all(not isinstance(r, BaseException) for r in results), results)
        self.assertEqual(self.llm_fake.calls, 2, "the impatient waiter answered it itself")
        self.assertLess(time.perf_counter() - t, 5)

    def test_a_document_change_while_waiting_does_not_hand_over_an_old_answer(self):
        from database.corpus_epoch import bump_epoch

        async def go():
            first = asyncio.create_task(main._answer_question(QueryRequest(question=QUESTION), "a"))
            await asyncio.sleep(0.25)
            await main.run_blocking(bump_epoch, main.firebase_client.db)    # a document just changed
            second = await main._answer_question(QueryRequest(question=QUESTION), "b")
            return await first, second
        with contextlib.redirect_stdout(io.StringIO()):
            first, second = asyncio.run(go())
        self.assertFalse(second.cached, "a different epoch is a different question")
        self.assertEqual(self.llm_fake.calls, 2)


if __name__ == "__main__":
    unittest.main()
