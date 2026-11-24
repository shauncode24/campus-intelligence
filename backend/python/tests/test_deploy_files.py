"""
P1-10: the build files cannot silently drift from the code.

These are static checks (no Docker needed): every dependency is pinned, everything the code
imports is in the requirements, the image runs unprivileged with a healthcheck on the right
port, and secrets stay out of the build context. Plus the liveness endpoint the healthcheck uses.
"""
import _env  # noqa: F401  (must be first)

import ast
import os
import re
import sys
import unittest

from test_ingestion import IngestCase, quiet  # noqa: E402  (sets up the app)
from database.firebase_client import firebase_client  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

# import name -> distribution name, where they differ
DIST_FOR_IMPORT = {
    "PIL": "pillow", "fitz": "pymupdf", "dotenv": "python-dotenv", "firebase_admin": "firebase-admin",
    "langchain_core": "langchain-core", "langchain_text_splitters": "langchain-text-splitters",
    "langchain_google_genai": "langchain-google-genai",
}


def read(name):
    with open(os.path.join(ROOT, name), encoding="utf-8") as f:
        return f.read()


def requirement_lines(name):
    lines = []
    for raw in read(name).splitlines():
        line = raw.split("#")[0].strip()
        if line and not line.startswith("-"):
            lines.append(line)
    return lines


def dist_name(line):
    return re.split(r"[=<>!~;\[ ]", line, 1)[0].lower().replace("_", "-")


class TestRequirements(unittest.TestCase):
    def test_every_package_is_pinned_exactly(self):
        for line in requirement_lines("requirements.txt"):
            self.assertRegex(line, r"==", f"not pinned: {line}")
        for line in requirement_lines("requirements.in"):
            self.assertRegex(line, r"==", f"not pinned: {line}")

    def test_the_generated_file_contains_every_direct_dependency_at_the_same_version(self):
        locked = {dist_name(l): l.split("==")[1].split(";")[0].strip() for l in requirement_lines("requirements.txt")}
        for line in requirement_lines("requirements.in"):
            name, version = dist_name(line), line.split("==")[1].strip()
            self.assertIn(name, locked, f"{name} is in requirements.in but missing from requirements.txt")
            self.assertEqual(locked[name], version, f"{name}: requirements.in says {version}, requirements.txt {locked[name]}")

    def test_everything_the_code_imports_is_a_declared_dependency(self):
        declared = {dist_name(l) for l in requirement_lines("requirements.txt")}
        local = {n[:-3] for n in os.listdir(ROOT) if n.endswith(".py")} | {
            n for n in os.listdir(ROOT) if os.path.isdir(os.path.join(ROOT, n)) and not n.startswith((".", "__"))}
        missing = {}
        for folder, dirs, files in os.walk(ROOT):
            dirs[:] = [d for d in dirs if d not in ("__pycache__", "tests", "venv")]
            for name in files:
                if not name.endswith(".py"):
                    continue
                tree = ast.parse(open(os.path.join(folder, name), encoding="utf-8").read())
                for node in ast.walk(tree):
                    modules = []
                    if isinstance(node, ast.Import):
                        modules = [a.name for a in node.names]
                    elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
                        modules = [node.module]
                    for module in modules:
                        top = module.split(".")[0]
                        if top in sys.stdlib_module_names or top in local:
                            continue
                        dist = DIST_FOR_IMPORT.get(top, top).lower().replace("_", "-")
                        if dist not in declared:
                            missing.setdefault(dist, []).append(name)
        self.assertEqual(missing, {}, "imported but not in requirements.txt")

    def test_packages_the_code_no_longer_uses_are_gone(self):
        declared = {dist_name(l) for l in requirement_lines("requirements.txt")}
        for unused in ("faiss-cpu", "sentence-transformers", "langchain", "langchain-community"):
            self.assertNotIn(unused, declared)

    def test_cpu_torch_is_used_so_the_image_does_not_pull_cuda(self):
        text = read("requirements.txt")
        self.assertIn("download.pytorch.org/whl/cpu", text)
        self.assertNotRegex(text, r"(?m)^nvidia-")


def build_files_present():
    """The Dockerfile and .dockerignore are not copied into the image (that is what .dockerignore says)."""
    return all(os.path.exists(os.path.join(ROOT, n)) for n in ("Dockerfile", ".dockerignore"))


@unittest.skipUnless(build_files_present(), "build files are not part of the image")
class TestDockerfile(unittest.TestCase):
    def setUp(self):
        self.text = read("Dockerfile")

    def test_it_runs_as_a_non_root_user(self):
        users = re.findall(r"(?m)^USER\s+(\S+)", self.text)
        self.assertTrue(users and users[-1] not in ("root", "0"))

    def test_the_python_version_is_the_one_the_tests_run_on(self):
        major, minor = sys.version_info[:2]
        self.assertRegex(self.text, rf"FROM python:{major}\.{minor}-slim")

    def test_there_is_a_healthcheck_on_the_liveness_endpoint(self):
        self.assertIn("HEALTHCHECK", self.text)
        self.assertIn("/healthz", self.text)

    def test_the_port_agrees_with_the_rest_of_the_project(self):
        self.assertIn("EXPOSE 8000", self.text)
        self.assertIn("PORT=8000", self.text)
        self.assertIn('port=8000', read("main.py"))

    def test_models_are_baked_in_and_dependencies_installed_before_the_code_is_copied(self):
        self.assertIn("scripts/download_models.py", self.text)
        self.assertLess(self.text.index("pip install -r requirements.txt"), self.text.index("COPY . ."))

    def test_the_server_is_started_through_uvicorn_with_the_port_variable(self):
        self.assertRegex(self.text, r'CMD \[.*uvicorn main:app.*\$\{PORT:-8000\}')


@unittest.skipUnless(build_files_present(), "build files are not part of the image")
class TestDockerIgnore(unittest.TestCase):
    def test_secrets_and_local_environments_stay_out_of_the_image(self):
        entries = {l.strip() for l in read(".dockerignore").splitlines() if l.strip() and not l.startswith("#")}
        for must in (".env", ".env.*", "venv/", "__pycache__/", "*.pem"):
            self.assertIn(must, entries)


class TestLiveness(IngestCase):
    def test_healthz_answers_without_touching_the_database(self):
        class Exploding:
            def collection(self, *_):
                raise AssertionError("/healthz must not read the database")
        original = firebase_client._db
        firebase_client._db = Exploding()
        try:
            r = quiet(self.http.get, "/healthz")
        finally:
            firebase_client._db = original
        self.assertEqual((r.status_code, r.json()), (200, {"status": "ok"}))

    def test_health_is_public_and_costs_no_database_reads(self):
        """P0-4: anyone can call /health, so it must not bill a read per call."""
        class Exploding:
            def collection(self, *_):
                raise AssertionError("/health must not read the database")
        original = firebase_client._db
        firebase_client._db = Exploding()
        try:
            r = quiet(self.http.get, "/health")
        finally:
            firebase_client._db = original
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["status"], "healthy")
        self.assertIn("chunks_in_firebase", r.json())


if __name__ == "__main__":
    unittest.main()
