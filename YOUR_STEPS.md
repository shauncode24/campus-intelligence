# Your steps: everything only you can do (P0-1 to P1-5)

Living checklist. Claude updates it after every roadmap item. It assumes **nothing is done yet**.
Do the sections **in order**: later ones depend on earlier ones. Commands are for **Windows PowerShell**
unless marked otherwise. `<angle brackets>` are values you fill in.

**Last updated:** after P1-8.  **Covers:** P0-1 … P0-9, P1-1 (partly), P1-2, P1-3, P1-4, P1-5, P1-6, P1-7, P1-8.

Legend: ☐ = to do. ⚠️ = skipping it breaks something. 💸 = costs Gemini quota. 🔒 = security.

---

## 0. Commit the work (nothing has been committed by Claude)

Each item gave you a commit message. If you have not committed one, check what is pending:

```powershell
cd C:\Users\Shaun\OneDrive\Desktop\Projects\Hackathons\Campus_Intelligence
git status --short
git log --oneline -8
```

The last commit you should see is the P1-7 one ("Make document versions…"). P1-8's changes are
uncommitted. Message for it:

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

`backend\python\requirements.txt` is **stale** (it pins versions from 2023 that do not match the code; audit
item T3, not fixed yet). The code was tested with the versions below. Your existing `backend\venv` is
missing several packages. In PowerShell:

```powershell
cd C:\Users\Shaun\OneDrive\Desktop\Projects\Hackathons\Campus_Intelligence\backend
.\venv\Scripts\python.exe -m pip install --upgrade pip
.\venv\Scripts\python.exe -m pip install fastapi uvicorn firebase-admin pymupdf pillow numpy aiohttp httpx python-dotenv pydantic langchain-core langchain-text-splitters langchain-google-genai transformers torch
```

Then check that everything imports (no output = good):

```powershell
.\venv\Scripts\python.exe -c "import fastapi, uvicorn, firebase_admin, fitz, PIL, numpy, aiohttp, dotenv, langchain_core, langchain_text_splitters, langchain_google_genai, transformers, torch; print('imports ok')"
```

If a package fails to install (Python 3.14 is new), create a venv with Python 3.12 instead and install the same list.
The first start downloads two small models from Hugging Face (about 130 MB for bge-small plus CLIP);
you need internet once.

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
18. **Expiry:** edit a document's `expiryDate` in the Firebase console (Firestore → documents → that doc) to yesterday's
    date (format `2025-01-31`) → questions it alone covered now answer "couldn't find"; set it to a future date → works again.
    (The upload form's own expiry date field does the same; this just avoids waiting.)

---

## 11. Decisions and chores that are yours

- ☐ **The 34 MB `GDG_OnCampus_Video.mp4`** is in git history and on GitHub (P0-9). Options: leave it; or ask Claude
  to prepare a history rewrite (`git filter-repo --path GDG_OnCampus_Video.mp4 --invert-paths` + force push;
  affects every clone, so only with your explicit go-ahead). Do **not** commit the file again (`*.mp4` is ignored).
- ☐ **Put the Python service on a private network / behind Node** when deploying (P0-3): `/faq`, `/health` and
  `/documents/{id}/exists` are still open.
- ☐ **Old data:** answers cached or saved before P0-4/P0-5 may contain stale page numbers. Clear the `questions`
  collection (the answer cache) in the Firebase console. Old chats' answers have no Save button (P1-5); old guest
  chats from before P0-1 are unreachable.
- ☐ **Supabase bucket policies:** the browser still uploads with the public key (P0-3 limit). Check in Supabase that
  only the `documents` bucket allows public *read* and who may *write*; paste the policies to Claude if unsure.
- ☐ **Tune the limit numbers** (rate limits, daily Gemini budget) after you see real traffic (P0-7).
- ☐ **Counters are per process** (rate limits reset on restart; multiple instances do not share them).
- ☐ **Run exactly one Python instance** (P1-6): the processing queue and the start-up cleanup of interrupted jobs live
  in the process. If you deploy several instances, tell Claude: it needs a durable queue.
- ☐ **Anyone who was mid-upload during a restart** must hit Reprocess (the document is marked Error on start-up).
- ☐ **Fill in versions and dates on your real documents** (P1-7): version, effective date and expiry date only do
  something once they are entered. Documents without dates stay live forever. For each policy that has a newer edition,
  re-upload the new one with "Replaces an older document" (or delete the old one).
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

- **After P1-5:** file created; covers P0-1 … P1-5.
- **After P1-8:** commit message for P1-8; smoke-test steps 19-20 (exact reuse, invalidation); purge old cache entries; the cache is exact-match only (semantic mode needs your own calibration).
- **After P1-7:** commit message for P1-7; smoke-test steps 16-18 (versions, undo, expiry); chores: enter versions/dates on real documents, replace old editions.
- **After P1-6:** commit message for P1-6; new optional `MAX_CONCURRENT_INGESTS`; smoke-test steps 11-15 (background upload, queue, failure, restart, reprocess); single-instance requirement.
