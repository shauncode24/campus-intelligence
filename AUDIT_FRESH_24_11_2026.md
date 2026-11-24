# Campus Intelligence — Fresh Technical & Product Audit (24 Nov 2026)

**This is a from-scratch review of the code as it is today.** The earlier `AUDIT_23_11_2026.md` was deliberately ignored: none of its findings, "DONE" marks or scores are used here. Where this report agrees with it, that is because I re-found the problem in the code.

## 0. Scope, method and limits

**Decisions you gave me, and how they change the grading**

| Your answer | Effect on this audit |
|---|---|
| Hackathon entry, but you want to use it for real | Graded as a **real-world pilot with real students**, not a demo. "Works on stage" does not count as done. |
| Not deployed, single instance | In-memory state (rate limits, budgets, index, jobs) is **acceptable as a documented limit**, not a defect. It still has consequences, listed in A1. |
| Corpus size unknown | I could not size the vector index or the Firestore cost. Everything scale-related is marked **Risk**, with the number that would settle it. |
| All documents are public | `accessLevel` and the public bucket are fine **as a product decision**. The *write* side of the bucket is a separate problem (S1). |
| Free sign-up | Per-user limits are not a control, because accounts are free. This drives S2 and S3. |
| Do NOT run anything | **Everything below is confirmed by reading code, not by running it.** "Confirmed" means "the code path says so". Nothing was executed, built, load-tested or opened in a browser. |
| Keep Google Calendar | The calendar code is audited as a feature you keep (S6, R10). |

**What I read (all of it, line by line):** `backend/python/` (`main.py`, `config.py`, `auth.py`, `models.py`, every file in `services/`, `database/`, `routes/`, and `utils/` except `entity_extractor.py`, `intent_detector.py`, `client_metadata.py`, `threads.py`, `single_flight.py` and the rest of `observability.py` past line 120); `backend/index.js`, `backend/routes/*.js`, `backend/middleware/*.js`, `backend/services/*.js`; `firestore.rules`, `firestore.indexes.json`, `firebase.json`; `.github/workflows/ci.yml`; `Dockerfile`; `requirements.in`; `.env.example` files; `eval/README.md`; `loadtests/budgets.json`.

**What I read only in part:** the frontend (about 9,000 lines). I read `useChat.js`, `AuthContext.jsx`, `api.js`, `AppRoutes.jsx`, `citations.js` and the first half of `AppContext.jsx`. The rest I only searched with grep. UI, UX and accessibility findings are therefore **weaker evidence** than the backend ones, and say so.

**What I could not inspect, and why it matters:**
- **Supabase bucket policies**: not in the repo. This is the single biggest unknown (S1).
- **Real data**: volumes, real documents, real questions, real bills.
- **Anything about runtime behaviour**: latency, memory, whether streaming and cancellation work against real Gemini, whether CI is green on GitHub.
- `YOUR_STEPS.md` (616 lines), `loadtests/run.py`, the eval scripts' internals, and all 24 test files' contents (I only counted tests).

**Labels:** **Bug** = defect visible in the code · **Design** = works but is wrongly shaped · **Risk** = plausible, needs a test to settle · **Missing** = absent capability · **Enhancement** = optional.
**Effort:** S < ½ day · M 1–3 days · L > 1 week.

---

## 1. The system as it is

```
Browser (React 19 + Vite, JS)
  ├─ Firebase Auth (email/password + anonymous guests)         → ID token on every API call
  ├─ Firestore client SDK: reads users/{self}, documents (Processed only); no writes
  ├─ Supabase Storage client (ANON key, hard-coded): uploads PDFs to a public bucket "documents"
  ├─► Node/Express :5000   POST /document/query (NDJSON→SSE relay), /documents/* (admin), /calendar/*, /admin/faq
  │        └─► Python :8000  (forwards the user's token; Python verifies it again)
  └─► Python/FastAPI :8000 directly: /chats*, /history*, /messages/{id}/feedback, /faq, /documents/{id}/exists, /health

Python service (one process, one uvicorn worker)
  question ─► follow-up rewrite (Gemini, only if it "looks like" a follow-up)
           ─► embed with bge-small-en-v1.5 (+ CLIP text embed for images, every time)
           ─► exact-match answer cache (Firestore `questions`, keyed by question hash + corpus epoch)
           ─► in-memory numpy index of ALL chunks (rebuilt when meta/corpus epoch changes)
           ─► live-document filter (reads the whole `documents` collection) ─► relevance floor 0.50
           ─► grounded prompt (system prompt + delimited <context>, NOT_FOUND refusal token)
           ─► Gemini 2.5 Flash, streamed ─► save exchange (one atomic Firestore batch)
  ingestion: admin → Node → Python 202 → in-process background job (1 at a time)
           PyMuPDF text → 500/100-char splitter per page → bge embeddings;
           images → Gemini caption (1 call/image, ≤30/doc) or CLIP fallback → chunks in Firestore
Data (all Firestore): documents, chunks(+384-d vectors), questions(cache), chats, chat_messages, user_questions,
  feedback, faq, user_calendar_tokens, calendar_oauth_states, calendar_events, meta/corpus
```

**Facts that shape the rest:** one Python process holds the models (torch, two of them), the vector index, the rate limits, the daily LLM budgets, the ingestion queue and the metrics. A restart loses all of those. The browser talks to two backends in two languages.

---

## 2. Findings

Each finding: **Where · Now · Wrong · Why it matters · Fix · Effort · Verify.** Grouped by layer. IDs are stable so the roadmap can refer to them.

### 2A. Security & privacy

**S1 · Anyone can probably upload to your document bucket** — *Risk (likely) · Critical if true* — `frontend/src/app/supabase.js`, `UploadDocument.jsx:265-271`
- **Now:** the *browser* uploads the PDF straight to Supabase using the public anon key that is hard-coded in the JS bundle. Only afterwards does it ask the Node API (which checks the admin claim) to register the document.
- **Wrong:** Supabase knows nothing about Firebase's admin claim. For this upload to work for an admin, the bucket policy must let the *anon key* write. Unless something else I can't see authorises it, **every visitor can upload, and perhaps overwrite or delete, files in your bucket**, because the anon key is public.
- **Why:** an attacker can host arbitrary files on your storage, and, if overwrite is allowed, replace a registered document's PDF. The next re-process, and every image question (R5 re-downloads the PDF), would then use the attacker's content. That is the only realistic route to prompt injection in your corpus.
- **Fix:** Node issues a **signed upload URL** (service-role key stays server-side) after the admin check; set the bucket policies to deny anon insert/update/delete; keep public read. Or move uploads to Firebase Storage with a rule on `request.auth.token.admin`.
- **Effort:** M. **Verify:** `curl` an upload with the anon key and no admin → 401/403; admin upload through the UI still works; try overwriting an existing object path → rejected.
- **Needs from you:** the Supabase policy list for the `documents` bucket (SQL or a screenshot). If anon writes are already denied, this drops to Low.

