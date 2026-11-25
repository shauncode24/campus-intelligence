# API reference

The system has **two services the browser talks to**. Both are checked against this file by tests
(`backend/python/tests/test_api_docs.py`, `backend/tests/api/route_list.mjs`): adding, removing or renaming
a route without updating this table makes a test fail.

| Service | Default URL | Env var in `frontend/.env` | Why it exists |
|---|---|---|---|
| **Node API** (`backend/index.js`) | `http://localhost:5000` | `VITE_API_BASE_URL` | Admin document handling, Google Calendar, FAQ admin, and the question relay (streams the RAG service's answer and cancels it when the browser leaves) |
| **RAG service** (`backend/python/main.py`) | `http://localhost:8000` | `VITE_PYTHON_RAG_URL` | Everything that touches the documents, models, chats, history, feedback |

Both verify the Firebase ID token themselves (`Authorization: Bearer <token>`); identity is never taken from
a request body or URL. "Admin" means the token carries the `admin` custom claim.

**Why two services?** Node was the original backend; the RAG service (Python) was added for the models and
now owns all chat data. Moving the calendar and admin routes into Python (or the query relay out of Node) is
possible but is a rewrite with no user-visible gain, so it was deliberately *not* done in P2-4. What P2-4 did
remove is everything duplicated or dead; each remaining route below is called by the web app or is an
operational endpoint.

## Node API

| Method | Path | Who | Purpose |
|---|---|---|---|
| POST | `/document/query` | signed-in | Ask a question; answer streamed as server-sent events (`intent`, `text`…, `metadata`, `done` or `error`) |
| GET | `/calendar/auth` | signed-in | Start the Google Calendar connection |
| GET | `/calendar/callback` | public (Google redirects here; state is signed) | Finish the Google connection |
| POST | `/calendar/create-event` | signed-in | Add a deadline to the user's calendar |
| GET | `/calendar/status` | signed-in | Is the calendar connected? |
| GET | `/healthz` | public | Liveness only (no database access) |
| DELETE | `/me` | signed-in | Delete everything stored about me (chats, history, notes, feedback, calendar link) and my account; body `{"confirm": true}`; admins refused |
| DELETE | `/calendar/disconnect` | signed-in | Disconnect the calendar |
| POST | `/documents/upload-url` | admin | Get a one-time signed upload target for the PDF (the bucket accepts no anonymous writes) |
| POST | `/documents` | admin | Register an uploaded file (creates the document record) |
| DELETE | `/documents/:documentId` | admin | Delete a document, its passages, its file and cached answers |
| POST | `/documents/process` | admin | Start processing a new document (returns at once; runs in the background) |
| POST | `/documents/reprocess` | admin | Process an existing document again |
| GET | `/documents/rag-status` | admin | Is the RAG service reachable? (operational check) |
| POST | `/documents/check-duplicate` | admin | Does this file or name already exist? |
| GET | `/documents/processing-status/:documentId` | admin | Progress of a processing job |
| DELETE | `/documents/cancel-processing/:documentId` | admin | Stop a processing job |
| GET | `/admin/faq` | admin | List curated FAQ entries |
| POST | `/admin/faq` | admin | Add an FAQ entry |
| PUT | `/admin/faq/:id` | admin | Edit an FAQ entry |
| DELETE | `/admin/faq/:id` | admin | Delete an FAQ entry |

## RAG service

| Method | Path | Who | Purpose |
|---|---|---|---|
| GET | `/healthz` | public | Liveness only (no database access) |
| GET | `/health` | public | Model names and the in-memory index size; no database reads, no user data |
| GET | `/faq` | public | The published, admin-curated FAQ (kept 60 s in memory; at most one database read a minute) |
| GET | `/documents/{documentId}/exists` | signed-in | Whether a document id exists (used to grey out deleted sources) |
| POST | `/query` | signed-in | Ask a question; one JSON answer (kept for tools and tests) |
| POST | `/query/stream` | signed-in | Same, streamed as one JSON event per line (the Node relay uses this) |
| GET | `/chats` | signed-in | The user's chats |
| POST | `/chats/create` | signed-in | Create a chat |
| DELETE | `/chats/{chatId}` | signed-in (owner) | Delete a chat and its messages |
| PUT | `/chats/{chatId}/title` | signed-in (owner) | Rename a chat |
| GET | `/chats/{chatId}/messages` | signed-in (owner) | Messages of a chat (paged) |
| GET | `/history` | signed-in | The user's past questions (optionally favourites only) |
| DELETE | `/history/{historyId}` | signed-in (owner) | Delete a history entry |
| PUT | `/history/{historyId}/favorite` | signed-in (owner) | Save / unsave an answer |
| PUT | `/history/{history_id}/note` | signed-in (owner) | Write a personal note on an answer |
| PUT | `/messages/{message_id}/feedback` | signed-in (owner) | 👍 / 👎 with an optional reason and comment |
| GET | `/admin/metrics` | admin | How the service is doing: time per stage (p50/p95), time to first word, outcomes, tokens and estimated cost per question (last questions, this process) |
| POST | `/process-document` | admin | Start processing a document (called by the Node API) |
| POST | `/check-duplicate` | admin | Duplicate check (called by the Node API) |

Interactive documentation of the RAG service's request and response shapes is generated by FastAPI at
`/docs` when the service runs.
