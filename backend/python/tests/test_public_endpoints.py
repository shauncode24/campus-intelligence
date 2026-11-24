"""
P0-4: what an anonymous caller can reach costs (almost) nothing, and reveals nothing.
"""
import _env  # noqa: F401  (must be first)

import unittest

from test_ingestion import IngestCase, quiet  # noqa: E402  (sets up the app)
from database.faq_repository import faq_repository  # noqa: E402
from database.firebase_client import firebase_client  # noqa: E402
import auth as authmod  # noqa: E402


class CountingDB:
    """Wraps the fake database and counts every collection access."""
    def __init__(self, inner):
        self.inner, self.accesses = inner, 0

    def collection(self, name):
        self.accesses += 1
        return self.inner.collection(name)


class TestPublicEndpoints(IngestCase):
    def setUp(self):
        super().setUp()
        faq_repository.clear_cache()
        self.addCleanup(faq_repository.clear_cache)
        self.db.collection("faqs").document("f1").set({"question": "Q?", "answer": "A", "published": True, "order": 1})
        self._real = firebase_client._db
        self.counter = CountingDB(self.db)
        firebase_client._db = self.counter
        self.addCleanup(setattr, firebase_client, "_db", self._real)

    def test_a_crowd_on_health_causes_no_database_reads(self):
        for _ in range(200):
            self.assertEqual(quiet(self.http.get, "/health").status_code, 200)
            self.assertEqual(quiet(self.http.get, "/healthz").status_code, 200)
        self.assertEqual(self.counter.accesses, 0)

    def test_a_crowd_on_the_faq_causes_one_read(self):
        for _ in range(100):
            r = quiet(self.http.get, "/faq")
            self.assertEqual([f["id"] for f in r.json()["faqs"]], ["f1"])
        self.assertEqual(self.counter.accesses, 1)

    def test_the_faq_cache_expires(self):
        quiet(self.http.get, "/faq")
        import database.faq_repository as fr
        cls = type(faq_repository)
        cls._cache = (cls._cache[0] - fr.CACHE_SECONDS - 1, cls._cache[1])
        self.db.collection("faqs").document("f2").set({"question": "Q2?", "answer": "A2", "published": True, "order": 2})
        ids = [f["id"] for f in quiet(self.http.get, "/faq").json()["faqs"]]
        self.assertEqual(ids, ["f1", "f2"])

    def test_the_faq_limit_still_applies_to_the_cached_list(self):
        self.db.collection("faqs").document("f2").set({"question": "Q2?", "answer": "A2", "published": True, "order": 2})
        self.assertEqual(len(quiet(self.http.get, "/faq", params={"limit": 1}).json()["faqs"]), 1)
        self.assertEqual(len(quiet(self.http.get, "/faq", params={"limit": 50}).json()["faqs"]), 2)

    def test_document_exists_needs_a_signed_in_user_and_no_read_without_one(self):
        r = quiet(self.http.get, "/documents/d1/exists")
        self.assertEqual(r.status_code, 401)
        self.assertEqual(self.counter.accesses, 0)

    def test_document_exists_works_for_a_signed_in_user(self):
        self.db.collection("documents").document("d1").set({"name": "x"})
        authmod.firebase_auth.verify_id_token = lambda t, *a, **k: {"uid": "A"}
        h = {"Authorization": "Bearer t"}
        self.assertTrue(quiet(self.http.get, "/documents/d1/exists", headers=h).json()["exists"])
        self.assertFalse(quiet(self.http.get, "/documents/nope/exists", headers=h).json()["exists"])
        self.assertFalse(quiet(self.http.get, "/documents/" + "a" * 300 + "/exists", headers=h).json()["exists"])


if __name__ == "__main__":
    unittest.main()
