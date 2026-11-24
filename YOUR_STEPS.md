# Your steps: everything only you can do (P0-1 to P1-5)

Living checklist. Claude updates it after every roadmap item. It assumes **nothing is done yet**.
Do the sections **in order**: later ones depend on earlier ones. Commands are for **Windows PowerShell**
unless marked otherwise. `<angle brackets>` are values you fill in.

**Last updated:** after P2-6 and its identical-questions follow-up.  **Covers:** P0-1 … P0-9, P1-1 (partly), P1-2, P1-3, P1-4, P1-5, P1-6, P1-7, P1-8, P1-9, P1-10, P1-11, P1-12, P2-1, P2-2, P2-3, P2-4, P2-5, P2-6.

Legend: ☐ = to do. ⚠️ = skipping it breaks something. 💸 = costs Gemini quota. 🔒 = security.

---

## 0. Commit the work (nothing has been committed by Claude)

Each item gave you a commit message. If you have not committed one, check what is pending:

```powershell
cd C:\Users\Shaun\OneDrive\Desktop\Projects\Hackathons\Campus_Intelligence
git status --short
git log --oneline -8
```

The last commit you should see is the P1-12 one ("Make the chat honest and useful…"). P2-2 is uncommitted (P2-1 should already be committed).
Message for the identical-questions follow-up (P2-6):

```
Share one model call between identical questions asked at the same moment

When several users ask the same new question at once, the first becomes the leader and the others
wait and reuse its cached answer (10 users: 1 call instead of 10). Keyed on question and corpus
epoch; refusals are shared, a failed or stopped leader is replaced, waiters time out after 120 s.
SINGLE_FLIGHT=false turns it off.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

Message for P2-6:

```
Add load tests with performance budgets and a nightly run (P2-6)

loadtests/run.py drives the real app, models, index and ingestion with a fake Firestore and a
fake Gemini: latency vs corpus size, concurrent users, questions during a PDF upload, ingestion
throughput and memory, cold start. budgets.json fails the nightly workflow on order-of-magnitude
regressions. Findings recorded in AUDIT.md.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

Message for P2-5:

```
Add request ids, structured logs, per-stage timing, token and cost tracking, and /admin/metrics (P2-5)

Every request gets an id carried across the Node API and the RAG service; one JSON log line per
request and per question (stages, time to first word, tokens, estimated cost, outcome) with no
question text or raw user ids; GET /admin/metrics summarises the last questions.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

Message for P2-4:

```
Remove duplicate and dead backend code, document every route, keep the doc honest with tests (P2-4)

Drops the /api/documents alias, Node /history, validate-metadata, unused models and 8 unused Node
packages (and applies in-range security updates: no high or critical advisories left in the Node
runtime dependencies). API.md lists every route; tests fail if it drifts. Fixes the auth-matrix
test, which was silently skipping the chat and feedback routes.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

Message for P2-3:

```
Stream answers from Gemini to the browser as they are generated; Stop really stops (P2-3)

New /query/stream on the RAG service sends text pieces as the model produces them; Node relays them
without the artificial per-word delay and cancels the upstream call when the browser leaves. A
refusal is never flashed; a stopped answer saves what the user saw, flagged stopped, and is never
cached. Completed answers are saved and cached as before.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

Message for P2-2:

```
Add hybrid-search and reranker experiments to the eval harness, with a harder question set (P2-2)

Measured on synthetic data: both nudge hit rate and MRR up but within the noise, so nothing
changes in production. Run them on the real golden set before deciding.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

Message for P2-1:

```
Search from an in-memory vector index instead of scanning every chunk per question (P2-1)

Chunks are read from Firestore once and kept as numpy matrices; a question is one matrix
product. The index follows the corpus epoch, so new, replaced or reindexed documents are picked
up, and documents that are deleted or expired are excluded per question as before. Over
VECTOR_INDEX_MAX_CHUNKS it falls back to the old scan and logs it. Sources read each document once.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

Message for P1-12 (if you have not committed it yet):

```
Make the chat honest and useful: markdown, linked sources, stop/try again, feedback (P1-12)

Answers render as safe markdown with citations linked to the cited PDF page; all sources are
listed with working page links; refusals, reused answers and errors are shown as such; Stop and
Try again (fresh answer); thumbs up/down saved with the question, answer and exact passages.
Adds react-markdown, a feedback API and export script, fixes unclickable source links.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

Message for P1-11 (if you have not committed it yet):

