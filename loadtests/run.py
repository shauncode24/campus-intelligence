"""
Load tests for the RAG service (AUDIT P2-6): the five scenarios of the audit's section 3F, runnable
anywhere with no credentials, no network and no Gemini quota.

    python loadtests/run.py                       # everything, default sizes (a few minutes)
    python loadtests/run.py --only chunks,concurrency
    python loadtests/run.py --quick               # tiny sizes: checks that the harness works
    python loadtests/run.py --check-budgets       # exit 3 if a budget in loadtests/budgets.json is broken

WHAT THIS MEASURES: the service's OWN work: the real FastAPI app, real embedding models, real
vector index, real PDF processing and job manager, real answer cache and rate-limit code, driven
through the ASGI interface. Firestore is the in-memory fake from the test suite and Gemini is a fake
with a configurable delay. WHAT IT DOES NOT MEASURE: real Firestore or Gemini latency, the network,
or your host's CPU count. Numbers are for spotting regressions between runs on the same machine, not
a forecast of production. See loadtests/README.md.
"""
import argparse
import asyncio
import json
import os
import platform
import subprocess
import sys
import time
import types

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
BACKEND_PY = os.path.join(ROOT, "backend", "python")
TESTS = os.path.join(BACKEND_PY, "tests")
sys.path.insert(0, TESTS)          # _env (empty env file, no secrets), fake_firestore
import _env  # noqa: E402,F401  (must come before importing the app)

_stub = types.ModuleType("langchain_google_genai")        # the app builds a Gemini client at import
_stub.ChatGoogleGenerativeAI = lambda **kwargs: None
sys.modules["langchain_google_genai"] = _stub

import numpy as np  # noqa: E402
import httpx  # noqa: E402
from config import Config  # noqa: E402
for _name in ("FIREBASE_PROJECT_ID", "FIREBASE_PRIVATE_KEY", "FIREBASE_CLIENT_EMAIL", "GOOGLE_API_KEY"):
    setattr(Config, _name, "load-test")

import auth as authmod  # noqa: E402
import utils.rate_limit as rate_limit  # noqa: E402
from database.firebase_client import firebase_client  # noqa: E402
from fake_firestore import FakeDB, FakeQuery  # noqa: E402
from services import ingestion  # noqa: E402
from services.embedding_service import embedding_service  # noqa: E402
from services.llm_service import llm_service  # noqa: E402
from services.pdf_processor import pdf_processor  # noqa: E402
from services.vector_index import vector_index  # noqa: E402
import main  # noqa: E402
from utils import observability as obs  # noqa: E402
sys.path.insert(0, HERE)
from budgets import check_budgets  # noqa: E402


# ------------------------------------------------------------------ helpers

def pct(values, p):
    return None if not values else round(float(np.percentile(values, p)), 1)


def stats(ms):
    return {"n": len(ms), "p50": pct(ms, 50), "p95": pct(ms, 95), "p99": pct(ms, 99), "max": pct(ms, 100)}


def peak_rss_mb():
    """Peak memory of this process in MB (Linux/macOS: getrusage; Windows: the working-set peak)."""
    try:
        import resource
        kb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        return round(kb / (1024 if sys.platform != "darwin" else 1024 * 1024), 1)
    except ImportError:
        pass
    try:
        import ctypes
        from ctypes import wintypes

        class Counters(ctypes.Structure):
            _fields_ = [("cb", wintypes.DWORD), ("PageFaultCount", wintypes.DWORD), ("PeakWorkingSetSize", ctypes.c_size_t),
                        ("WorkingSetSize", ctypes.c_size_t), ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                        ("QuotaPagedPoolUsage", ctypes.c_size_t), ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                        ("QuotaNonPagedPoolUsage", ctypes.c_size_t), ("PagefileUsage", ctypes.c_size_t),
                        ("PeakPagefileUsage", ctypes.c_size_t)]
        c = Counters()
        c.cb = ctypes.sizeof(c)
        kernel32, psapi = ctypes.WinDLL("kernel32"), ctypes.WinDLL("psapi")
        kernel32.GetCurrentProcess.restype = wintypes.HANDLE
        psapi.GetProcessMemoryInfo.argtypes = [wintypes.HANDLE, ctypes.POINTER(Counters), wintypes.DWORD]
        psapi.GetProcessMemoryInfo.restype = wintypes.BOOL
        if not psapi.GetProcessMemoryInfo(kernel32.GetCurrentProcess(), ctypes.byref(c), c.cb):
            return None
        return round(c.PeakWorkingSetSize / 1024 / 1024, 1)
    except Exception:
        return None


