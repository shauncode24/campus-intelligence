"""
P0-3: the RAG service sees the real student's IP when the Node API forwards it, and never
believes that header from anyone else. Without this every student shared one per-IP bucket.
"""
import _env  # noqa: F401  (must be first)

import types
import unittest

from config import Config
import utils.rate_limit as rl


def req(peer, headers=None):
    return types.SimpleNamespace(client=types.SimpleNamespace(host=peer) if peer else None,
                                 headers={k.lower(): v for k, v in (headers or {}).items()})


class TestClientIp(unittest.TestCase):
    def setUp(self):
        self._saved = (Config.TRUST_PROXY, Config.TRUSTED_PROXY_IPS, Config.QUERY_RATE_PER_MINUTE_PER_IP,
                       Config.QUERY_RATE_PER_MINUTE)
        Config.TRUST_PROXY = False
        Config.TRUSTED_PROXY_IPS = ["127.0.0.1", "::1"]
        rl.limiter._hits.clear()

    def tearDown(self):
        (Config.TRUST_PROXY, Config.TRUSTED_PROXY_IPS, Config.QUERY_RATE_PER_MINUTE_PER_IP,
         Config.QUERY_RATE_PER_MINUTE) = self._saved
        rl.limiter._hits.clear()

    def test_node_forwards_the_students_address(self):
        self.assertEqual(rl.client_ip(req("127.0.0.1", {"X-Client-IP": "203.0.113.7"})), "203.0.113.7")
        self.assertEqual(rl.client_ip(req("::1", {"X-Client-IP": "2001:db8::5"})), "2001:db8::5")

    def test_the_header_is_ignored_from_an_untrusted_caller(self):
        # a student calling the service directly cannot pick their own IP
        self.assertEqual(rl.client_ip(req("198.51.100.9", {"X-Client-IP": "1.2.3.4"})), "198.51.100.9")

    def test_no_header_falls_back_to_the_peer(self):
        self.assertEqual(rl.client_ip(req("127.0.0.1")), "127.0.0.1")
        self.assertEqual(rl.client_ip(req(None)), "unknown")

    def test_a_junk_header_is_not_used(self):
        self.assertEqual(rl.client_ip(req("127.0.0.1", {"X-Client-IP": "x" * 200})), "127.0.0.1")
        self.assertEqual(rl.client_ip(req("127.0.0.1", {"X-Client-IP": "  "})), "127.0.0.1")

    def test_forwarded_for_still_needs_trust_proxy(self):
        r = req("198.51.100.9", {"X-Forwarded-For": "9.9.9.9, 10.0.0.1"})
        self.assertEqual(rl.client_ip(r), "198.51.100.9")
        Config.TRUST_PROXY = True
        self.assertEqual(rl.client_ip(r), "9.9.9.9")

    def test_two_students_behind_node_get_separate_question_buckets(self):
        Config.QUERY_RATE_PER_MINUTE = 1000
        Config.QUERY_RATE_PER_MINUTE_PER_IP = 3
        a = req("127.0.0.1", {"X-Client-IP": "203.0.113.1"})
        b = req("127.0.0.1", {"X-Client-IP": "203.0.113.2"})
        for _ in range(3):
            rl.query_limit(a, "userA")
        with self.assertRaises(Exception) as ctx:            # student A is at their limit...
            rl.query_limit(a, "userA2")
        self.assertEqual(ctx.exception.status_code, 429)
        for _ in range(3):                                   # ...student B is not affected
            rl.query_limit(b, "userB")


if __name__ == "__main__":
    unittest.main()
