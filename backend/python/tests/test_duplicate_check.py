"""P1-9: duplicate detection for uploads: the same file by content hash, and similar names."""
import hashlib
import unittest

from test_ingestion import IngestCase, quiet  # noqa: E402  (sets up the app)

FAKE_PDF = b"%PDF-1.4 fake"          # what the stand-in downloader returns in IngestCase
DIGEST = hashlib.sha256(FAKE_PDF).hexdigest()


class DupCase(IngestCase):
    def check(self, token="boss", **params):
        return quiet(self.http.post, "/check-duplicate", params=params, headers=self.hdr(token))


class TestContentHash(DupCase):
    def test_processing_records_the_hash_of_the_file(self):
        doc = self.make_doc()
        self.process(doc)
        self.assertEqual(self.wait_for(doc)["contentSha256"], DIGEST)

    def test_the_same_file_under_another_name_is_found(self):
        original = self.make_doc(name="Fee Policy 2024", department="Academics")
        self.process(original)
        self.wait_for(original)
        body = self.check(sha256=DIGEST, name="Totally different name", department="Library").json()
        self.assertEqual([d["id"] for d in body["exactDuplicates"]], [original])
        self.assertTrue(body["hasDuplicates"])

    def test_a_hash_alone_is_enough(self):
        doc = self.make_doc()
        self.process(doc)
        self.wait_for(doc)
        body = self.check(sha256=DIGEST.upper()).json()
        self.assertEqual(len(body["exactDuplicates"]), 1, "hex case does not matter")
        self.assertEqual(body["similarDocuments"], [])

    def test_a_different_file_is_not_a_duplicate(self):
        doc = self.make_doc()
        self.process(doc)
        self.wait_for(doc)
        body = self.check(sha256=hashlib.sha256(b"other").hexdigest()).json()
        self.assertEqual((body["hasDuplicates"], body["exactDuplicates"]), (False, []))

    def test_documents_being_deleted_or_cancelled_do_not_count(self):
        self.make_doc(status="Deleting", contentSha256=DIGEST)
        self.make_doc(status="Cancelled", contentSha256=DIGEST)
        kept = self.make_doc(status="Error", contentSha256=DIGEST)
        body = self.check(sha256=DIGEST).json()
        self.assertEqual([d["id"] for d in body["exactDuplicates"]], [kept])


class TestSimilarNames(DupCase):
    def test_a_similar_name_in_the_same_department_is_a_hint(self):
        doc = self.make_doc(name="Fee Policy", department="Academics", status="Processed")
        body = self.check(name="Fee Policy 2025", department="Academics").json()
        self.assertEqual([d["id"] for d in body["similarDocuments"]], [doc])
        self.assertEqual(body["exactDuplicates"], [])

    def test_other_departments_and_unprocessed_documents_are_ignored(self):
        self.make_doc(name="Fee Policy", department="Library", status="Processed")
        self.make_doc(name="Fee Policy", department="Academics", status="Error")
        self.assertFalse(self.check(name="Fee Policy", department="Academics").json()["hasDuplicates"])

    def test_an_exact_match_is_not_repeated_as_a_similar_one(self):
        doc = self.make_doc(name="Fee Policy", department="Academics", status="Processed", contentSha256=DIGEST)
        body = self.check(name="Fee Policy", department="Academics", sha256=DIGEST).json()
        self.assertEqual([d["id"] for d in body["exactDuplicates"]], [doc])
        self.assertEqual(body["similarDocuments"], [])


class TestInputs(DupCase):
    def test_bad_input_is_refused(self):
        self.assertEqual(self.check(sha256="not-a-hash").status_code, 400)
        self.assertEqual(self.check(sha256="a" * 63).status_code, 400)
        self.assertEqual(self.check().status_code, 400)
        self.assertEqual(self.check(name="x").status_code, 400)            # a name needs its department

    def test_only_admins(self):
        self.assertEqual(self.check(token="tokA", sha256=DIGEST).status_code, 403)
        self.assertEqual(quiet(self.http.post, "/check-duplicate", params={"sha256": DIGEST}).status_code, 401)


if __name__ == "__main__":
    unittest.main()
