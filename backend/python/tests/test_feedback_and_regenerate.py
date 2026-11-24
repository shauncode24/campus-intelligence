"""
P1-12 backend: answer feedback with context, "try again" that really answers afresh, the age of a
reused answer, and the passage ids behind each source.
"""
import time
import types
import unittest

from langchain_core.documents import Document

from test_chat_persistence import ChatCase  # noqa: E402  (sets up the app)
from test_followup_endpoint import ANSWER  # noqa: E402
from test_ingestion import quiet  # noqa: E402
import main  # noqa: E402

Q = "What is the late fee for tuition?"


class FeedbackCase(ChatCase):
    def setUp(self):
        super().setUp()
        # A short question in a chat with history goes to the follow-up rewriter (P1-4); these tests
        # are about feedback and caching, so keep the question text as typed
        main.Config.QUERY_CONDENSING = False
        self.retrieval_docs = [Document(
            page_content="The late fee is Rs. 200 per day, at most Rs. 5,000 per semester.",
            metadata={"page": 0, "type": "text", "documentId": "d1", "similarity": 0.9, "chunkId": "d1_7"})]

    def answer(self, question=Q, **extra):
        return self.ask_in(self.chat, question, **extra).json()

    def rate(self, message_id, token="tokA", **body):
        return quiet(self.client.put, f"/messages/{message_id}/feedback", json=body, headers=self.hdr(token))

    def rows(self):
        return self.db.collection("feedback").docs


class TestChunkIds(FeedbackCase):
    def test_every_source_names_the_passage_it_came_from(self):
        body = self.answer()
        self.assertEqual(body["sources"][0]["chunkId"], "d1_7")
        self.assertEqual(body["metadata"]["sources"][0]["chunkId"], "d1_7")
        stored = self.db.collection("chat_messages").docs[body["messageId"]]
        self.assertEqual(stored["metadata"]["sources"][0]["chunkId"], "d1_7")


class TestFeedback(FeedbackCase):
    def test_a_rating_is_stored_with_the_question_answer_and_exact_passages(self):
        body = self.answer()
        r = self.rate(body["messageId"], rating="up")
        self.assertEqual(r.status_code, 200, r.text)
        row = self.rows()[body["messageId"]]
        self.assertEqual(row["rating"], "up")
        self.assertEqual(row["question"], Q)
        self.assertEqual(row["answer"], ANSWER)
        self.assertEqual(row["chunkIds"], ["d1_7"])
        self.assertEqual(row["documentIds"], ["d1"])
        self.assertEqual(row["sources"][0]["displayPage"], 1)
        self.assertEqual((row["chatId"], row["historyId"], row["userId"]), (self.chat, body["historyId"], "A"))
        self.assertTrue(row["answered"] and not row["cached"])
        self.assertTrue(row["llmModel"] and row["embeddingModel"])

    def test_the_rating_is_on_the_message_so_a_reload_shows_it(self):
        body = self.answer()
        self.rate(body["messageId"], rating="down", reason="outdated")
        bot = [m for m in self.messages(self.chat).json()["messages"] if m["role"] == "bot"][0]
        self.assertEqual(bot["metadata"]["feedback"], "down")

    def test_a_thumbs_down_keeps_its_reason_and_comment(self):
        body = self.answer()
        self.rate(body["messageId"], rating="down", reason="wrong", comment="  The fee is Rs. 300  ")
        row = self.rows()[body["messageId"]]
        self.assertEqual((row["reason"], row["comment"]), ("wrong", "The fee is Rs. 300"))

    def test_a_reason_is_only_kept_for_a_thumbs_down(self):
        body = self.answer()
        self.rate(body["messageId"], rating="up", reason="wrong")
        self.assertIsNone(self.rows()[body["messageId"]]["reason"])

    def test_changing_the_rating_replaces_the_row_instead_of_adding_one(self):
        body = self.answer()
        self.rate(body["messageId"], rating="up")
        self.rate(body["messageId"], rating="down", reason="missing")
        self.assertEqual(len(self.rows()), 1)
        self.assertEqual(self.rows()[body["messageId"]]["rating"], "down")

    def test_taking_the_rating_back_removes_the_row_and_the_mark(self):
        body = self.answer()
        self.rate(body["messageId"], rating="up")
        r = self.rate(body["messageId"], rating=None)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(self.rows()), 0)
        stored = self.db.collection("chat_messages").docs[body["messageId"]]
        self.assertNotIn("feedback", stored["metadata"])

    def test_a_refusal_can_be_rated_and_says_it_was_a_refusal(self):
        self.retrieval_docs = []
        body = self.answer("What is the parking fee?")
        self.assertFalse(body["answered"])
        self.rate(body["messageId"], rating="down", reason="missing")
        row = self.rows()[body["messageId"]]
        self.assertFalse(row["answered"])
        self.assertEqual((row["sources"], row["chunkIds"]), ([], []))

    def test_a_reused_answer_is_marked_as_such_in_the_row(self):
        self.answer()
        body = self.ask_in(self.make_chat("A"), Q).json()
        self.assertTrue(body["cached"])
        self.rate(body["messageId"], rating="up")
        self.assertTrue(self.rows()[body["messageId"]]["cached"])


