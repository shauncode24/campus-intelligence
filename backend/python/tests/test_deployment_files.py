"""
P1-8: the deployment files agree with each other and with the code (the things that fail silently
when they drift: the Node address Python trusts, streaming through the proxy, secrets in images).
"""
import _env  # noqa: F401  (must be first)

import os
import re
import unittest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))


def read(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf8") as f:
        return f.read()


@unittest.skipUnless(os.path.exists(os.path.join(ROOT, "deploy", "docker-compose.yml")),
                     "deployment files are not part of the container image")
class TestDeploymentFiles(unittest.TestCase):
    def test_python_trusts_exactly_the_address_the_node_container_has(self):
        compose = read("deploy", "docker-compose.yml")
        node_ip = re.search(r"node-api:.*?ipv4_address: (\S+)", compose, re.S).group(1)
        trusted = re.search(r"TRUSTED_PROXY_IPS: (\S+)", compose).group(1)
        self.assertEqual(trusted, node_ip)

    def test_the_proxy_does_not_buffer_streamed_answers_and_the_prefixes_match_the_runbook(self):
        caddy = read("deploy", "Caddyfile")
        self.assertEqual(caddy.count("flush_interval -1"), 2)
        for prefix in ("/api/*", "/rag/*"):
            self.assertIn(f"handle_path {prefix}", caddy)
        deploy = read("DEPLOY.md")
        self.assertIn("/api", deploy)
        self.assertIn("VITE_PYTHON_RAG_URL=https://campus.example.edu/rag", deploy)

    def test_only_one_rag_container_is_defined(self):
        compose = read("deploy", "docker-compose.yml")
        self.assertEqual(len(re.findall(r"^  rag:", compose, re.M)), 1)
        self.assertNotIn("scale:", compose)
        self.assertNotIn("replicas", compose)

    def test_the_node_image_runs_unprivileged_and_contains_no_secrets_or_the_python_service(self):
        dockerfile = read("backend", "Dockerfile")
        self.assertRegex(dockerfile, r"(?m)^USER node$")
        self.assertNotRegex(dockerfile, r"COPY .*\.env")
        ignore = {l.strip() for l in read("backend", ".dockerignore").splitlines() if l.strip() and not l.startswith("#")}
        for must in (".env", ".env.*", "python/", "venv/", "node_modules/", "*.pem"):
            self.assertIn(must, ignore)
        self.assertIn("/healthz", dockerfile)

    def test_secrets_stay_out_of_the_compose_file(self):
        compose = read("deploy", "docker-compose.yml") + read("deploy", ".env.example")
        for needle in ("PRIVATE_KEY", "API_KEY=", "SERVICE_ROLE", "TOKEN_ENCRYPTION_KEY="):
            self.assertNotIn(needle, compose)

    def test_the_runbook_names_every_setting_it_depends_on(self):
        deploy = read("DEPLOY.md")
        example = read("backend", ".env.example")
        for name in ("SUPABASE_SERVICE_ROLE_KEY", "TOKEN_ENCRYPTION_KEY", "ALERT_WEBHOOK_URL"):
            self.assertIn(name, deploy)
        for name in ("SUPABASE_SERVICE_ROLE_KEY", "TOKEN_ENCRYPTION_KEY", "TRUSTED_PROXY_IPS"):
            self.assertIn(name, example)

    def test_the_ttl_fields_the_runbook_enables_are_really_written_by_the_code(self):
        deploy = read("DEPLOY.md")
        for collection in ("calendar_oauth_states", "llm_usage"):
            self.assertIn(f"--collection-group={collection}", deploy)
        self.assertIn("expireAt", read("backend", "routes", "calendarRoutes.js"))
        self.assertIn("expireAt", read("backend", "python", "utils", "daily_budget.py"))


if __name__ == "__main__":
    unittest.main()
