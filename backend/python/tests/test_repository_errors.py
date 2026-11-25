"""
P1-14: when the database fails, the API says so (500 with a reference), instead of answering
"you have no chats" / "not found" as if nothing were wrong.
"""
import _env  # noqa: F401  (must be first)

import unittest

from test_ingestion import IngestCase, quiet  # noqa: E402  (sets up the app)
from database.firebase_client import firebase_client  # noqa: E402


class Exploding:
    def collection(self, *_):
        raise RuntimeError("firestore unavailable: secret-internal-detail")


class TestDatabaseFailures(IngestCase):
    def setUp(self):
        super().setUp()
        self.h = self.hdr("someone")

    def call(self, method, path, **kw):
        original = firebase_client._db
        firebase_client._db = Exploding()
        try:
            return quiet(self.http.request, method, path, headers=self.h, **kw)
        finally:
            firebase_client._db = original

    def test_every_user_route_reports_a_failing_database_as_500(self):
        for method, path, kw in [
            ("GET", "/chats", {}),
            ("POST", "/chats/create", {"json": {"title": "x"}}),
            ("DELETE", "/chats/c1", {}),
            ("PUT", "/chats/c1/title", {"json": {"title": "new"}}),
            ("GET", "/history", {}),
            ("PUT", "/history/h1/favorite", {}),
            ("DELETE", "/history/h1", {}),
            ("PUT", "/history/h1/note", {"json": {"note": "n"}}),
        ]:
            with self.subTest(route=f"{method} {path}"):
                r = self.call(method, path, **kw)
                self.assertEqual(r.status_code, 500, r.text)
                self.assertIn("ref ", r.json()["detail"])
                self.assertNotIn("secret-internal-detail", r.text)       # nothing internal leaks

    def test_a_missing_item_is_still_a_404_not_a_500(self):
        for method, path, kw in [
            ("DELETE", "/chats/nope", {}),
            ("PUT", "/history/nope/favorite", {}),
            ("DELETE", "/history/nope", {}),
        ]:
            with self.subTest(route=f"{method} {path}"):
                self.assertEqual(quiet(self.http.request, method, path, headers=self.h, **kw).status_code, 404)

    def test_an_empty_account_is_an_empty_list_not_an_error(self):
        r = quiet(self.http.get, "/chats", headers=self.h)
        self.assertEqual((r.status_code, r.json()["chats"]), (200, []))


if __name__ == "__main__":
    unittest.main()