**S2 · Free sign-up + anonymous guests defeat per-user limits; one script can exhaust everyone's daily budget** — *Design · High* — `config.py:153-154`, `utils/rate_limit.py`, `AuthContext.jsx`, `api.js:ensureSignedIn`
- **Now:** every page visit creates a Firebase anonymous account. Each account gets 100 model calls a day. A global cap of 3,000 model calls/day protects your Gemini bill. No email verification, no CAPTCHA or App Check.
- **Wrong:** the cap protects the money but not the **availability**. Someone who asks varied questions at the 60/min IP limit reaches 3,000 in about 50 minutes, after which **every student gets "daily capacity reached"** until the window slides. Cache hits and refusals are free, so an attacker only needs questions that are not cached. Anonymous accounts can be minted without limit.
- **Why:** a trivial, cheap way to take your product down for a day, and a free-sign-up product will attract this the first time someone is annoyed.
- **Fix (do in this order):** (1) **Firebase App Check** (reCAPTCHA Enterprise or Turnstile) on the API, so requests need an attestation, not just an account; (2) require **verified email** for the full quota and give guests a much smaller one (for example 5/day); (3) per-IP *daily* model-call cap; (4) alert when the global cap passes 70%. Restrict sign-up to campus email domains if that is acceptable (Q4 below).
- **Effort:** M. **Verify:** script that creates N anonymous accounts and asks distinct questions: guests stop at their small cap and the global cap is not reachable from one IP.