```
Add CI: tests, lint gate, Docker build, secret and dependency scans (P1-11)

GitHub Actions run the Python and Node API tests (emulator), rules tests, a frontend lint gate
that blocks new errors, the Docker image build and health check, gitleaks, pip-audit and npm
audit. Node API tests move into the repo; adds a route-by-route auth/ownership test for the
Python API. Fixes a missing toast import, removes a dead function, updates frontend lockfile
(2 critical and 3 high advisories).

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

Message for P1-10 (if you have not committed it yet):

```
Make the Python build reproducible: pinned dependencies, working Dockerfile (P1-10)

requirements.txt now pins every package to the tested set (generated from requirements.in);
the image runs as non-root with a healthcheck, bakes in the embedding models and keeps secrets
out. Verified by building the image and running the whole suite inside it. Also makes the
"new version replaces old" step atomic (both versions could answer for a moment).

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

Message for P1-9 (if you have not committed it yet):

```
Fix the admin pages and make upload duplicate detection work (P1-9)

Document Management: no more crashes, a colour per status, search/filter/paging, cancel,
auto-refresh while processing, confirmation dialogs. Upload: files keyed by name+size+date,
debounced duplicate check on fresh data, exact-duplicate detection by SHA-256, PDF/size/count
validation with reasons, retry that does not duplicate.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

Message for P1-8 (if you have not committed it yet):

```
Rework the answer cache: exact-match reuse, invalidated by document changes (P1-8)

Measured on labelled pairs that no similarity threshold separates paraphrases from
near-duplicates, so only identical questions reuse an answer. Entries are tied to a corpus
epoch (bumped on process/replace/delete/reindex) and expire after 30 days. Entity and
intent rules rewritten with whole-word matching; calibration tool and purge script added.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

Message for P1-7 (if you have not committed it yet):

```
Make document versions, effective dates and expiry decide what answers (P1-7)

A document answers only if processed, not superseded, in force and not expired.
"Replaces older document" upload flow retires the old version once the new one is
processed; stale cached answers are skipped; optional department/type filters;
version and date shown to the model and in sources.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

Message for P1-6:

```
Process documents in the background; keep the service responsive (P1-6)

Upload/reprocess return 202 and a job reports real progress on the document;
cancel/delete stop it; interrupted jobs are failed at start-up. Blocking Firestore,
model and PDF work moved off the event loop. Removes the dead bulk route.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

(For reference, the P1-5 message was:)

