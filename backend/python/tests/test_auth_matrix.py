"""
Authentication and ownership for the whole Python API, driven by the real route table.

* Every route must demand a verified token unless it is on a short, explicit PUBLIC list. A new
  route someone adds without protection makes this test fail (so the list is a conscious choice).
* Admin routes must refuse an ordinary signed-in user.
* User B must not be able to read or change anything of user A's.
"""
import unittest

from fastapi.routing import APIRoute

from test_ingestion import IngestCase, quiet  # noqa: E402  (sets up the app)
import main  # noqa: E402

# Reachable without signing in. Keep this list short and deliberate.
PUBLIC = {
    ("GET", "/healthz"),                         # liveness only
    ("GET", "/health"),                          # counts and model name; no user data
    ("GET", "/faq"),                             # admin-curated, published FAQ
    ("GET", "/documents/{documentId}/exists"),   # only whether an id exists
}

# Need the admin claim (a signed-in ordinary user gets 403)
ADMIN = {
    ("POST", "/process-document"),
    ("POST", "/check-duplicate"),
}


def api_routes():
    for route in main.app.routes:
        if isinstance(route, APIRoute):
            for method in sorted(route.methods - {"HEAD", "OPTIONS"}):
                yield method, route.path


def concrete(path):
    """/chats/{chatId}/messages -> /chats/x/messages"""
    out, depth = [], 0
    for ch in path:
        if ch == "{":
            depth += 1
            out.append("x")
        elif ch == "}":
            depth -= 1
        elif depth == 0:
            out.append(ch)
    return "".join(out)


class TestEveryRouteIsProtected(IngestCase):
    def test_the_route_table_is_not_empty_and_the_public_list_has_no_stale_entries(self):
        routes = set(api_routes())
        self.assertGreaterEqual(len(routes), 10)
        self.assertEqual(PUBLIC - routes, set(), "PUBLIC lists a route that no longer exists")
        self.assertEqual(ADMIN - routes, set(), "ADMIN lists a route that no longer exists")

    def test_every_other_route_answers_401_without_a_token(self):
        unprotected = []
        for method, path in api_routes():
            if (method, path) in PUBLIC:
                continue
            r = quiet(self.http.request, method, concrete(path), json={})
            if r.status_code != 401:
                unprotected.append((method, path, r.status_code))
        self.assertEqual(unprotected, [], "routes that do not require a token")

    def test_a_garbage_token_is_refused_everywhere_too(self):
        # the shared test fixture accepts any token string as a user id; use the real behaviour here:
        # Firebase rejects a token it did not issue
        import auth as authmod

        def reject(token, *a, **k):
            raise ValueError("Decoding Firebase ID token failed")
        original = authmod.firebase_auth.verify_id_token
        authmod.firebase_auth.verify_id_token = reject
        try:
            self._garbage_token_everywhere()
        finally:
            authmod.firebase_auth.verify_id_token = original

    def _garbage_token_everywhere(self):
        for method, path in api_routes():
            if (method, path) in PUBLIC:
                continue
            r = quiet(self.http.request, method, concrete(path), json={},
                      headers={"Authorization": "Bearer not-a-real-token"})
            self.assertEqual(r.status_code, 401, f"{method} {path} -> {r.status_code}")

    def test_admin_routes_refuse_an_ordinary_signed_in_user(self):
        for method, path in sorted(ADMIN):
            r = quiet(self.http.request, method, concrete(path), json={}, params={"sha256": "a" * 64},
                      headers=self.hdr("tokA"))
            self.assertEqual(r.status_code, 403, f"{method} {path}")

    def test_the_public_routes_really_are_open_and_leak_nothing_personal(self):
        for path in ("/healthz", "/health"):
            self.assertEqual(quiet(self.http.get, path).status_code, 200, path)
        self.db.collection("faqs").document("f1").set({"question": "Q?", "answer": "A", "published": True, "order": 1})
        self.db.collection("user_questions").document("u1").set({"userId": "A", "questionText": "my private question"})
        body = quiet(self.http.get, "/faq").text
        self.assertNotIn("my private question", body)