class FakeGemini:
    """Answers after a fixed delay (a thread sleeps, exactly where the real blocking call would)."""

    def __init__(self, latency_s=0.0):
        self.latency_s = latency_s
        self.calls = 0

    def invoke(self, messages):
        self.calls += 1
        if self.latency_s:
            time.sleep(self.latency_s)
        return types.SimpleNamespace(content="The late fee is Rs. 200 per day [Fees, p. 1].",
                                     usage_metadata={"input_tokens": 900, "output_tokens": 40})


class World:
    """One fresh fake database + the app, configured for load (limits off), with helpers."""

    def __init__(self, llm_latency=0.0):
        self.db = FakeDB()
        self.gemini = FakeGemini(llm_latency)
        self.chunk_reads = 0
        self._real_stream = FakeQuery.stream
        world = self

        def counting(q):
            rows = world._real_stream(q)
            if getattr(q.collection, "name", None) == "chunks":
                world.chunk_reads += len(rows)
            return rows
        FakeQuery.stream = counting
        firebase_client._db = self.db
        llm_service.llm = self.gemini
        authmod.firebase_auth.verify_id_token = lambda t, *a, **k: {"uid": t, **({"admin": True} if t == "boss" else {})}
        Config.QUERY_CONDENSING = False
        Config.IMAGE_CAPTIONING = False
        # The corpus vectors are random, so no passage is genuinely relevant. Switch the relevance floor off so
        # every question goes down the full path (retrieval, prompt, model call, save) instead of being declined.
        Config.MIN_RETRIEVAL_SCORE = -1.0
        for name in ("QUERY_RATE_PER_MINUTE", "QUERY_RATE_PER_MINUTE_PER_IP", "IP_RATE_PER_MINUTE", "WRITE_RATE_PER_MINUTE",
                     "ADMIN_RATE_PER_MINUTE", "LLM_CALLS_PER_USER_PER_DAY", "LLM_CALLS_GLOBAL_PER_DAY"):
            setattr(Config, name, 10 ** 9)
        rate_limit.limiter._hits.clear()
        vector_index.invalidate()
        obs.metrics.reset()
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://load")
        self._q = 0

    async def close(self):
        await self.client.aclose()
        FakeQuery.stream = self._real_stream

    def add_corpus(self, chunks, docs=20, pool=2000):
        """`chunks` passages in `docs` live documents. Vectors come from a pool of random unit vectors
        shared between passages, to keep memory small at 50,000 passages (ties between identical
        vectors do not matter for timing)."""
        rng = np.random.default_rng(1)
        dim = embedding_service.dimension
        vectors = rng.normal(size=(pool, dim))
        vectors = (vectors / np.linalg.norm(vectors, axis=1, keepdims=True)).tolist()
        for d in range(docs):
            self.db.collection("documents").document(f"doc{d}").set(
                {"status": "Processed", "name": f"Policy {d}", "fileUrl": None})
        store = self.db.collection("chunks")
        for i in range(chunks):
            store.document(f"c{i}").set({
                "documentId": f"doc{i % docs}", "type": "text", "content": f"passage {i} about fees deadlines and rules",
                "embedding": vectors[i % pool], "embeddingModel": embedding_service.model_id,
                "metadata": {"pageNumber": i % 40}})

    def question(self):
        self._q += 1
        return f"What is the rule number {self._q} about fees and deadlines for programme {self._q % 97}?"

    async def ask(self, user, question):
        t = time.perf_counter()
        r = await self.client.post("/query", json={"question": question}, headers={"Authorization": f"Bearer {user}"}, timeout=300)
        return (time.perf_counter() - t) * 1000.0, r.status_code, r.headers.get("x-request-id")