```
Save chats on the server in one atomic write; fix Save and long chats (P1-5)

/query now stores the question, answer, history entry and chat counters in one
batch; the browser no longer writes. Save works and persists, reloads match the
live view, long chats show the newest messages, follow-up context is read
server-side. Adds Firestore indexes.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

```powershell
git add -A
git commit      # paste the message above
```

Do **not** `git add` any `.env` file (they are ignored now; `git status` must not list them).

---

## 1. Install the tools (once)

| Tool | Why | Check |
|---|---|---|
| Node.js 20+ (you have 24) | Node API, frontend, scripts | `node --version` |
| Python 3.11–3.14 (you have 3.14) | RAG service | `python --version` |
| Java 17+ | only for the Firestore rules tests (section 9) | `java -version` |
| Firebase CLI | deploying rules/indexes | `npm install -g firebase-tools` then `firebase --version` |
| Git | already | `git --version` |

---

## 2. Install the project's dependencies

### 2.1 Node API (P0-7 added two packages)

```powershell
cd C:\Users\Shaun\OneDrive\Desktop\Projects\Hackathons\Campus_Intelligence\backend
npm install
```

### 2.2 Frontend

```powershell
cd ..\frontend
npm install
```

### 2.3 Python RAG service ⚠️

`backend\python\requirements.txt` is now a **pinned, tested set** (P1-10): every package at the exact version the
tests ran against, with CPU-only PyTorch. Your existing `backend\venv` has different versions and is missing
packages, so make a fresh one. In PowerShell:

```powershell
cd C:\Users\Shaun\OneDrive\Desktop\Projects\Hackathons\Campus_Intelligence\backend
Rename-Item venv venv-old          # keep it until the new one works, then delete venv-old
python -m venv venv
.\venv\Scripts\python.exe -m pip install --upgrade pip
.\venv\Scripts\python.exe -m pip install -r python\requirements.txt
.\venv\Scripts\python.exe -m pip check
```

The install takes several minutes and downloads about 1 GB. `pip check` should say "No broken requirements found".
Needs Python 3.14 (what the tests ran on; `python --version`). If you only have 3.12/3.13 it will probably work but is
untested: tell Claude. The first start downloads two small models from Hugging Face (bge-small and CLIP); you need
internet once. To change a dependency: edit `backend\python\requirements.in` and regenerate `requirements.txt`
(the commands are in that file's header).

### 2.3b Node API dependencies for the tests (P1-11)

`npm --prefix backend ci --ignore-scripts` (the `--ignore-scripts` skips native builds nothing uses). This is also
what CI runs.

### 2.4 Docker image (optional, for deploying the Python service)

Needs Docker Desktop running. The image is about 4.6 GB (PyTorch and the two models are baked in).

```powershell
cd C:\Users\Shaun\OneDrive\Desktop\Projects\Hackathons\Campus_Intelligence
docker build -t campus-rag backend\python
# run it with your secrets passed in at run time (they are never copied into the image):
docker run --rm -p 8000:8000 --env-file C:\Users\Shaun\secrets\campus-intel.env campus-rag
# in another terminal:
curl http://localhost:8000/healthz         # {"status":"ok"}
docker ps                                  # STATUS shows (healthy) after about 30-120 s
```

`--env-file` takes `NAME=value` lines without quotes around multi-line values: if your Firebase private key breaks it,
set `FIREBASE_PRIVATE_KEY` another way (your host's secret manager). Hosts that assign a port (Render) set `PORT`; the
image honours it.

---

## 3. Secrets and configuration

### 3.1 Move secrets out of OneDrive 🔒 (P0-9)

`backend\.env` holds your Firebase private key, Google OAuth secret and Gemini key, and OneDrive is syncing it
to Microsoft's cloud.

```powershell
mkdir C:\Users\Shaun\secrets
Move-Item C:\Users\Shaun\OneDrive\Desktop\Projects\Hackathons\Campus_Intelligence\backend\.env C:\Users\Shaun\secrets\campus-intel.env
# make Windows remember where it is (new terminals only):
[Environment]::SetEnvironmentVariable("ENV_FILE", "C:\Users\Shaun\secrets\campus-intel.env", "User")
```

Close and reopen PowerShell/VS Code, then `echo $env:ENV_FILE` should print the path. Delete
`backend\.env.production` after copying anything you still need from it into the new file.
If both services refuse to start with "ENV_FILE … not readable", the path is wrong (that is intended).

If you ever shared this folder or your OneDrive with anyone, **rotate**: Firebase console → Project settings →
Service accounts → generate new key; Google Cloud → APIs & Services → Credentials → reset the OAuth client
secret; Google AI Studio → create a new Gemini key. (A scan of all git history found no committed secrets, so
no rotation is needed for git reasons.)

### 3.2 Fill in the env file (`C:\Users\Shaun\secrets\campus-intel.env`)

Use `backend\.env.example` as the full list of names. Required: `GOOGLE_API_KEY`, `FIREBASE_*` (project id,
private key, client email, …), `GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI` (calendar), `FRONTEND_URL`,
`PYTHON_RAG_URL`, `PORT`. New ones you should set:

| Variable | Value | Why |
|---|---|---|
| `FRONTEND_URL` | exactly your site's origin, e.g. `http://localhost:5173` in dev | CORS (P0-7) ⚠️ |
| `TRUST_PROXY` | `1` **only** if Node/Python run behind a proxy/host such as Render | otherwise all users share one IP limit (P0-7) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project settings → API → `service_role` (**secret**) | lets "delete document" remove the PDF too (P0-6). Optional |
| `ALLOWED_FILE_HOSTS` | your Supabase host, if it is not `qqdonjhgvuyjfusplexf.supabase.co` | PDF download allow-list (P0-3) |

Everything else is optional with sensible defaults (rate limits, LLM budgets, `EMBEDDING_BACKEND`,
`IMAGE_CAPTIONING`, `QUERY_CONDENSING`, `MAX_CONCURRENT_INGESTS`, …). They are documented in `backend\.env.example`.

💸 To avoid Gemini calls while testing uploads, put `IMAGE_CAPTIONING=false` in the env file for now.

### 3.3 Frontend env

```powershell
cd C:\Users\Shaun\OneDrive\Desktop\Projects\Hackathons\Campus_Intelligence\frontend
copy .env.example .env      # skip if .env already exists
```

Edit `.env`: `VITE_API_BASE_URL=http://localhost:5000` and `VITE_PYTHON_RAG_URL=http://localhost:8000`
(production: your deployed URLs, in `.env.production`). Nothing secret goes in here.

---

## 4. Firebase / Google console settings (only you can click these)

1. ⚠️ **Enable anonymous sign-in** (P0-1): Firebase console → Authentication → Sign-in method → Anonymous →
   Enable. Without it guests get no identity and chat fails.
