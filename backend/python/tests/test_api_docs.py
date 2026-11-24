"""
API.md lists every route of the RAG service, and only the ones that exist (AUDIT P2-4).
Adding, removing or renaming a route without updating the document fails this test.
"""
import _env  # noqa: F401  (must be first)

import os
import re
import unittest

from test_ingestion import IngestCase  # noqa: E402  (sets up the app)
import main  # noqa: E402
import route_table  # noqa: E402

API_MD = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "API.md"))


def documented(section):
    """(METHOD, path) rows of the table under the '## <section>' heading."""
    text = open(API_MD, encoding="utf-8").read()
    body = text.split(f"## {section}", 1)[1].split("\n## ", 1)[0]
    return sorted({(m, p) for m, p in re.findall(r"^\|\s*([A-Z]+)\s*\|\s*`([^`]+)`", body, re.M)})


@unittest.skipUnless(os.path.exists(API_MD), "API.md is not part of the container image")
class TestApiDocument(IngestCase):
    def test_the_rag_service_table_matches_the_real_routes(self):
        real, doc = route_table.api_routes(main.app), documented("RAG service")
        self.assertEqual([r for r in real if r not in doc], [], "routes missing from API.md")
        self.assertEqual([d for d in doc if d not in real], [], "API.md lists routes that do not exist")

    def test_the_table_is_not_empty(self):
        self.assertGreater(len(documented("RAG service")), 10)
        self.assertGreater(len(documented("Node API")), 10)


if __name__ == "__main__":
    unittest.main()