async def loop_lag_monitor(stop: asyncio.Event, interval=0.01):
    """How late the event loop wakes up: a blocked loop shows up here directly."""
    worst, lags = 0.0, []
    while not stop.is_set():
        t = time.perf_counter()
        await asyncio.sleep(interval)
        lag = (time.perf_counter() - t - interval) * 1000.0
        lags.append(lag)
        worst = max(worst, lag)
    return {"max": round(worst, 1), "p95": pct(lags, 95)}


# ------------------------------------------------------------------ scenario 1: chunk count

async def scenario_chunks(sizes, questions):
    out = {}
    for n in sizes:
        w = World()
        try:
            w.add_corpus(n)
            ms0, status0, _ = await w.ask("u1", w.question())          # builds the index
            assert status0 == 200, status0
            build = vector_index.last_build_seconds
            reads_before = w.chunk_reads
            lat = []
            for _ in range(questions):
                ms, status, _ = await w.ask("u1", w.question())
                assert status == 200, status
                lat.append(ms)
            out[str(n)] = {
                "latencyMs": stats(lat),
                "firstQuestionMs": round(ms0, 1),
                "indexBuildSeconds": round(build, 2),
                "chunkReadsPerQuestion": (w.chunk_reads - reads_before) / questions,
                "indexedChunks": vector_index.size,
            }
        finally:
            await w.close()
    return out


# ------------------------------------------------------------------ scenario 2: concurrent users

async def scenario_concurrency(levels, llm_latency, rounds):
    out = {}
    w = World(llm_latency)
    try:
        w.add_corpus(2000)
        await w.ask("warm", w.question())
        for users in levels:
            # distinct questions: every one reaches the model
            async def user(i, same=None):
                res = []
                for _ in range(rounds):
                    res.append(await w.ask(f"user{i}", same or w.question()))
                return res
            for phase, same in (("distinct", None), ("sameQuestion", f"What is the late fee for tuition, group {users}?")):
                t0 = time.perf_counter()
                calls0 = w.gemini.calls
                results = [r for batch in await asyncio.gather(*(user(i, same) for i in range(users))) for r in batch]
                wall = time.perf_counter() - t0
                lat = [r[0] for r in results]
                out.setdefault(str(users), {})[phase] = {
                    "latencyMs": stats(lat),
                    "errors": sum(1 for r in results if r[1] != 200),
                    "requestsPerSecond": round(len(results) / wall, 1),
                    "modelCalls": w.gemini.calls - calls0,
                }
    finally:
        await w.close()
    return out


# ------------------------------------------------------------------ scenarios 3 and 4: ingestion

def make_pdf(pages, image_every=5):
    import fitz
    from PIL import Image
    import io
    rng = np.random.default_rng(3)
    doc = fitz.open()
    for p in range(pages):
        page = doc.new_page()
        text = (f"Section {p + 1}. " + "Tuition fees for each semester must be paid before the due date and late payments "
                "attract a fine as described in the policy. " * 6)
        page.insert_textbox(fitz.Rect(40, 40, 550, 500), text, fontsize=10)
        if image_every and p % image_every == 0:
            arr = (rng.random((300, 400, 3)) * 255).astype("uint8")
            buf = io.BytesIO()
            Image.fromarray(arr).save(buf, format="PNG")
            page.insert_image(fitz.Rect(60, 520, 360, 745), stream=buf.getvalue())
    return doc.tobytes()