2. **Email/password sign-in** must stay enabled (students/admins).
3. Optional, recommended later (P0-7 limits): turn on **Firebase App Check**; anonymous accounts can still be
   created in bulk.

## 5. Deploy Firestore rules and indexes ⚠️

```powershell
cd C:\Users\Shaun\OneDrive\Desktop\Projects\Hackathons\Campus_Intelligence
firebase login
firebase deploy --only firestore:rules --project campus-intel-7e594
firebase deploy --only firestore:indexes --project campus-intel-7e594
```

- **Rules (P0-2):** until deployed, the live project keeps its old rules (browser can still write roles,
  documents, etc.). You can read the rules in `firestore.rules`.
- **Indexes (P1-5):** without them, opening a chat or the History page fails. Index builds take a few
  minutes: Firebase console → Firestore → Indexes: wait until all four show "Enabled".
- If the CLI says "No currently active project", keep `--project campus-intel-7e594`. If it says 401, run
  `firebase login --reauth`.

## 6. Make yourself an admin (P0-2)

Admin is a Firebase **custom claim**, only grantable from the server. The account must already exist
(sign up once in the app with that email).

```powershell
cd C:\Users\Shaun\OneDrive\Desktop\Projects\Hackathons\Campus_Intelligence\backend
node scripts/setAdminClaim.js <admin-email>
```

Then **sign out and sign in again** in the app (the claim lives in the login token). Repeat per admin.
Remove with `node scripts/setAdminClaim.js <email> --revoke`.

---

## 7. Start everything (three terminals)

Terminal A: Python RAG service

```powershell
cd C:\Users\Shaun\OneDrive\Desktop\Projects\Hackathons\Campus_Intelligence\backend\python
..\venv\Scripts\python.exe main.py
```
Wait for "Embedding models loaded" and "Gemini initialized". Listens on port 8000.

Terminal B: Node API

```powershell
cd C:\Users\Shaun\OneDrive\Desktop\Projects\Hackathons\Campus_Intelligence\backend
npm start
```
Port 5000 (`PORT`).

Terminal C: frontend

```powershell
cd C:\Users\Shaun\OneDrive\Desktop\Projects\Hackathons\Campus_Intelligence\frontend
npm run dev
```

---

## 8. Re-index every document ⚠️ (P1-2 / P1-3): must be done once

Retrieval now ignores vectors made by the old model. **Until each document is re-processed, every question
answers "not found".** Needs: Python deps installed (2.3), env file (3.2), internet for the model download.

```powershell
cd C:\Users\Shaun\OneDrive\Desktop\Projects\Hackathons\Campus_Intelligence\backend\python
# 1) see what it would do (no changes, no Gemini calls)
..\venv\Scripts\python.exe scripts\reindex_all.py --dry-run
# 2) do it
..\venv\Scripts\python.exe scripts\reindex_all.py
# or one document:  ... scripts\reindex_all.py --only <documentId>
```

- 💸 With `IMAGE_CAPTIONING` on (default) every qualifying image in every document costs **one Gemini call**
  (at most 30 per document). Count your images first, or set `IMAGE_CAPTIONING=false` to re-index for free
  (images then fall back to CLIP vectors and can be captioned on a later re-run).
- A document is hidden from answers while it is re-processed. If one fails it is marked `Error` and the
  script continues; read the summary at the end and fix/re-run those with `--only`.
- Existing document records whose file URL is not in the Supabase `documents` bucket fail with a 400 (P0-3):
  re-upload those.
- Documents with no `status` field are invisible to answers (P0-6). The script sets it when it succeeds.

## 9. Run the automated tests (optional but recommended; confirms your machine is set up)

```powershell
cd C:\Users\Shaun\OneDrive\Desktop\Projects\Hackathons\Campus_Intelligence
# Python service tests (expected: all pass, 1 skipped)
cd backend\python
..\venv\Scripts\python.exe -m unittest discover -s tests
# Retrieval-evaluation harness tests
cd ..\..
backend\venv\Scripts\python.exe -m unittest discover -s eval\tests
# Firestore rules tests (needs Java 17+ and the firestore-tests dependencies)
cd firestore-tests; npm install; cd ..
npm --prefix firestore-tests test
# Frontend tests and the lint gate
cd frontend; npm test; npm run lint:ci; cd ..
# Node API tests against the Firestore emulator (needs Java; 11 files, ~300 checks)
npm --prefix backend ci --ignore-scripts
npm --prefix firestore-tests run test:api
# Frontend production build
cd frontend; npm run build
```