class TestFeedbackIsPrivateAndValidated(FeedbackCase):
    def test_another_user_cannot_rate_it(self):
        body = self.answer()
        self.assertEqual(self.rate(body["messageId"], token="tokB", rating="down").status_code, 404)
        self.assertEqual(len(self.rows()), 0)

    def test_unknown_ids_and_the_users_own_questions_are_not_found(self):
        body = self.answer()
        user_msg = next(i for i, m in self.db.collection("chat_messages").docs.items() if m["role"] == "user")
        self.assertEqual(self.rate("no-such-message", rating="up").status_code, 404)
        self.assertEqual(self.rate(user_msg, rating="up").status_code, 404)
        self.assertEqual(len(self.rows()), 0)
        self.assertEqual(self.rate(body["messageId"], rating="up").status_code, 200)

    def test_bad_input_is_refused(self):
        body = self.answer()
        for bad in ({"rating": "meh"}, {"rating": "down", "reason": "because"}, {"rating": "up", "comment": "x" * 501}):
            self.assertEqual(self.rate(body["messageId"], **bad).status_code, 422, bad)
        self.assertEqual(len(self.rows()), 0)

    def test_it_needs_a_token(self):
        body = self.answer()
        r = quiet(self.client.put, f"/messages/{body['messageId']}/feedback", json={"rating": "up"})
        self.assertEqual(r.status_code, 401)


class TestTryAgain(FeedbackCase):
    def use_replies(self, *replies):
        replies = list(replies)
        calls = self.llm.calls

        def invoke(messages):
            calls.append(messages)
            return types.SimpleNamespace(content=replies.pop(0) if len(replies) > 1 else replies[0])
        self.llm.invoke = invoke

    def test_try_again_answers_afresh_instead_of_reusing_the_stored_answer(self):
        self.use_replies("First answer.", "Second answer.")
        first = self.answer()
        again = self.ask_in(self.chat, Q).json()
        self.assertTrue(again["cached"], "sanity: asking again normally reuses the answer")
        fresh = self.ask_in(self.chat, Q, regenerate=True).json()
        self.assertFalse(fresh["cached"])
        self.assertEqual((first["answer"], fresh["answer"]), ("First answer.", "Second answer."))
        self.assertEqual(len(self.llm.calls), 2)

    def test_the_fresh_answer_replaces_the_stored_one(self):
        self.use_replies("First answer.", "Second answer.")
        self.answer()
        self.ask_in(self.chat, Q, regenerate=True)
        self.assertEqual(len(self.db.collection("questions").docs), 1)
        later = self.ask_in(self.chat, Q).json()
        self.assertTrue(later["cached"])
        self.assertEqual(later["answer"], "Second answer.")

    def test_the_exchange_is_marked_so_the_chat_can_show_it_as_a_retry(self):
        self.answer()
        self.ask_in(self.chat, Q, regenerate=True)
        users = [m for m in self.db.collection("chat_messages").docs.values() if m["role"] == "user"]
        flags = sorted(bool(m["metadata"].get("regenerated")) for m in users)
        self.assertEqual(flags, [False, True])

    def test_try_again_on_a_refusal_still_refuses_honestly(self):
        self.retrieval_docs = []
        self.answer("What is the parking fee?")
        body = self.ask_in(self.chat, "What is the parking fee?", regenerate=True).json()
        self.assertFalse(body["answered"])

    def test_try_again_costs_a_model_call_like_any_other(self):
        self.answer()
        calls = len(self.llm.calls)
        self.ask_in(self.chat, Q, regenerate=True)
        self.assertEqual(len(self.llm.calls), calls + 1)


class TestAgeOfAReusedAnswer(FeedbackCase):
    def test_a_reused_answer_says_when_it_was_made(self):
        before = int(time.time() * 1000)
        fresh = self.answer()
        self.assertIsNone(fresh["cachedAtMs"])
        self.assertIsNone(fresh["metadata"]["cachedAtMs"])
        reused = self.ask_in(self.make_chat("A"), Q).json()
        self.assertTrue(reused["cached"])
        self.assertGreaterEqual(reused["cachedAtMs"], before)
        self.assertLessEqual(reused["cachedAtMs"], int(time.time() * 1000))
        self.assertEqual(reused["metadata"]["cachedAtMs"], reused["cachedAtMs"])


class TestExport(FeedbackCase):
    def test_the_export_keeps_the_learning_context_and_drops_who_asked(self):
        from scripts.export_feedback import export_rows
        up, down = self.answer(), self.answer("What is the re-exam fee?")
        self.rate(up["messageId"], rating="up")
        self.rate(down["messageId"], rating="down", reason="wrong", comment="no")
        rows = export_rows(self.db)
        self.assertEqual(len(rows), 2)
        for row in rows:
            for private in ("userId", "chatId", "historyId", "messageId"):
                self.assertNotIn(private, row)
            self.assertIn("question", row)
            self.assertIn("chunkIds", row)
        only_down = export_rows(self.db, only_down=True)
        self.assertEqual([r["rating"] for r in only_down], ["down"])
        self.assertEqual(only_down[0]["reason"], "wrong")


if __name__ == "__main__":
    unittest.main()