async def scenario_ingestion(pages, query_seconds_cap=240):
    w = World(0.05)
    out = {}
    try:
        w.add_corpus(2000)
        await w.ask("warm", w.question())
        # baseline: queries while nothing else is happening
        base = [(await w.ask("u", w.question()))[0] for _ in range(12)]

        pdf = make_pdf(pages)
        real_download = ingestion.download_pdf

        async def fake_download(url):
            return pdf
        ingestion.download_pdf = fake_download
        w.db.collection("documents").document("big").set(
            {"name": "Big handbook", "status": "Processing", "fileUrl": f"https://{Config.ALLOWED_FILE_HOSTS[0]}/x.pdf"})
        rss_before = peak_rss_mb()
        stop, lat, errors = asyncio.Event(), [], 0
        monitor = asyncio.create_task(loop_lag_monitor(stop))
        t0 = time.perf_counter()
        ingestion.ingestion_manager.start("big")

        async def asker():
            nonlocal errors
            while not stop.is_set() and time.perf_counter() - t0 < query_seconds_cap:
                ms, status, _ = await w.ask("u", w.question())
                lat.append(ms)
                errors += status != 200
        askers = [asyncio.create_task(asker()) for _ in range(3)]
        await ingestion.ingestion_manager.wait_idle()
        ingest_seconds = time.perf_counter() - t0
        stop.set()
        await asyncio.gather(*askers)
        lag = await monitor
        ingestion.download_pdf = real_download
        record = w.db.collection("documents").docs["big"]
        out["queryDuringIngest"] = {
            "baselineLatencyMs": stats(base),
            "duringIngestLatencyMs": stats(lat),
            "errors": errors,
            "p95Slowdown": round(pct(lat, 95) / max(pct(base, 95), 1), 1) if lat else None,
            "eventLoopLagMs": lag,
        }
        out["ingestion"] = {
            "pages": pages, "status": record.get("status"), "chunks": record.get("chunksCount"),
            "seconds": round(ingest_seconds, 1), "pagesPerMinute": round(pages / ingest_seconds * 60, 1),
            "peakRssMB": peak_rss_mb(), "peakRssBeforeMB": rss_before,
        }
    finally:
        await w.close()
    return out


# ------------------------------------------------------------------ scenario 5: cold start

def scenario_cold_start():
    """Time to import the app and run its startup, in a fresh process (models load from the local cache)."""
    code = (
        "import sys,time,types;t=time.time();sys.path.insert(0,%r);import _env;"
        "m=types.ModuleType('langchain_google_genai');m.ChatGoogleGenerativeAI=lambda **k:None;sys.modules['langchain_google_genai']=m;"
        "from config import Config;"
        "[setattr(Config,n,'x') for n in ('FIREBASE_PROJECT_ID','FIREBASE_PRIVATE_KEY','FIREBASE_CLIENT_EMAIL','GOOGLE_API_KEY')];"
        "import main;from fastapi.testclient import TestClient;"
        "c=TestClient(main.app);c.__enter__();r=c.get('/healthz');c.__exit__(None,None,None);"
        "print('COLD',round(time.time()-t,2),r.status_code)" % TESTS)
    env = dict(os.environ, PYTHONPATH=BACKEND_PY, PYTHONUTF8="1")
    runs = []
    for _ in range(2):          # the second run has warm OS file caches: report both
        p = subprocess.run([sys.executable, "-I", "-X", "utf8", "-c", code], capture_output=True, text=True, encoding="utf-8", errors="replace", cwd=BACKEND_PY, env=env, timeout=600)
        line = next((l for l in p.stdout.splitlines() if l.startswith("COLD")), None)
        if not line:
            raise RuntimeError("cold start run failed:\n" + p.stdout[-500:] + p.stderr[-800:])
        runs.append(float(line.split()[1]))
    return {"firstRunSeconds": runs[0], "secondRunSeconds": runs[1]}


# ------------------------------------------------------------------ budgets and reporting