Claude's own run: backend 117 passing (1 skipped by design), harness 50, 23 rules tests, build OK. Node API
suites were throwaway scripts and are not in the repo.

## 10. Smoke test in a browser (nothing below was ever tried with real Firebase/Gemini)

Do these once, in order. Anything that fails: tell Claude exactly what you saw.

1. **Guest chat:** open the site without logging in → start a chat → ask a question about a document → you get an
   answer with sources (document name + page). (P0-1, P1-2)
2. **Reload the page / reopen the chat:** the same messages and sources appear. (P1-5)
3. **Save:** click Save on the answer → "Saved!"; it appears on the Saved page; reload the chat and it is still marked saved. (P1-5)
4. **Not-in-documents question** (e.g. "what is the parking fee?" if no document covers it): you get the standard "couldn't find" answer, no sources. (P0-5)
5. **Follow-up:** ask "what is the late fee?" then "and the maximum?" → under the answer: *Understood as: "…"*. (P1-4) 💸 one extra Gemini call
6. **Admin login** with the account from section 6: `/admin` works; a normal account gets rejected. (P0-2)
7. **Upload a PDF** with a figure/table (admin): processing finishes; ask a question answered only by the figure. (P1-3) 💸
8. **Delete a document** (admin): then confirm the PDF file disappears from the Supabase bucket (needs the service key from 3.2) and the document no longer answers. (P0-6)
9. **FAQ:** the public FAQ page is **empty** until an admin adds entries at `/admin/faq` and publishes them. (P0-8)
10. **Rate limit:** send 11 questions within a minute → a friendly "too quickly" message. (P0-7)
11. **Background upload (P1-6):** upload a multi-page PDF as admin → the progress bar moves with real percentages
    and messages ("Reading page 3 of 12"), not in fixed jumps; the page does not freeze. While it runs, ask a
    question in another tab: it must still answer promptly.
12. **Queue:** upload two PDFs at once → the second shows "Waiting for other documents to finish" until the first ends.
13. **Failure:** upload a file that is not a real PDF (rename a .txt) → it ends as Error with a readable message, not stuck.
14. **Restart safety:** start an upload, stop the Python service mid-way, start it again → the document shows `Error`
    ("interrupted because the service restarted"); Reprocess fixes it.
15. **Reprocess (Documents page):** shows "Reprocessing started"; refresh after a moment → Processed again.
16. **Versions (P1-7):** upload "Test Policy" (say it states a fee of Rs. 100), ask about the fee → cites it. Upload
    a second file with the same name, choose the first under "Replaces an older document" (state a fee of Rs. 200).
    While it processes the old one still answers; when done, ask again → answer says Rs. 200, source card shows the new
    version; the Documents page marks the old one "Replaced by a newer version"; the public library no longer lists it.
17. **Undo:** delete the new version in the admin list → the old one answers again and shows in the library.
19. **Cache (P1-8):** ask a question, then the same question again with different capitals/punctuation → the second is
    instant and the Gemini call count does not rise. Ask a reworded version → a fresh answer (expected: paraphrases are no longer reused).
20. **Invalidation:** after step 19, upload or delete any document, then repeat the question → a fresh answer (not the cached one).
21. **Admin list (P1-9):** open the Documents page → colours differ per status; search and the status filter work; an
    Error row shows its message; start a reprocess → the row shows a percentage and updates by itself; the ✕ cancels it.
22. **Duplicates (P1-9):** upload a PDF; then select the same PDF again and fill any name → a warning "This exact file is
    already uploaded" appears after a short pause (not on every keystroke). Select a `.docx` or a 60 MB file → a message says why it was refused.
23. **Retry (P1-9):** stop the Python service, upload a PDF (it fails), start Python, click "Retry the 1 failed" → it
    completes and the Documents page shows ONE record for it.
25. **Formatting and sources (P1-12):** ask a question whose answer has a list or bold text → it shows as real formatting,
    not `**`. Under the answer, **Sources (N)** lists every source; click "Open page N" → the PDF opens at that page. Click a
    citation like `[Fee Policy, p. 2]` inside the answer (when it is underlined) → same.
26. **Not found / reused (P1-12):** ask something the documents do not cover → a yellow "not found" bubble, no Save button.
    Ask the exact same question again from another chat → it says "Reused answer, first generated …".
