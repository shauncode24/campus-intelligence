# Load tests

Five scenarios from the audit (section 3F), runnable on any machine with the backend's Python
environment. **No credentials, no network and no Gemini quota are used.**

```
python loadtests/run.py                          # everything (several minutes, ~1.5 GB RAM)
python loadtests/run.py --only chunks,concurrency
python loadtests/run.py --quick                  # tiny sizes: only checks that the harness works
python loadtests/run.py --check-budgets          # exit code 3 if a budget in budgets.json is broken
```

(From the repo root, with `backend\python`'s virtual environment, e.g.
`backend\venv\Scripts\python.exe loadtests\run.py`.)

## What it measures, and what it does not

| It IS | It is NOT |
|---|---|
| the real FastAPI app, real embedding models, real in-memory vector index, real answer cache, real rate-limit and budget code, real PDF parsing and the real ingestion job manager | real Firestore (an in-memory fake), real Gemini (a fake with a set delay), the network, or your production host |
| good for **catching regressions between runs on the same machine**, and for showing *shape* (does latency stay flat as the corpus grows? does a big upload freeze the service?) | a forecast of production latency or cost: absolute numbers depend on your CPU |

So: treat a budget failure as "something got slower or started blocking", not "production will be
this slow". A first real measurement needs the deployed service, real Firestore and real Gemini
(see "Next step" below).

## The scenarios

1. **`chunks`: question latency vs corpus size** (1k, 10k, 50k passages): p50/p95/p99 end to end, the
   one-off index build time, and **Firestore chunk reads per question** (must be 0 after the build).
   Passage vectors come from a shared pool of random vectors to keep 50k passages in memory.
2. **`concurrency`: 1 / 10 / 50 users at once**, each asking distinct questions (every one reaches the
   model, fake delay 0.3 s) and then all asking the same question (cache path): latency percentiles,
   errors, requests per second, model calls. Rate limits are switched off for the test.
3. **`queryDuringIngest`: questions while a 60-page PDF is being processed**: latency against a
   quiet baseline, and the **longest time the event loop was blocked** (a ticker that should wake
   every 10 ms). This is the check that a big upload does not freeze the service.
4. **`ingestion`: throughput**: pages per minute and peak memory for a 60-page PDF with an image
   every fifth page (image captioning off: it would call Gemini).
5. **`coldStart`: seconds from a fresh process to a working `/healthz`** (imports, model loading
   from the local cache). The container's own start (image pull, first model download) is **not**
   included.

## Budgets and tracking over time

* `budgets.json`: limits on numbers in the report (dotted paths, `max` or `min`). They are set
  **generously** (about 2.5x what this suite measured on the machine named in the file) so normal
  machine noise does not fail them; they catch *order-of-magnitude* regressions: Firestore reads
  coming back, the event loop blocking again, errors under load. Tighten them when you have a
  stable CI machine's history. A budget whose value is missing from a full run **fails** (a
  scenario that silently stopped must not look like a pass).
* Each full run appends one summary line to `results/history.jsonl` (commit it to keep a history);
  the full per-run JSON reports stay local (git-ignored). The nightly workflow
  (`.github/workflows/loadtest.yml`) runs the suite, checks the budgets and uploads the report as an
  artifact; it does not commit anything.

## Next step (needs you)

Run the same shapes against the deployed service with real Gemini, using k6 or Locust against
`/query/stream`: use a dedicated test account and a small, spend-capped Gemini key, because every
distinct question is a paid call. Record p50/p95/p99, error rate, Gemini cost per question (from
`GET /admin/metrics`) and memory on the real host.