**S3 · Python's per-IP limits see Node's address, so every question shares one 60/min bucket** — *Bug (confirmed by reading) · High* — `backend/index.js:145-153`, `utils/rate_limit.py:60-66,97-105`, `main.py:98-122`
- **Now:** the browser sends questions to Node, and Node calls Python's `/query/stream` with only `Content-Type`, `Authorization` and `X-Request-ID`. It does not forward `X-Forwarded-For`. Python keys `query-ip:<ip>` (limit 60/min) and the global per-IP limit `ip:<ip>` (limit 600/min) on `request.client.host`, which is **Node's IP for every question**.
- **Wrong:** all students together get **60 questions a minute**; the 61st gets "Too many questions from your network". Python also cannot tell users apart by IP for abuse control.
- **Fix:** Node forwards the real client IP in a header Python trusts only from Node (shared secret or private network), and Python sets `TRUST_PROXY` accordingly; **or** drop Python's per-IP query limit and keep only Node's (which sees the real IP once `TRUST_PROXY=1` is set behind the host's proxy). Also document `TRUST_PROXY` in the deployment guide: without it every user behind the host's proxy shares one IP bucket on Node too.
- **Effort:** S. **Verify:** test with two simulated client IPs sending 40 questions/min each through Node: no 429s. Test for the matching Node-side limit with a forged `X-Forwarded-For` when `TRUST_PROXY` is off.

**S4 · Unauthenticated endpoints that cost database reads** — *Bug (cost abuse) · Medium-High* — `main.py:676-695,698-707,787-804`
- **Now:** `GET /health` has no auth and reads up to **1,000 documents** (`select([]).limit(1000).stream()`, billed per document) on every call. `GET /faq` reads up to 100. `GET /documents/{id}/exists` reads one and reveals whether an id exists.
- **Wrong:** the only protection is the 600/min per-IP limit, which allows up to ~600,000 reads/min from one IP. On Firestore's free daily quota (50k reads) a single bored visitor can use up the day in seconds, which stops the app. On a paid plan it is cheap but still silly.
- **Fix:** make `/health` return static data (use `/healthz`, already present), move the chunk count into the admin-only `/admin/metrics`; cache `/faq` for 60 s in memory; remove `/documents/{id}/exists` if nothing needs it (check the frontend first).
- **Effort:** S. **Verify:** 1,000 calls to `/health` cause 0 Firestore reads (check in the emulator's request log).

**S5 · Question text and user ids are written to the logs** — *Bug (confirmed) · Medium* — `main.py:361-362`, `backend/index.js:120-121`, `chat_repository.py:216`, 36 `print` calls in `main.py`, 37 in `cache_repository.py`
- **Now:** `print(f"🔍 Query: {request.question}")` and `print(f"👤 User: {user_id}")` on every question, in both services; the chat-title log line prints text derived from the first question. The new JSON logger's docstring promises "never contains a question, an answer or a raw user id", and that promise is **false for the process's stdout as a whole**.
- **Why:** students type personal things ("my fee is overdue, can I…"). Hosting platforms keep logs and show them to anyone with dashboard access. This is a privacy bug, not style.
- **Fix:** delete these lines; route remaining `print`s through one logger with levels and a rule "IDs, never content". Add a test that fails if a question string appears in captured stdout during a query.
- **Effort:** S–M (about 135 `print`s to review). **Verify:** run one query in a test with a sentinel string, assert it is absent from stdout/stderr.

**S6 · Google Calendar integration** — *Risk + Design · Medium–High* — `services/calendarService.js`, `routes/calendarRoutes.js`
1. **Shared OAuth client (Risk, High impact).** `oauth2Client` is one module-level object; `createCalendarEvent` calls `oauth2Client.setCredentials(tokens)` and then awaits network calls. Two overlapping requests can interleave, so one user's event could be created with **another user's credentials**. Needs a concurrency test to confirm, but the pattern is unsafe on its face. *Fix:* build a new `OAuth2` client per request (S, trivial). *Verify:* two parallel `create-event` calls for different users each land on their own calendar.
2. **Tokens in plaintext (Design, Medium).** `calendarRoutes.js:91` stores access and refresh tokens as-is in `user_calendar_tokens`. Clients cannot read the collection (rules), but anyone with the admin SDK key, a Firestore export or a backup can. *Fix:* encrypt with a key from the environment or a KMS (AES-GCM; M).
3. **Event time is wrong (Bug, see R10).**
4. `eventData.title/description/sourceDocument` are not type- or length-checked (Low); `calendar_oauth_states` rows from abandoned flows are never deleted (Low).
- *What is fine:* the OAuth `state` is a one-time server-side nonce bound to the uid and consumed in a transaction.

**S7 · Prompt injection (direct and via documents/images)** — *Risk · Low–Medium* — `llm_service.py`, `image_captioner.py`
- Mitigations exist and are sensible: a system prompt that treats context as data, delimiter neutralisation, a refusal token, and a user-confirmed calendar action. They reduce the risk but cannot remove it, and **images are a hole**: text printed in an image is transcribed by Gemini and indexed as a trusted-looking passage. The real exposure depends on who controls the PDFs, which is why S1 matters.
- **Fix/Verify:** red-team fixtures (a PDF with "ignore previous instructions", an image with the same text) in the eval set; check the answer does not follow it. **Effort:** S–M.

**S8 · Untrusted PDF parsing happens inside the serving process** — *Risk · Low–Medium* — `pdf_processor.py`
- Admin-only upload helps, but see S1. PyMuPDF parses the file in the same process that holds the Firebase credentials, the models and answers questions; there is a 50 MB / 500-page cap but **no parse timeout and no memory limit**. A crafted PDF can stall or kill the service. The container does run as a non-root user (good).
- **Fix:** acceptable for a pilot once S1 is closed; later run ingestion in a separate worker/container with a memory limit. **Effort:** L (later).

**S9 · Student data lifecycle: no deletion, no retention, no export** — *Missing · High for "real life"* — `chat_repository.py:110-178`, `cache_repository.py`, `feedback_repository.py`
- **Confirmed:** `delete_chat` removes the chat and its messages but **not** the matching `user_questions` rows, so "deleted" questions and answers stay in History. Feedback rows copy the **question and answer text** and are never deleted. The shared cache stores the raw text of every question (no user id) and its TTL is only checked when read, so old entries are never removed. Anonymous accounts, and all their chats, are never purged. There is no "delete my data" or "export my data" feature and no privacy notice that I could find.
- **Why:** you said you want real use. Real students' questions are personal data, and "I deleted it" must be true.
- **Fix:** (1) a single `delete_user_data(uid)` that wipes chats, messages, history, feedback, calendar tokens/events, and the Firebase account; (2) delete a history entry's sibling rows together; (3) Firestore **TTL policies** on `questions`, `calendar_oauth_states`, and old guest data; (4) a scheduled job to delete anonymous accounts inactive for N days; (5) a one-page privacy notice linked from the UI.
- **Effort:** M. **Verify:** create user, ask, rate, connect calendar, call delete → no document with that uid remains in any collection (script that scans all).

**S10 · Smaller security/hygiene items** — *Low*
- The Supabase project host is a **default in `config.py:119`** and in the frontend source: fine functionally, but it ties the code to one project (no dev/prod split).
- `@supabase/supabase-js` is a *devDependency* but imported by application code; it works because Vite bundles it, but it is mislabelled.
- Password rules are Firebase's defaults (6 characters) and **email verification is not required**.
- I could not tell whether the CI workflow has ever run green on GitHub, so the secret scan and `npm audit`/`pip-audit` results are unknown to me.

### 2B. RAG pipeline & AI engineering

**R1 · A PDF with no extractable text becomes "Processed" with 0 passages, silently** — *Bug (confirmed) · High* — `pdf_processor.py:77-83`, `ingestion.py:134-168`
- **Now:** pages whose `get_text()` is empty are skipped with no record. Nothing checks `len(all_docs) == 0` or counts empty pages. A scanned circular ends as `status: Processed`, message "Done: 0 passages".
- **Wrong:** the admin thinks the document is live; students asking about it get "I couldn't find this" forever. No OCR. Mixed PDFs lose their scanned pages with no warning.
- **Fix:** record `pagesTotal`, `pagesWithText`, `chunks` on the document; **fail or warn** when text coverage is low (for example < 50% of pages) and show it in the admin list; offer OCR for those pages as a later step (L).
- **Effort:** S (guard + warning). **Verify:** fixture PDF of scanned images → document ends as Error/Warning with a clear message.

**R2 · Chunking throws away structure** — *Design · High (unmeasured)* — `pdf_processor.py:25-28,106-128`, `config.py:79-80`
- 500-character chunks (about 100–120 tokens) with 100 overlap, split **per page**; an answer that crosses a page break is cut in two. No document title or section heading is stored in or prepended to a chunk ("The fee is ₹45,000" carries no context). Repeated headers and footers become chunks on every page. Tables become flattened text from `get_text()`. The embedder accepts 512 tokens, so most of its capacity is unused.
- **Why it matters:** this is where campus documents (fee tables, timetables, regulations) lose meaning. **I cannot say how much it hurts, because there is no real evaluation (E1).**
- **Fix (experiments, each measured on the real golden set, one at a time):** (a) 800–1,200-character chunks; (b) prepend `Document title › page` to the embedded text; (c) split across page boundaries keeping a page range; (d) strip repeated header/footer lines; (e) table-aware extraction only if tables fail in the eval. **Effort:** M per experiment. **Verify:** Recall@5 / hit@5 on the golden set, before and after.

**R3 · Retrieval is dense-only, top-5, with an unproven relevance floor; the embedder is English-only** — *Design/Risk · Medium–High* — `retrieval_service.py`, `config.py:81-97`, `embedding_service.py`
- Five chunks of 500 characters (about 2,500 characters of evidence) is a thin context for multi-part questions ("fees AND last date AND late penalty"). `MIN_RETRIEVAL_SCORE=0.50` is labelled PROVISIONAL and was tuned on a synthetic corpus whose questions share wording with the text. Hybrid and rerank experiments exist and were *not adopted*, correctly, because they could not be shown to help on synthetic data. `bge-small-en` is an English model: **if students ask in Hindi or mixed language, retrieval will be poor (Q2 below)**.
- **Fix:** do nothing until E1 exists; then test top-k 5 vs 8 vs 10, hybrid, rerank, and (if needed) a multilingual embedder. **Effort:** M. **Verify:** the same eval, recorded in `eval/results/`.

**R4 · Per-question database reads that grow with the number of documents** — *Design · Medium (High at scale)* — `retrieval_service.py:17-32`, `main.py:416-431`, `vector_index.py:62-104`
- **Confirmed:** every question reads the epoch (1 read), **streams every `documents` record** to compute the live set, and does so again when a cached answer must be re-validated. On a cache miss, `prepare_sources` then reads each cited document. With 300 documents that is roughly 300–600 reads per question before any model call. Separately, **any** document upload, delete or reprocess changes the epoch and the next question **re-reads every chunk with its vector** (and holds the index lock, so concurrent questions wait for the rebuild).
- **Fix:** cache the live-document set in memory keyed by the epoch plus a short TTL (the epoch already changes when documents change; date-based expiry can be checked in memory); build the index in the background and keep serving the old one until the new one is ready. **Effort:** M. **Verify:** emulator read count per question stays constant as documents grow from 10 to 500.

**R5 · Image questions re-download whole PDFs on every question** — *Design/Bug · High (performance)* — `llm_service.py:102-142,184-222`
- **Confirmed:** for each retrieved image chunk (up to 3), `_re_extract_image` downloads the **entire PDF** (up to 50 MB) from Supabase, writes it to a temp file and opens it with PyMuPDF, then discards it. That runs on the critical path before generation. If the file in the bucket was replaced (see S1), `xref` indexes no longer match and the wrong image is sent.
- Also: the CLIP text embedding of the question (`embed_image_query`) is computed for **every** question, even when the corpus has no image chunks.
- **Fix:** store small page-image crops or the caption only (captions already carry the text), or cache extracted images by `(documentId, xref)` on disk with the file's `contentSha256` as the key; skip the CLIP embedding when the index has no image chunks. **Effort:** M. **Verify:** p95 time for an image question before/after; no PDF download during a question (assert in a test).

**R6 · "Sources" are the retrieved chunks, not the ones the answer used** — *Design · Medium* — `main.py:524-531,592-600`, `citations.js`
- The model writes `[Document, p. N]` citations (good). The backend, though, attaches **all** kept chunks as `sources`, whether or not the model used them; the UI links a citation only if it matches a retrieved source. The Python side never checks that a citation in the answer matches a source (a hallucinated page number is passed through).
- **Fix:** after generation, parse citations, keep sources that were cited (plus a "more sources" fold-out), and **flag** an answer whose citations match nothing retrieved. **Effort:** S–M. **Verify:** unit tests with fabricated citations; eval metric "citation accuracy".

**R7 · The "confidence" score is computed, stored and unused** — *Bug (dead code) · Low* — `confidence_calculator.py`, `main.py:569`, `cache_repository.py`
- The average cosine similarity ×100, labelled High/Medium/Low, is computed, saved to every cache and history row and **not displayed anywhere in the frontend** (only leftover CSS classes mention it). Not harmful, but misleading to maintain: a future developer may start showing it.
- **Fix:** delete it, or keep it only after it is calibrated on the golden set. **Effort:** S.

**R8 · Follow-up rewrite adds an extra model call to most short questions in a chat** — *Design · Low–Medium* — `query_condenser.py:75-91`
- A question of 10 words or fewer, or one containing words such as "it", "this", "one", "also" goes through a Gemini call **before** retrieval whenever the chat has history. Most chat questions are short. This adds latency (one extra round trip) and spends the daily budget (`consume_llm_budget`).
- **Fix:** measure how often the rewrite changes anything (the `rewritten` flag is already tracked); tighten the heuristic if it rarely does. **Effort:** S.

**R9 · Generation has no timeout, retry, output cap or fallback** — *Design · Medium* — `llm_service.py:93-100`
- `ChatGoogleGenerativeAI(model, temperature)` only. If Gemini hangs the request hangs (the user can press Stop); a 429/503 from Google becomes a generic error with no retry; there is no `max_output_tokens`. There is no second model to fall back to.
- **Fix:** request timeout, one bounded retry with backoff for transient errors, a sensible output cap. **Effort:** S. **Verify:** test with a stubbed slow/failing model.

**R10 · Deadline detection and Calendar events are wrong in several confirmed ways** — *Bug · High (you chose to keep Calendar)* — `utils/deadline_extractor.py`, `services/calendarService.js:57-65`
1. **"May 5, 2026" is never parsed.** The second pattern matches the text with a comma but is parsed with a format that has no comma, so `strptime` raises, the code `continue`s, and the date is dropped.
2. Patterns are tried **in order**, and the first pattern that matches wins, not the *first or earliest date* in the answer. "Classes begin 1 Aug; fees due 15 Aug" may offer either date as "the deadline".
3. **Any** future date in **any** answer produces an "Add to calendar" offer (an exam date, a start date, an event). The title is always the literal "Deadline"; `sourceDocument` is a **database id**, not a document name.
4. **Time zone:** the event is built as 09:00 in the *server's* local time (`setHours`), then sent as UTC with `timeZone: 'UTC'`. On a UTC host a student in IST gets 14:30. A date parsed as UTC midnight and then shifted by local hours can also land on the wrong day.
- **Fix:** ask Gemini for **structured output** for dates (`{date, label, sourceChunk}` via a JSON schema, only when the question looks like a deadline question), create **all-day events** (a `date` with no time and no zone), show the extracted label and source in the existing preview modal so the user confirms. **Effort:** M. **Verify:** unit tests for 12 date phrasings including commas, ranges and two dates in one answer; the calendar event appears on the right day for UTC+5:30 and UTC-8 hosts.

### 2C. AI evaluation & reliability

**E1 · You cannot currently show that the answers are correct** — *Missing · Critical for "does it work?"* — `eval/`
- The harness is solid for **retrieval** (hit/recall/MRR/nDCG, confidence intervals, an abstention sweep, regression gate). Its only dataset is **synthetic** (12 pages, 34 questions, one author), and its README says its numbers are "not your baseline". The 0.50 floor, the 500-character chunk size, the top-5 and the choice of bge-small are all unmeasured on real data.
- **Absent:** any evaluation of **answers** (correctness, faithfulness, citation accuracy, refusal behaviour of the real LLM), of cost per answered question on real traffic, and of image questions. The previous "answer-level scoring" step was never built.
- **Do next (cheapest to dearest):**
  1. Take your **real PDFs** (any number: 3 will do to begin) and write **40 answerable + 20 unanswerable** questions in the wording students use. Have a second person verify the gold pages. (You said you don't know the corpus size; this is also how to find out.)
  2. Run the existing harness on them → real baseline for the chunk/threshold choices (R2, R3).
  3. Add an **answer-level run** (calls Gemini, small cost): `must_include` string match for correctness, citation-page-matches-gold for citation accuracy, refusal rate on the unanswerable set. LLM-as-judge for faithfulness only after calibrating against ~30 human labels.
  4. Freeze a held-out 30% for final numbers.
- **Effort:** M for steps 1–2, M for step 3. **Verify:** the report exists in `eval/results/` and a regression drops CI.
- **Do not invent expectations:** I'm not predicting any score.

**E2 · The feedback loop is half-built** — *Missing · Medium* — `feedback_repository.py`, `/admin/metrics`
- 👍/👎 is stored with the question, answer, chunk ids and reason (good raw material). But nothing lets an admin *see* it except `scripts/export_feedback.py`, and `/admin/metrics` is in-memory, per process and empty after each restart. There is no list of "questions we declined" or "answers rated wrong", which is the most useful product input you will have.
- **Fix:** an admin page: declined questions (grouped), downvoted answers with their sources, and top cited documents. **Effort:** M. **Verify:** an admin can open the page and see a downvoted answer from a test user.

### 2D. Backend & architecture

**A1 · All control state lives in one process's memory (acceptable for now; here is what it costs)** — *Design · Medium* — `utils/rate_limit.py`, `single_flight.py`, `vector_index.py`, `ingestion.py`, `observability.py`
- Because you run one instance, I'm not calling this a bug. But: (a) **a restart, crash or redeploy resets the daily LLM budgets and rate limits**, which are your cost controls; (b) a document being processed when the process dies is marked "Error" with "please re-process" and its work is lost; (c) metrics vanish on restart; (d) **cold start loads two torch models** (the load-test budget allows up to 150 s), so a host that sleeps idle services makes the first student wait minutes; (e) you cannot add a second instance without redesigning all five.
- **Fix:** keep it, but (1) choose a host that keeps one instance always on and has enough RAM (see T3), (2) write the daily counters to Firestore (a single doc per day, transactional increment) so a restart does not reset them, (3) write "single instance only" in the deployment guide. **Effort:** S–M.

**A2 · Two backends in two languages, three network hops** — *Design · Medium* — `backend/index.js` and `backend/python/main.py`
- The browser calls **both**. A question goes browser → Node → Python; the token is verified twice; rate limits exist in both (and interact badly: S3); errors are shaped differently; Node is about 1,100 lines doing: relay a stream, admin document CRUD, calendar, FAQ admin. You will deploy, monitor and patch two runtimes forever.
- **Recommendation:** no rewrite. Short-term, put both behind **one domain** (a reverse proxy: `/api/*` → Node, `/rag/*` → Python) so the frontend has one origin and CORS is trivial. Long-term, move the admin document routes and calendar into Python so Node can go. **Effort:** S (proxy) / L (consolidation, P3).

**A3 · Re-processing a live document makes it unanswerable until it finishes** — *Design · Medium* — `documentRoutes.js:264-268`, `retrieval_service.py:27`
- Node sets `status: "Processing"` on a reprocess. Retrieval only uses `Processed` documents, so the document disappears from answers for the duration (minutes for a big PDF), and if it fails it stays dark with its old chunks orphaned. The "new version replaces old" flow handles this correctly; plain re-process does not.
- **Fix:** write new chunks under a new generation id and flip a pointer when done, or require re-processing only through "upload as a new version". **Effort:** M.

**A4 · Repository methods swallow errors and return empty results** — *Bug · Low–Medium* — `chat_repository.py:62-64,105-107`, `cache_repository.py`
- `get_user_chats` returns `[]` when Firestore fails, so the user sees "no chats yet" instead of an error. (The history code was fixed to raise; the chat code was not.) `create_chat` returns `None`, which becomes a vague 500.
- **Fix:** let errors propagate to the existing `internal_error` handler. **Effort:** S. **Verify:** unit test with a failing fake DB → 500 with a reference id, not an empty list.

**A5 · Logging is two systems** — *Design · Low–Medium*
- About 135 emoji `print`s without levels or request ids sit beside the structured JSON events. This makes searching by `requestId` unreliable and is also the cause of S5.
- **Fix:** replace `print` with `logging` and the JSON formatter. **Effort:** M (mechanical).

**A6 · Dead and leftover code** — *Low*
- Confidence module and its CSS (R7); duplicate `.confidence-badge-top` and `.confidence-text` rules inside `Message.css` (defined at lines 162 and 350); `OldPage.jsx` and `OldTabs.jsx` are not routed from `AppRoutes.jsx` (each is referenced by only one other file, so they may be orphaned: verify before deleting); 11 `console.log`s in the frontend; `UploadDocument.jsx` hard-codes `accessLevel: "Public"` while the API still accepts other values.

### 2E. Database & data management (Firestore)

**D1 · No retention, backup or restore plan** — *Missing · High for real use*
- No scheduled Firestore export, no point-in-time recovery enabled that I can see in the repo, no restore drill, and no separate development/staging/production projects (one set of hard-coded Firebase and Supabase values). Losing the Firestore project loses chunks (re-creatable by re-processing the PDFs, which costs time and Gemini image calls), but also every chat, every history row and every feedback row (not re-creatable).
- **Fix:** enable scheduled exports (or PITR) to a bucket, document and *try* a restore once, create a second Firebase project for staging, and add TTLs (S9). **Effort:** M.

**D2 · Data is stored three times** — *Design · Low*
- The same answer text is saved in `chat_messages`, `user_questions` and (when rated) `feedback`; the question text is also in `questions` (cache). Fine for a pilot, but it multiplies deletion work (S9) and storage.

**D3 · Scaling ceilings you should know** — *Risk*
- The in-memory index is capped at 150,000 chunks (`VECTOR_INDEX_MAX_CHUNKS`); beyond it the service falls back to scanning Firestore per question (the old slow path) and only logs a warning. Each chunk is about 1.5 KB of vector plus its text in RAM. **I can't size this without your corpus (Q1).** Rule of thumb to check: a 100-page PDF yields on the order of a few hundred chunks, so thousands of PDFs would be needed to reach the cap. This is not your bottleneck now.

### 2F. Frontend & UX *(weaker evidence: I read about 15% of the frontend)*

**F1 · Guests lose everything silently** — *Design · Medium* — `AuthContext.jsx`, `api.js`
- Every visitor is given an anonymous Firebase account on load. Clearing the browser or switching device makes a new, empty identity and the old chats become unreachable (and are never purged, S9). I did not find a prompt that tells guests this, or encourages sign-up when they have a saved history. **Fix:** a visible "You're a guest: sign in to keep your history" banner, and offer to link the anonymous account to a new email account (Firebase `linkWithCredential`) so history carries over. **Effort:** S–M.

**F2 · Errors lose their reference id and have no network safeguards** — *Design · Medium* — `useChat.js:111-123,194-213`, `api.js`
- The server includes `(ref abc123)` in generic errors; the UI replaces all non-rate-limit failures with "Sorry, I encountered an error", so a student cannot quote a reference when reporting a problem. `apiFetch` has **no timeout and no retry** (a half-open connection hangs until the user presses Stop).
- **Fix:** show the ref, add a request timeout and one retry for idempotent GETs, and distinguish "you're offline", "service busy" and "something broke". **Effort:** S.

**F3 · Accessibility is probably weak** — *Risk · Medium*
- Only 21 `aria-*`/`role=` attributes across about 70 component and page files; I found no `aria-live` region for the streaming answer. I did not run a screen reader or axe, so this is an inference from counts. **Fix:** an axe/Lighthouse pass, keyboard-only walkthrough of chat, upload and history, `aria-live="polite"` on the streaming message, contrast check. **Effort:** M. **Verify:** axe reports zero critical issues on the main pages.

**F4 · Naming and structure** — *Low*
- `/login` is the **admin** login and `/user-login` the student one, which is confusing for users and for support. `AppContext.jsx` is hand-rolled data fetching (refs, manual caches, `console.log`) rather than a small library; the lint baseline allows 31 existing errors, including `react-hooks/set-state-in-effect`. None of this blocks a pilot.

**F5 · Product surfaces I did not inspect** — onboarding, empty states, the document library page, the FAQ page, saved answers, the upload wizard, mobile layout. I make no claims about them. A real browser walkthrough is the right way to review them (you asked me not to run anything, so I haven't).

### 2G. Performance & scalability *(nothing measured; all hypotheses with a test)*

| # | Hypothesis | Evidence in code | Test that settles it |
|---|---|---|---|
| P1 | Question latency is dominated by (a) the follow-up rewrite, (b) Firestore reads for the live set, (c) Gemini time-to-first-token | R8, R4, `observability` already records per-stage timing | Read `/admin/metrics` p50/p95 after 50 real questions |
| P2 | CPU-bound embedding serialises under load | `loadtests/budgets.json` allows **p95 up to 40 s at 50 concurrent distinct questions** *with fake Firestore and Gemini*: that budget alone says the CPU path is slow | Run `loadtests/run.py` on the target host, then with real Gemini |
| P3 | Image questions are 10×+ slower than text ones | R5 (re-download of a PDF up to 3 times) | Time one image question vs one text question |
| P4 | Document upload/delete causes a latency spike for everyone | R4 (full index rebuild holds a lock) | Query p95 while uploading a 100-page PDF |
| P5 | Memory fits a small host | two torch models in RAM + index + a PDF being parsed (ingestion budget allows 4 GB RSS) | Measure resident memory idle, while ingesting, and under load |

### 2H. Testing, DevOps & deployment

**T1 · Tests are broad but unreal at the edges** — *Design · Medium*
- Present: about 291 Python test functions (against a fake Firestore), a Node API suite against the Firestore emulator, Firestore-rules tests, 29 frontend unit tests, an eval-harness suite, and a load-test harness. Auth/ownership is tested across every route (good).
- **Missing:** any test against real Gemini or real Firestore; **no browser/E2E test** of the main journey (ask → stream → cite → save → reload); no real-PDF fixtures with tables or scans; nothing that checks the Supabase policies (S1). Every "not tried in a browser / not run against real Gemini" caveat the previous work recorded is still true as far as I can see.
- **Fix:** one Playwright smoke test (sign in as guest, ask a question against the emulator with a stubbed model, see an answer with a link, reload, still there); a small set of real PDFs as ingestion fixtures. **Effort:** M.

**T2 · There is no deployment story** — *Missing · High*
- Only the Python service has a `Dockerfile`. There is no Dockerfile or process manager for Node, no compose file, no hosting configuration for the frontend, no environment-per-stage setup, no release checklist, and no rollback plan. `firebase.json` configures only Firestore emulators and rules (the repo does not use Firebase Hosting). `YOUR_STEPS.md` may cover parts of this; I did not read it.
- **Fix:** pick the host (Q3 below), write a one-page runbook: build, env vars, secrets, `TRUST_PROXY`, health checks, deploy, rollback; add a Node Dockerfile; build the frontend in CI with the production URLs. **Effort:** M.

**T3 · Image size and host sizing are unknown** — *Risk · Medium*
- The lock file pins `torch` with no `nvidia-*` packages, so it appears CPU-only, but I haven't built the image and don't know its size or memory floor. Two models plus torch need real RAM; a 512 MB free host will not start it. **Verify:** `docker build` and `docker stats` on the target host class.

**T4 · No monitoring or alerting** — *Missing · High for real use*
- No uptime check, no error tracker, no alert on Gemini/Firestore/Supabase spend or quota, no alert when the daily LLM cap passes 70%, and the metrics endpoint is per process. You'll learn it's down when a student tells you.
- **Fix:** free uptime monitor on `/healthz`; log shipping from the host; a budget alert on the Google Cloud billing account; an alert on the global cap. **Effort:** S–M.

**T5 · CI exists; whether it has ever passed is unknown to me** — *Risk · Low–Medium*
- The workflow covers Python tests and lint, Node API/rules tests, frontend lint (baseline) / tests / build, Docker build + smoke, `gitleaks`, `pip-audit` and `npm audit`. Branch protection is described as a manual step. I cannot see GitHub. **Verify:** open the Actions tab, confirm a green run on `main`, and that the five checks are *required*.

### 2I. Product completeness

- **Problem and user:** clear: students asking about campus documents; admins keeping them current.
- **Strengths that actually affect trust:** refusals say so plainly; sources carry version and effective date; document versions supersede each other.
- **Gaps, honestly stated:**
  1. **Nobody has measured whether the answers are right** (E1): the first wrong fee or deadline a student acts on will cost you more trust than the whole feature set earns.
  2. The admin has **no view of what students asked that the documents could not answer** (E2), which is the main reason an admin would return.
  3. **No privacy notice, no data deletion** (S9).
  4. **Guest identity is fragile** (F1).
  5. **English only** unless you tell me otherwise (R3).
  6. Reason to come back: unclear from the code. Calendar reminders and saved answers are the retention features; whether they work well end to end is untested (R10).
  7. I found no "AI can be wrong, check with the office" notice near the answer. I did not look at every screen; check this one yourself, it matters for a real deployment.

---

## 3. Scores (0–10, with the evidence)

| Category | Score | Why |
|---|---|---|
| Architecture | **5** | Clean layering inside the Python service, sensible data-flow decisions (single save path, corpus epoch, deterministic chunk ids). Pulled down by two backends in two languages (A2), all state in one process (A1), and Firestore doing five jobs. Fine for one instance, a real constraint beyond it. |
| Code quality | **5.5** | Readable, heavily commented, consistent naming, extensive tests. Pulled down by ~135 `print`s (A5), swallowed errors in repositories (A4), dead code and duplicated CSS (A6), a 669-line upload component. |
| Frontend | **4.5** *(low confidence: partly read)* | Streaming, stop, retry and citation links are implemented thoughtfully. Weak error handling (F2), probable accessibility gaps (F3), hand-rolled state (F4), no browser tests (T1). |
| Backend | **5.5** | Auth on every route, ownership checks, validation, safe errors, atomic exchange save, background ingestion with real progress. Pulled down by S3 (shared rate bucket), S4 (read-amplifying public endpoints), R4 (reads per question), R5 (PDF re-downloads), A3, A4. |
| RAG implementation | **4.5** | Sound skeleton (retrieval-tuned embedder, relevance floor, grounded prompt, refusal, versioning, image captioning). But chunking ignores structure (R2), no OCR/zero-text guard (R1), thin context (R3), image path expensive (R5), and every parameter is unproven (E1). |
| AI reliability | **3.5** | Nothing demonstrates correctness: no real golden set, no answer-level evaluation, no citation validation (R6), no model timeouts/retries (R9). The refusal path and prompt are good; the *evidence* is missing. |
| Security | **5** | Server-side token verification, admin by custom claim, deny-by-default Firestore rules, SSRF defences, one-time OAuth state, upload/size caps, non-root container. Held back by S1 (likely open bucket writes), S2 (free-account abuse), S5 (questions in logs), S6.1 (shared OAuth client), S9 (no deletion). Could move to 7 after S1–S5 are fixed and verified. |
| Performance | **4** *(unmeasured)* | Good structural fixes (in-memory index, streaming, single-flight). Costs I can see in code but have not measured: R4, R5, CPU embedding under load (P2). The 40 s p95 load-test budget at 50 concurrent users is a warning sign. |
| Testing maturity | **5.5** | Wide unit/API/rules coverage and a load harness, auth matrix over all routes. No browser E2E, no real-service tests, no real documents (T1). |
| Production readiness | **3.5** | See §4. |
| Product completeness | **5.5** | A complete core loop plus real extras (history, notes, favourites, versions, FAQ, calendar). Missing the admin feedback view, data controls, guest continuity, and any proof of answer quality. |

## 4. What stops this from being production-ready (for a real pilot)

1. **S1: unverified bucket policy.** If anonymous writes are allowed, this alone blocks launch.
2. **S2 + S3: abuse and capacity.** One script can burn the daily model budget; all students share a 60/min question bucket.
3. **E1: no evidence the answers are right.** You'd be putting fees, deadlines and rules in front of students with no measured accuracy.
4. **S5 + S9: privacy.** Questions in the logs; "delete" that does not delete; no retention, no notice.
5. **T2 + T4 + D1: no deployment, monitoring or backup story.**
6. **R1 + R10: two ordinary-looking failures a student will hit early**: a scanned PDF that silently answers nothing, and a calendar event on the wrong day.

---

## 5. Roadmap

Rules I'll follow when you approve: **one item at a time, never commit, give a commit message after each, and record the result in this file.** Dependencies are shown so you can reorder safely.

### P0: before any real student uses it

| ID | Change | Fixes | Files likely touched | Depends on | Expected outcome | Verification |
|---|---|---|---|---|---|---|
| P0-1 ✅ **code done; your Supabase step pending** | Confirm and close bucket write access (signed upload URLs from Node, deny anon writes) | S1 | `UploadDocument.jsx`, `app/supabase.js`, `documentRoutes.js` (+ Supabase dashboard) | Your Supabase policies | Only an admin can add files | Anon `curl` upload/overwrite/delete → denied; admin UI upload works |
| P0-2 ✅ **DONE** | Stop logging questions and user ids; one logger | S5, A5 (part) | `main.py`, `index.js`, `chat_repository.py`, `cache_repository.py` | none | No question text in any log | Test with sentinel string in stdout |
| P0-3 ✅ **DONE** | Fix the shared per-IP bucket | S3 | `index.js`, `utils/rate_limit.py`, `config.py` | none | Per-IP limits apply per real client | Two-IP simulated test |
| P0-4 ✅ **DONE** | Cheap public endpoints | S4 | `main.py` (`/health`, `/faq`, `/documents/{id}/exists`) | none | Zero Firestore reads from unauthenticated calls except cached FAQ | Emulator read count |
| P0-5 | Abuse controls for free sign-up | S2 | `AuthContext.jsx`, `api.js`, `auth.py`, `index.js`, Firebase console (App Check) | P0-3 | One IP/script cannot exhaust the daily budget | Multi-account script |
| P0-6 ✅ **DONE** | Zero-text and low-text PDF guard | R1 | `ingestion.py`, `pdf_processor.py`, admin UI list | none | Scanned PDFs are flagged, not "Done" | Fixture scanned PDF |
| P0-7 ✅ **DONE** | Calendar correctness and safety | R10, S6.1 | `deadline_extractor.py`, `calendarService.js`, `CalendarPreviewModal.jsx` | none | Right date, all-day event, per-request OAuth client | Date-phrase unit tests; parallel-user test |
| P0-8 | Real golden set (you + me) and first real baseline | E1 | `eval/` (data outside git if documents are private) | your real PDFs and 60 questions | Measured retrieval quality on real data | Report in `eval/results/` |
| P0-9 ✅ **DONE** | Student data deletion and a privacy notice | S9 (part) | `chat_repository.py`, `cache_repository.py`, `feedback_repository.py`, new route, frontend settings | none | "Delete my data" removes everything | Script scans every collection for the uid |

### P1: reliability, correctness, usability

| ID | Change | Fixes | Depends | Verification |
|---|---|---|---|---|
| P1-1 | Answer-level evaluation (correctness, citation, refusal) | E1 | P0-8 | Report; CI gate |
| P1-2 | Chunking experiments (size, title prefix, cross-page, header strip) | R2 | P0-8 | Recall@5 before/after |
| P1-3 | Cache the live-document set; background index rebuild | R4 | none | Reads per question constant |
| P1-4 | Image path: no PDF download per question | R5 | none | No download in a question (test); image p95 |
| P1-5 | Citation validation and showing only cited sources | R6 | P1-1 | Fabricated-citation tests |
| P1-6 | Model timeout, bounded retry, output cap | R9 | none | Stubbed slow/failing model tests |
| P1-7 | Persist daily LLM counters in Firestore | A1 | none | Restart does not reset the budget |
| P1-8 | Deployment runbook, Node Dockerfile, one-domain reverse proxy, staging project | T2, A2 | host choice | Fresh deploy from the runbook |
| P1-9 | Monitoring and alerts (uptime, spend, global-cap alert) | T4 | P1-8 | Alert fires in a drill |
| P1-10 | Backups, TTL policies, restore drill | D1, S9 | P1-8 | Timed restore |
| P1-11 | Guest-to-account linking and guest banner; error reference + timeout in the UI | F1, F2 | none | Browser walkthrough |
| P1-12 | Reprocess without downtime | A3 | none | Document answerable throughout a reprocess |
| P1-13 | Calendar token encryption | S6.2 | P1-8 (key storage) | Tokens unreadable in a Firestore export |
| P1-14 | Repository errors propagate | A4 | none | Failing-DB tests |

### P2: significant

- Playwright smoke test and real-PDF ingestion fixtures (T1).
- Admin page: declined questions, downvoted answers, top documents (E2).
- Accessibility pass with axe and keyboard walkthrough (F3).
- Follow-up rewrite heuristic measured and tightened (R8).
- Replace `print` across the codebase (A5), delete dead code (A6, R7).
- Measure performance on the real host with real Gemini (P1–P5); retune budgets in `loadtests/budgets.json`.
- Red-team fixtures for prompt injection, including images (S7).

### P3: enhancements, only if usage justifies

- OCR for scanned PDFs; table-aware extraction (if the eval shows table failures).
- Multilingual embedder and prompts (if students ask in other languages: Q2).
- Move ingestion to a separate worker with limits (S8); consolidate Node into Python (A2).
- Move vector search to Firestore `find_nearest` or a vector store only when the index cap (D3) is in sight.
- Escalation hand-off to a human office; mobile app/PWA, push reminders.

**Explicitly not recommended:** a rewrite; an agent framework; a separate vector database now; reranking or hybrid search before the real golden set shows a problem they would solve.

---

## 6. Questions I still need answered (nothing assumed)

1. **Corpus (Q1):** roughly how many PDFs/pages do you have *today*, and are any of them scanned images or mostly tables (fee structures, timetables)? You said you don't know; even "3 PDFs, one is a scanned circular" is enough to start.
2. **Language (Q2):** do students ask in English only, or also Hindi or other languages?
3. **Hosting (Q3):** where do you plan to run it (a free tier, a campus server, a cloud VM)? The Python service needs roughly a few GB of RAM and must stay running; this decides T3, A1 and the deployment runbook.
4. **Who may sign up (Q4):** can sign-up be limited to campus email addresses (for example `@yourcollege.edu`)? That single decision removes most of S2.
5. **Supabase (S1):** please paste or screenshot the storage policies on the `documents` bucket.
6. **Admins:** how many people will manage documents, and are they technical enough to run the grant-admin script, or do you need a screen for it?
7. **Privacy:** does your institution require a consent notice or a retention period for student questions?
8. **Progress tracking:** my notes say audit items were tracked in `AUDIT.md`, which is now deleted/renamed. Shall I track progress in **this file** from now on?

---

*No files other than this report were created or changed. I'll wait for your approval and your answers before starting any fix. Suggested first move: answer Q5 (S1) and Q4, then approve P0-1 to P0-4, which are small and remove the most risk for the least work.*


---

## 7. Progress log (fix work, newest last; nothing is committed by Claude)

### P0-1 ✅ (code) Uploads go through a one-time signed link (S1)
- **Changed:** new admin-only `POST /documents/upload-url` (`documentRoutes.js`, `services/fileStorage.js:createSignedUploadTarget`). The server asks Supabase (with the service key) for a signed upload token for a fresh, random, sanitised path (no overwrite); the browser uploads with `uploadToSignedUrl` (`UploadDocument.jsx`). The public anon key can now be kept read-only. `API.md` updated.
- **Verified:** `tests/api/signed_upload.mjs` (20 checks: no token 401, non-admin 403, sanitised unique paths, traversal neutralised, non-PDF rejected, storage errors 502, missing key 503, service key never in the response); all 13 Node API test files pass in the Firestore emulator; frontend builds.
- **NOT verified:** a real upload against real Supabase (stand-in used; I assumed the documented `POST /storage/v1/object/upload/sign/{bucket}/{path}` response `{url}` with a `token` query parameter, and `uploadToSignedUrl` in the installed supabase-js). **The bucket's anonymous write policies are not removed by this change: you must remove them in the Supabase dashboard** (YOUR_STEPS section 11) and run the anon-upload check listed there.

### P0-2 ✅ No question text and no user ids in logs (S5)
- **Changed:** removed the question and user id from the prints in `main.py`, `index.js`, `cache_repository.py`, `chat_repository.py` (history/chat ids too). The follow-up rewrite is no longer printed.
- **Verified:** `tests/test_log_privacy.py`: sentinel question, rewritten question and user id are absent from stdout/stderr on the fresh, cached, follow-up, streaming and history paths. Full Python suite: 308 tests pass (1 skipped).
- **Not done (left for A5):** about 100 other `print`s remain; none of them print a question or user id (checked by search), but they are not JSON logs yet. Exception text (`{e}`) is still printed; if an exception message could contain a question this would leak, none known.

### P0-3 ✅ Per-IP limits apply per student (S3)
- **Changed:** Node forwards the caller's address as `X-Client-IP`; Python (`utils/rate_limit.py:client_ip`) believes it only when the direct caller is in `TRUSTED_PROXY_IPS` (default `127.0.0.1,::1`; new in `config.py`, `.env.example`). `X-Forwarded-For` still needs `TRUST_PROXY`.
- **Verified:** `tests/test_client_ip.py` (6 tests incl. two students behind Node get separate buckets; an untrusted caller cannot choose its IP); `chat_proxy.mjs` checks the header is sent.
- **Limit:** if a reverse proxy runs on the same machine as Python and passes unknown headers through, a browser could set `X-Client-IP` itself. Make the proxy drop that header, or set `TRUSTED_PROXY_IPS` to exclude the proxy. In Docker you must add the Node container's address or the old shared bucket returns.

### P0-4 ✅ Cheap public endpoints (S4)
- **Changed:** `/health` does no database reads (`chunks_in_firebase` is now the in-memory index size, 0 until the first question); `/faq` is kept 60 s in memory (`faq_repository.py`); `/documents/{id}/exists` now needs sign-in and a per-user limit (frontend `HistoryPage.jsx` sends the token); `API.md` updated.
- **Verified:** `tests/test_public_endpoints.py`: 400 calls to `/health` + `/healthz` = 0 database accesses; 100 calls to `/faq` = 1; cache expiry; limit still applies; `/exists` refuses anonymous callers without any read. Auth-matrix test updated (the route left the public list).
- **Note:** the exact chunk count is no longer available on `/health`; if you want it, add it to the admin-only `/admin/metrics` (not done).

### P0-6 ✅ Scanned PDFs are refused or flagged (R1)
- **Changed:** `pdf_processor.py` counts readable pages; `ingestion.py` ends a PDF with no text as **Error** with an admin-readable message (nothing stored), and flags one where fewer than `MIN_TEXT_PAGE_FRACTION` (0.5) of pages have text with a `warning` shown in orange in the admin document list (`DocumentManagement.jsx`). Re-processing clears the warning. New settings `MIN_TEXT_CHARS_PER_PAGE`, `MIN_TEXT_PAGE_FRACTION` (provisional).
- **Verified:** `tests/test_text_guard.py` with real PDFs built in memory (text, picture-only, mixed). Not verified: real-world scanned files, the orange note in a browser. No OCR was added: scans still cannot be searched.

### P0-7 ✅ Calendar correctness and safety (R10, S6)
- **Changed:** `deadline_extractor.py` rewritten (all date forms incl. "May 5, 2026", ordinals, abbreviations; day-first numeric; soonest upcoming date that sits near a deadline word; real title, sentence description, document NAME as source). `calendarService.js`: a new OAuth client per call (no cross-user credential mixing), all-day events (no time zone), strict `YYYY-MM-DD` validation, field limits (`cleanEventData`), token revoke helper. Preview modal shows the day, not a shifted time.
- **Verified:** `tests/test_deadline_extractor.py` (10), `tests/api/calendar_events.mjs` (25, incl. two simultaneous users keep their own credentials). Not verified: a real Google insert; day-first reading of `05/03/2027` is an assumption for your documents.
- **Not done:** calendar tokens are still stored in plaintext (P2).

### P0-9 ✅ Delete my data and a privacy notice (S9 part)
- **Changed:** `DELETE /me` (`routes/accountRoutes.js`, `services/userData.js`) erases chats, messages, history, feedback, calendar events/tokens/states and the profile, revokes the Google token, then deletes the sign-in account (data first, so a failure can be retried; admins refused). New `/privacy` page (`PrivacyPage.jsx`) with the notice and the delete button (the footer already linked to it).
- **Verified:** `tests/api/account_deletion.mjs` (17): 450 rows per collection, then a scan of the WHOLE database finds no mention of the uid; another user untouched; a test also fails if the code starts using a new collection that is neither erased nor declared shared.
- **Limits:** the shared answer cache (no user id) is not erased per user; deleting one chat still leaves its History rows; no automatic retention yet; the privacy text is my draft, not legal advice.

All of P0-1..P0-4, P0-6, P0-7, P0-9 done. Remaining P0: P0-5 (deferred by you), P0-8 (needs your real PDFs and questions).