class TestUserBCannotTouchUserAsData(IngestCase):
    def setUp(self):
        super().setUp()
        self.chat = self.db.collection("chats").document()
        self.chat.set({"userId": "tokA", "title": "A's chat", "messageCount": 0})
        # a real exchange, so there is a chat message and a history entry to attack
        self.answer = quiet(self.http.post, "/query", json={"question": "What is the late fee for tuition?", "chatId": self.chat.id},
                            headers=self.hdr("tokA")).json()
        self.history_id = self.answer["historyId"]

    def snapshot(self):
        return {name: {k: dict(v) for k, v in self.db.collection(name).docs.items()}
                for name in ("chats", "chat_messages", "user_questions")}

    def test_reading_and_changing_another_users_chat_and_history_is_a_404_and_changes_nothing(self):
        before = self.snapshot()
        b = self.hdr("tokB")
        attempts = [
            ("GET", f"/chats/{self.chat.id}/messages", None),
            ("PUT", f"/chats/{self.chat.id}/title", {"title": "hijacked"}),
            ("DELETE", f"/chats/{self.chat.id}", None),
            ("PUT", f"/history/{self.history_id}/favorite", None),
            ("PUT", f"/history/{self.history_id}/note", {"note": "hijacked"}),
            ("DELETE", f"/history/{self.history_id}", None),
        ]
        for method, path, body in attempts:
            r = quiet(self.http.request, method, path, json=body, headers=b)
            self.assertEqual(r.status_code, 404, f"{method} {path} -> {r.status_code}")
        r = quiet(self.http.post, "/query", json={"question": "What is the late fee for tuition?", "chatId": self.chat.id}, headers=b)
        self.assertEqual(r.status_code, 404)
        self.assertEqual(self.snapshot(), before, "nothing of A's was changed")

    def test_listings_only_ever_contain_the_callers_own_items(self):
        chats = quiet(self.http.get, "/chats", headers=self.hdr("tokB")).json()["chats"]
        history = quiet(self.http.get, "/history", headers=self.hdr("tokB")).json()["history"]
        self.assertEqual((chats, history), ([], []))
        self.assertEqual(len(quiet(self.http.get, "/chats", headers=self.hdr("tokA")).json()["chats"]), 1)
        self.assertEqual(len(quiet(self.http.get, "/history", headers=self.hdr("tokA")).json()["history"]), 1)

    def test_a_user_id_in_the_body_or_query_is_ignored(self):
        r = quiet(self.http.post, "/query", json={"question": "What is the late fee for tuition?", "userId": "tokA"},
                  params={"userId": "tokA"}, headers=self.hdr("tokB"))
        self.assertEqual(r.status_code, 200)
        owners = {v["userId"] for v in self.db.collection("user_questions").docs.values()}
        self.assertEqual(owners, {"tokA", "tokB"}, "B's question was stored under B, not A")
        self.assertEqual(len([v for v in self.db.collection("user_questions").docs.values() if v["userId"] == "tokA"]), 1)

    def test_the_owner_can_still_do_all_of_it(self):
        a = self.hdr("tokA")
        self.assertEqual(quiet(self.http.get, f"/chats/{self.chat.id}/messages", headers=a).status_code, 200)
        self.assertEqual(quiet(self.http.put, f"/chats/{self.chat.id}/title", json={"title": "mine"}, headers=a).status_code, 200)
        self.assertEqual(quiet(self.http.put, f"/history/{self.history_id}/favorite", headers=a).status_code, 200)
        self.assertEqual(quiet(self.http.put, f"/history/{self.history_id}/note", json={"note": "n"}, headers=a).status_code, 200)
        self.assertEqual(quiet(self.http.delete, f"/history/{self.history_id}", headers=a).status_code, 200)
        self.assertEqual(quiet(self.http.delete, f"/chats/{self.chat.id}", headers=a).status_code, 200)


if __name__ == "__main__":
    unittest.main()
