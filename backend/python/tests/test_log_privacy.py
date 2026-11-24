"""
P0-2: nothing a student types and no raw user id is ever written to the logs, on the
answer path, the follow-up path, the cached-answer path and the history routes.
"""
import _env  # noqa: F401  (must be first)

import contextlib
import io
import unittest

import auth as authmod
from services.llm_service import llm_service
from test_followup_endpoint import FollowUpCase, HISTORY

SECRET_Q = "ZEBRA-SECRET-QUESTION what is the late fee for tuition?"
SECRET_FOLLOW = "ZEBRA-SECRET-FOLLOWUP and the maximum?"
SECRET_UID = "UID-SENTINEL-4471"


class TestLogPrivacy(FollowUpCase):
    def setUp(self):
        super().setUp()
        authmod.firebase_auth.verify_id_token = lambda t, *a, **k: {"uid": SECRET_UID}
        self.out, self.err = io.StringIO(), io.StringIO()

    def call(self, method, path, **kw):
        headers = {"Authorization": "Bearer tokA"}
        with contextlib.redirect_stdout(self.out), contextlib.redirect_stderr(self.err):
            return self.client.request(method, path, headers=headers, **kw)

    def logs(self):
        return self.out.getvalue() + self.err.getvalue()

    def assertClean(self):
        text = self.logs()
        self.assertTrue(text.strip(), "the test captured no log output at all")
        for secret in ("ZEBRA-SECRET", SECRET_UID):
            self.assertNotIn(secret, text)

    def test_a_fresh_answer_logs_no_question_and_no_user_id(self):
        r = self.call("POST", "/query", json={"question": SECRET_Q})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertClean()

    def test_the_cached_answer_path_logs_neither(self):
        self.call("POST", "/query", json={"question": SECRET_Q})
        r = self.call("POST", "/query", json={"question": SECRET_Q})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertClean()

    def test_a_follow_up_logs_neither_the_typed_nor_the_rewritten_question(self):
        self.condense_reply = "ZEBRA-SECRET-REWRITE what is the maximum late fee?"
        r = self.call("POST", "/query", json={"question": SECRET_FOLLOW, "history": HISTORY})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertClean()

    def test_the_streaming_path_logs_neither(self):
        async def fake_stream(message):
            yield "The maximum late fee is Rs. 5,000 [Fees, p. 1]."
        self.stream_saved = llm_service.stream_answer
        llm_service.stream_answer = fake_stream
        self.addCleanup(setattr, llm_service, "stream_answer", self.stream_saved)
        r = self.call("POST", "/query/stream", json={"question": SECRET_Q})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertClean()

    def test_the_history_routes_log_no_user_id(self):
        self.call("POST", "/query", json={"question": SECRET_Q})
        r = self.call("GET", "/history")
        self.assertEqual(r.status_code, 200, r.text)
        item = r.json()["history"][0] if isinstance(r.json(), dict) else r.json()[0]
        hid = item.get("id") or item.get("historyId")
        self.call("PUT", f"/history/{hid}/favorite")
        self.call("DELETE", f"/history/{hid}")
        self.assertClean()


if __name__ == "__main__":
    unittest.main()