27. **Try again and Stop (P1-12):** click ↻ on the latest answer → a fresh answer appears (the chat shows "Asked again for a
    fresh answer"); click **Stop** while one is arriving → it stops, with a "Stopped" note; reload the chat → the full answer is there.
28. **Feedback (P1-12):** click 👎 on an answer, pick a reason, Send. Reload → the 👎 is still marked. In the Firebase console →
    Firestore → `feedback`: one row with the question, answer, `chunkIds`, `documentIds`, your rating and reason.
24. **Container (P1-10, optional):** after step 2.4, `docker ps` shows the container as `(healthy)` and
    `curl http://localhost:8000/healthz` answers. With real credentials, step 1 (a question with sources) also works against it.
18. **Expiry:** edit a document's `expiryDate` in the Firebase console (Firestore → documents → that doc) to yesterday's
    date (format `2025-01-31`) → questions it alone covered now answer "couldn't find"; set it to a future date → works again.
    (The upload form's own expiry date field does the same; this just avoids waiting.)

---

## 11. Decisions and chores that are yours

- ☐ **The 34 MB `GDG_OnCampus_Video.mp4`** is in git history and on GitHub (P0-9). Options: leave it; or ask Claude
  to prepare a history rewrite (`git filter-repo --path GDG_OnCampus_Video.mp4 --invert-paths` + force push;
  affects every clone, so only with your explicit go-ahead). Do **not** commit the file again (`*.mp4` is ignored).
- ☐ **Put the Python service on a private network / behind Node** when deploying: its chat and history routes are
  called by the browser directly, so it must be reachable by browsers, but nothing else needs to be. `/health` and
  `/faq` are cheap now (no reads / one read a minute) and `/documents/{id}/exists` needs sign-in (fresh P0-4).
- ☐ **Old data:** answers cached or saved before P0-4/P0-5 may contain stale page numbers. Clear the `questions`
  collection (the answer cache) in the Firebase console. Old chats' answers have no Save button (P1-5); old guest
  chats from before P0-1 are unreachable.
- ☐ **Supabase bucket policies (fresh P0-1, REQUIRED):** uploads now use a one-time signed link from the server, so the
  bucket must allow public *read* only. In Supabase → Storage → Policies → bucket `documents`: delete any policy that
  allows INSERT/UPDATE/DELETE for `anon`/`public`. Set a file-size limit (e.g. 50 MB) and allowed type
  `application/pdf` in the bucket settings. Then check: `curl -X POST "https://<ref>.supabase.co/storage/v1/object/documents/x.pdf" -H "apikey: <anon key>" -H "Authorization: Bearer <anon key>" -H "Content-Type: application/pdf" --data-binary @any.pdf` must answer 400/403 (row-level security), and an admin upload in the app must still work.
  **`SUPABASE_SERVICE_ROLE_KEY` must be set in the backend env, or uploads answer 503.**
- ☐ **Tune the limit numbers** (rate limits, daily Gemini budget) after you see real traffic (P0-7).
- ☐ **Counters are per process** (rate limits reset on restart; multiple instances do not share them).
- ☐ **Run exactly one Python instance** (P1-6): the processing queue and the start-up cleanup of interrupted jobs live
  in the process. If you deploy several instances, tell Claude: it needs a durable queue.
- ☐ **Anyone who was mid-upload during a restart** must hit Reprocess (the document is marked Error on start-up).
- ☐ **Fill in versions and dates on your real documents** (P1-7): version, effective date and expiry date only do
  something once they are entered. Documents without dates stay live forever. For each policy that has a newer edition,
  re-upload the new one with "Replaces an older document" (or delete the old one).
- ☐ **Install the new frontend packages** (P1-12): `cd frontend; npm ci` (adds `react-markdown` and `remark-gfm`).
- ☐ **Read the feedback** (P1-12): it accumulates in Firestore → `feedback`. Export it (no user ids) with
  `cd backend\python; ..\venv\Scripts\python.exe scripts\export_feedback.py --out bad.jsonl --only-down`, and read the thumbs-downs:
  "in the documents but not found" ones are retrieval failures; turn them into golden-set questions (`eval\README.md`).
- ☐ **Turn on CI (P1-11): push, then make it required.**
  1. `git push` (the workflow files are in `.github/workflows/`). GitHub → your repo → **Actions** tab: the **CI** run starts.
     Expect it to need one or two small fixes the first time (it has never run on GitHub's machines; I validated the files
     with actionlint and ran every step's command locally, but not the runners themselves). Tell Claude what is red.
  2. Settings → Branches → **Add branch protection rule** for `main` → tick **Require a pull request before merging** and
     **Require status checks to pass**, then select `python`, `node-api`, `frontend`, `docker`, `security`. From then on
     nothing reaches `main` with a red check.
  3. The **security** job uses `gitleaks-action`: free for personal repositories. If the repo moves to a GitHub
     *organisation* it needs a `GITLEAKS_LICENSE` secret (or swap that step for the docker command in the comment).
  4. Settings → Code security → enable **Dependabot alerts** (the weekly update PRs from `.github/dependabot.yml` need nothing).
     Dependabot PRs that change `requirements.txt` directly will fail the "requirements.in and requirements.txt agree" test:
     that is intended, edit `requirements.in` and regenerate (command in `requirements.txt`'s header).
  5. If the **security** job turns red on a day nothing changed, a new advisory was published: read the log, update the package.
- ☐ **Lower the frontend lint baseline as you fix things** (P1-11): `frontend/lint-baseline.json` allows the 32 errors that
  existed. After fixing some, run `cd frontend; node scripts/check-lint-baseline.mjs --update` and commit the file.
- ☐ **Delete `backend\venv-old`** once the new virtual environment works (P1-10). It is thousands of files that OneDrive is
  syncing. Consider keeping the new `venv` outside OneDrive (e.g. `C:\Users\Shaun\venvs\campus`) and using that path in the
  commands in this file.
- ☐ **Old documents have no content fingerprint** (P1-9): exact-duplicate detection only knows files processed from now on.
  To fingerprint existing ones, run `reindex_all.py` (it re-processes everything, which re-captions images: see step 8 and the
  cost note) or reprocess just the documents you care about from the Documents page.
- ☐ **Delete the old cache entries once** (P1-8): from `backend\python`,
  `..\venv\Scripts\python.exe scripts\purge_cache.py --dry-run` then `..\venv\Scripts\python.exe scripts\purge_cache.py`.
  Old entries are never served anyway; this just frees the space. `reindex_all.py` also resets the cache validity.
- ☐ **Dates are UTC** (P1-7): at midnight local time the boundary can be off by up to a day. Tell Claude if you want campus time.

## 12. Real-data work (needs you; this is what makes the numbers real)

- ☐ **Build the real golden set** (P1-1): 50+ answerable and 25+ unanswerable *real* student questions, with
  answers checked against your real PDFs. Instructions: `eval\README.md` → "Building the real golden set".
  Until then, every number Claude reported (bge vs CLIP, follow-up gains) is on invented synthetic data.
- ☐ Then run the baseline on your data (free, local, no Gemini):

  ```powershell
  cd C:\Users\Shaun\OneDrive\Desktop\Projects\Hackathons\Campus_Intelligence
  backend\venv\Scripts\python.exe eval\run_retrieval_eval.py --pages <your pages.jsonl> --questions <your questions.jsonl> --retriever production --embedding-backend bge-small --name real-baseline
  ```
- ☐ 💸 **Check the real follow-up rewriter** (P1-4), only when you are happy to spend a few Gemini calls (one per follow-up question):

  ```powershell
  backend\venv\Scripts\python.exe eval\run_retrieval_eval.py --pages <pages.jsonl> --questions <questions.jsonl> --retriever production --embedding-backend bge-small --followups rewrite --env-file C:\Users\Shaun\secrets\campus-intel.env --yes --name real-rewrite
  ```
- ☐ 💸 Spot-check Gemini's image descriptions on a few real figures (P1-3): look at the stored `image` chunks
  (`content` field) in Firestore → `chunks` for a document you uploaded with captioning on; compare with the figure.
- ☐ Tune with the real set: `MIN_RETRIEVAL_SCORE` (0.50 is provisional), `MIN_IMAGE_SCORE`, answer-cache
  threshold (P1-8).

## 13. Not done by design (for your awareness)

- Calendar OAuth tokens are still stored in plaintext (P2-9).
- No CI yet (P1-11); `gitleaks` / `npm audit` / `pip-audit` not wired.
- `requirements.txt` is stale (T3). No Docker build was tried.
- "Load earlier messages" button is missing in the chat (the API supports it, P1-5).

---

## Change log of this file

- **After fresh-audit P0-1 … P0-4:** commit message given in chat. **Do these, in this order:** (1) put `SUPABASE_SERVICE_ROLE_KEY` in the backend env file (uploads answer 503 without it) and restart Node; (2) in Supabase, remove every anonymous INSERT/UPDATE/DELETE policy on the `documents` bucket and set a size limit and `application/pdf` type (section 11); (3) restart Node and Python (the Python service now trusts `X-Client-IP` from `127.0.0.1`/`::1`; in Docker set `TRUSTED_PROXY_IPS` to the Node container's address); (4) smoke test: upload a PDF as admin, ask a question, open History (sources of deleted documents are still greyed out). Nothing to install except that the project's `backend/venv` was missing the Python packages and I ran `pip install -r backend/python/requirements.txt` in it.
- **After P1-5:** file created; covers P0-1 … P1-5.
- **After the identical-questions fix:** commit message above; nothing to install. Behaviour change you may notice: if several people ask the same new question at the same second, all but one get their answer all at once when the first finishes, instead of streaming.
- **After P2-6:** commit message for P2-6; nothing to install. Optional: run it yourself with `backend\venv\Scripts\python.exe loadtests\run.py --check-budgets` (about 4 minutes, uses ~1.5 GB RAM; do not run other heavy things at the same time, the numbers will be 3-5x worse); commit `loadtests\results\history.jsonl` if you want a history. After pushing to GitHub, run the "Load tests" workflow once by hand (Actions tab) and tell me if a budget fails on the CI machine. **Real load testing is still yours to do:** against the deployed service with real Gemini, using a dedicated test account and a spend-capped key (see `loadtests/README.md`, "Next step").
- **After P2-5:** commit message for P2-5; nothing to install. **Do these:** (1) set the real Gemini prices in your env file (`GEMINI_PRICE_IN_PER_MTOK`, `GEMINI_PRICE_OUT_PER_MTOK`, US dollars per million tokens, from Google's current price page) so the cost figures mean something. (2) After asking a few real questions, open `GET <RAG url>/admin/metrics` with an admin token (browser tools or `curl -H "Authorization: Bearer <admin ID token>"`) and look at `cost.questionsWithoutUsageReport`: it must be 0; if not, tell me. (3) Send the service's stdout somewhere searchable (your host's log viewer is enough to start): each line that starts with `{` is JSON; search `"event":"query_done"`. (4) Suggested alerts once you have a log tool: no `query_done` for 10 minutes during the day; more than 5% of `query_done` with `"outcome":"error"` over 15 minutes; `totalMs` p95 above 15000; estimated daily cost above your budget; any `ingest_failed`. (5) Optional: create a Sentry project and tell me, to wire error tracking (a new account and secret; not done).
- **After P2-4:** commit message for P2-4; run `npm --prefix backend ci --ignore-scripts` again (the dependency list shrank, the lockfile changed); delete the leftover folder `backend	emp` by hand (stale images, git-ignored); if anything of yours still calls `/api/documents/...` or Node `/history`, switch it to `/documents/...` and the RAG service's `/history`; read `API.md` once.
- **After P2-3:** commit message for P2-3; nothing to install; add to smoke test: ask a long question and watch words appear while Gemini is still writing (step 27 again: Stop now cancels the model and the chat shows what you saw); if you put a reverse proxy in front (nginx etc.), make sure it does not buffer responses.
- **After P2-2:** commit message for P2-2; nothing to install for the app. Once you have the real golden set, run `--retriever production`, `hybrid`, `rerank` on it (eval README) and send me the three reports to decide. The reranker downloads ~90 MB the first time.
- **After P2-1:** commit message for P2-1; nothing to install; after re-indexing (section 8) the first question is slower (it builds the index); optional env `VECTOR_INDEX_MAX_CHUNKS` / `VECTOR_INDEX_ENABLED=false`; do not edit chunks by hand in the console (the index follows the epoch).
- **After P1-12:** commit message for P1-12; `npm ci` in frontend (new packages); smoke-test steps 25-28 (formatting, sources, not-found/reused, try again/stop, feedback); read/export the feedback.
- **After P1-11:** commit message for P1-11; push and turn on CI + required checks + Dependabot; new test commands (`npm --prefix firestore-tests run test:api`, `npm test`/`npm run lint:ci` in frontend); frontend lockfile updated (run `npm ci` in `frontend`).
- **After P1-10:** commit message for P1-10; new pinned Python environment (2.3), optional Docker build (2.4), delete the old venv; step 24.
- **After P1-9:** commit message for P1-9; smoke-test steps 21-23 (admin list, duplicates, retry); old documents have no content fingerprint until re-processed.
- **After P1-8:** commit message for P1-8; smoke-test steps 19-20 (exact reuse, invalidation); purge old cache entries; the cache is exact-match only (semantic mode needs your own calibration).
- **After P1-7:** commit message for P1-7; smoke-test steps 16-18 (versions, undo, expiry); chores: enter versions/dates on real documents, replace old editions.
- **After P1-6:** commit message for P1-6; new optional `MAX_CONCURRENT_INGESTS`; smoke-test steps 11-15 (background upload, queue, failure, restart, reprocess); single-instance requirement.
