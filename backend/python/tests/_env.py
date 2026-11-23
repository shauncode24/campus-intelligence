"""
Import this FIRST in every test module.

Makes `import config` read an EMPTY env file instead of backend/.env, so running
the tests never loads real secrets into the process, and puts backend/python on
sys.path.
"""
import os
import sys
import tempfile

_empty = os.path.join(tempfile.gettempdir(), "campus_intel_empty.env")
open(_empty, "w").close()
os.environ["ENV_FILE"] = _empty

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

# The services print emoji; a Windows console in cp1252 would crash on them.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")
    except Exception:
        pass