def main_cli():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", default="chunks,concurrency,ingestion,coldstart")
    ap.add_argument("--quick", action="store_true", help="tiny sizes, to check that the harness itself works")
    ap.add_argument("--out", default=os.path.join(HERE, "results"))
    ap.add_argument("--check-budgets", action="store_true")
    ap.add_argument("--budgets", default=os.path.join(HERE, "budgets.json"))
    args = ap.parse_args()
    which = set(args.only.split(","))
    q = args.quick

    report = {"meta": {
        "date": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "commit": (subprocess.run(["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True, cwd=ROOT).stdout.strip() or None),
        "machine": {"python": platform.python_version(), "os": platform.platform(), "cpus": os.cpu_count()},
        "quick": q, "note": "fake Firestore and fake Gemini (see loadtests/README.md)",
    }}

    with open(os.devnull, "w") as quiet_out:
        real_stdout = sys.stdout
        # The first questions after a start are slower (lazy model set-up); keep that out of the numbers
        sys.stdout = quiet_out
        try:
            for i in range(6):
                embedding_service.embed_query(f"warm up question {i} about fees")
            embedding_service.embed_image_query("warm up")
        finally:
            sys.stdout = real_stdout

        def noisy(name, make):
            print(f"== {name} ...", flush=True)
            t = time.time()
            sys.stdout = quiet_out          # the app prints a lot per request
            try:
                return make()
            finally:
                sys.stdout = real_stdout
                print(f"   done in {time.time() - t:.0f}s", flush=True)
        if "chunks" in which:
            report["chunks"] = noisy("1 chunk count", lambda: asyncio.run(scenario_chunks([300, 1000] if q else [1000, 10000, 50000], 5 if q else 30)))
        if "concurrency" in which:
            report["concurrency"] = noisy("2 concurrent users", lambda: asyncio.run(scenario_concurrency([1, 3] if q else [1, 10, 50], 0.05 if q else 0.3, 1 if q else 2)))
        if "ingestion" in which:
            report.update(noisy("3+4 ingestion", lambda: asyncio.run(scenario_ingestion(6 if q else 60, 60 if q else 240))))
        if "coldstart" in which and not q:
            report["coldStart"] = noisy("5 cold start", scenario_cold_start)

    os.makedirs(args.out, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S", time.gmtime())
    name = f"{stamp}-{report['meta']['commit'] or 'nogit'}{'-quick' if q else ''}.json"
    with open(os.path.join(args.out, name), "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
    if not q:
        with open(os.path.join(args.out, "history.jsonl"), "a", encoding="utf-8") as f:
            f.write(json.dumps({"date": report["meta"]["date"], "commit": report["meta"]["commit"], "summary": summarise(report)}) + "\n")
    print(json.dumps(summarise(report), indent=2))
    print(f"\nfull report: {os.path.join(args.out, name)}")

    if args.check_budgets:
        with open(args.budgets, encoding="utf-8") as f:
            budgets = json.load(f)
        ok, lines = check_budgets(report, budgets, strict=which >= {"chunks", "concurrency", "ingestion", "coldstart"} and not q)
        print("\nBudgets:\n" + "\n".join(lines))
        return 0 if ok else 3
    return 0


def summarise(report):
    s = {}
    for n, v in (report.get("chunks") or {}).items():
        s[f"chunks_{n}"] = {"p95Ms": v["latencyMs"]["p95"], "readsPerQ": v["chunkReadsPerQuestion"], "buildS": v["indexBuildSeconds"]}
    for u, v in (report.get("concurrency") or {}).items():
        s[f"users_{u}"] = {"distinctP95Ms": v["distinct"]["latencyMs"]["p95"], "sameP95Ms": v["sameQuestion"]["latencyMs"]["p95"],
                           "errors": v["distinct"]["errors"] + v["sameQuestion"]["errors"]}
    if "queryDuringIngest" in report:
        d = report["queryDuringIngest"]
        s["duringIngest"] = {"p95Ms": d["duringIngestLatencyMs"]["p95"], "baselineP95Ms": d["baselineLatencyMs"]["p95"],
                             "loopLagMaxMs": d["eventLoopLagMs"]["max"], "errors": d["errors"]}
        s["ingestion"] = {k: report["ingestion"][k] for k in ("pagesPerMinute", "peakRssMB")}
    if "coldStart" in report:
        s["coldStart"] = report["coldStart"]
    return s


if __name__ == "__main__":
    sys.exit(main_cli())
