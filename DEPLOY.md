# Deploying Campus Intelligence

A runbook for putting the service on one machine and keeping it healthy. It is written for a
single instance (one machine, one RAG container), which is what the code supports today.
Nothing here has been run against a real server yet: **do the first deployment on a staging
copy (section 7) and write down anything that differs.**

## 1. What you need

| Need | Notes |
|---|---|
| A machine with Docker | Linux VM recommended. **4 GB RAM minimum, 8 GB comfortable** (the two embedding models load into memory; the load test measured up to about 4 GB while processing a large PDF). 2 vCPU. 20 GB disk (the images are large because the models are baked in). The host choice was not yet made when this was written: any VM from a campus server to a small cloud instance works. A "free tier" that sleeps or has under 2 GB will not. |
| A domain name | `campus.example.edu` style; its DNS record points at the machine's public address. Ports 80 and 443 open. |
| Firebase project | Auth (email/password + anonymous enabled), Firestore. Rules and indexes deployed (section 3). |
| Supabase project | Storage bucket `documents`: public read, **no anonymous writes** (see YOUR_STEPS.md section 11). |
| Google AI key | For Gemini. Set a **budget alert** on the Google Cloud billing account (section 5). |
| Secrets file | Outside the repository, based on `backend/.env.example`. Must contain `SUPABASE_SERVICE_ROLE_KEY`, `TOKEN_ENCRYPTION_KEY`, the Firebase service account values and `GOOGLE_API_KEY`. |

## 2. First deployment

```bash
git clone <your repo> && cd Campus_Intelligence

# 1. Build the web app for ONE domain (the address people will type)
cd frontend
npm ci
VITE_API_BASE_URL=https://campus.example.edu/api \
VITE_PYTHON_RAG_URL=https://campus.example.edu/rag \
  npm run build
cd ..

# 2. Settings for compose
cp deploy/.env.example deploy/.env       # set SITE_ADDRESS, SECRETS_ENV_FILE
#    The secrets file needs at least what backend/.env.example lists as required,
#    plus TOKEN_ENCRYPTION_KEY and SUPABASE_SERVICE_ROLE_KEY.

# 3. Start (the first build downloads the models: allow 10+ minutes)
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --build

# 4. Check
docker compose -f deploy/docker-compose.yml ps               # all "healthy" after about 2 minutes
curl https://campus.example.edu/api/healthz                  # {"status":"ok"}
curl https://campus.example.edu/rag/healthz                  # {"status":"ok"}
```

Then: make yourself admin (`node backend/scripts/setAdminClaim.js you@college.edu` with the
service-account env, then sign out and in), upload one real PDF, ask a question about it, and go
through the smoke test in YOUR_STEPS.md section 10.

Add the domain to **Firebase console, Authentication, Settings, Authorized domains**, and to the
Google OAuth client's redirect URIs if you use the calendar
(`https://campus.example.edu/api/calendar/callback`; set `GOOGLE_REDIRECT_URI` to the same).

## 3. Firebase settings that are not in the containers

```bash
firebase deploy --only firestore:rules,firestore:indexes --project <project-id>
```

**Time-to-live (automatic deletion of old technical records):**

```bash
gcloud firestore fields ttls update expireAt --collection-group=calendar_oauth_states --enable-ttl --project <project-id>
gcloud firestore fields ttls update expireAt --collection-group=llm_usage              --enable-ttl --project <project-id>
```

Deletion by TTL can lag by up to a day. The shared answer cache (`questions`) is cleared with
`backend/python/scripts/purge_cache.py` (monthly is fine).

**Unused guest accounts** (every visitor gets one; nobody deletes them): erase those unused for
60 days, monthly, from any machine that has the service-account env:

```bash
node backend/scripts/purgeGuests.js --dry-run     # look first
node backend/scripts/purgeGuests.js --days 60
```

## 4. Updating and rolling back

```bash
git pull
(cd frontend && npm ci && VITE_API_BASE_URL=... VITE_PYTHON_RAG_URL=... npm run build)
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --build
```

- Restarting the RAG container fails any document that was being processed (it is marked Error;
  press Reprocess) and loses nothing else: the daily budget is saved to the database.
- Roll back with `git checkout <previous commit>` and the same command. Data is not migrated by
  releases so far; if a release ever changes stored data, its notes will say so.
- Do the update at a quiet time: the RAG service takes about 1 to 2 minutes to load its models.

## 5. Monitoring and alerts

1. **Uptime:** add a free monitor (UptimeRobot, Better Stack, Healthchecks.io...) on
   `https://campus.example.edu/api/healthz` and `/rag/healthz`, every 5 minutes, alerting your phone.
2. **Spend:** Google Cloud console, Billing, **Budgets and alerts**: create a budget on the project
   that holds the Gemini key (for example 10 dollars a month with alerts at 50 / 90 / 100 %). Also set a
   quota cap on the Gemini API if the console offers one.
3. **The service's own alerts:** set `ALERT_WEBHOOK_URL` in the secrets file to a Slack, Discord,
   Mattermost or ntfy webhook. You then get a message when the daily model budget passes 70 / 90 / 100 %,
   when the language model keeps failing, and when the service starts. Messages never contain
   questions, answers or user ids. Without the variable the same alerts are only written to the log.
4. **Look at it:** `https://campus.example.edu/rag/admin/metrics` (admin token) shows time per stage,
   outcomes and estimated cost since the last restart. Logs: `docker compose logs -f rag` (one JSON
   line per request and per question).
5. **Drill (do it once):** set `LLM_CALLS_GLOBAL_PER_DAY=10` on staging, ask 8 questions, and confirm the
   70 % and 90 % messages arrive. Then stop the `rag` container and confirm the uptime monitor pages you.

## 6. Backups and restore

What is worth saving: Firestore (every student's chats and history, feedback, document records).
Document passages can be rebuilt by Reprocess; the PDFs themselves live in Supabase Storage.

```bash
# Daily backups kept for 14 days (Firestore managed backups)
gcloud firestore backups schedules create --database='(default)' --recurrence=daily --retention=14d --project <project-id>
```

Also enable point-in-time recovery in the Firestore console (Disaster recovery) if your plan allows it.

**Restore drill (do it once, on staging, and write down the time):**

```bash
gcloud firestore backups list --project <staging-project-id>
gcloud firestore databases restore --source-backup=<backup path> --destination-database=restored-test --project <staging-project-id>
```

Check that `restored-test` has `documents`, `chats` and `user_questions`, then delete it. A restore
creates a NEW database; to use it, point the services at it (`FIRESTORE_DATABASE_ID` is not
supported by this code yet: for a real recovery plan on restoring into `(default)` with an export/import:
`gcloud firestore export` then `gcloud firestore import`).

Supabase: use the project's backup feature, or keep a copy of the `documents` bucket
(`supabase storage` CLI or any S3-compatible sync). The PDFs are public documents you also hold elsewhere.

## 7. A staging copy (do this before the first real deployment)

Same steps with **separate** projects, so a mistake never touches students:

- a second Firebase project (`campus-intel-staging`), a second Supabase project, the same Gemini key
  with a low budget alert, a second domain (`staging.campus.example.edu`);
- its own secrets file and `deploy/.env`;
- a `.env` for the frontend build pointing at the staging addresses.

Keep the staging Firebase project in the same region as production. Never copy production student
data into staging.

## 8. If something goes wrong

| Symptom | Look at |
|---|---|
| Everyone gets "assistant not able to answer" | `docker compose logs rag`: Gemini key, quota, or Google outage. The alert webhook should have fired. |
| "Daily capacity reached" | The global budget: raise `LLM_CALLS_GLOBAL_PER_DAY` or look for abuse in the logs (one `userTag` dominating). |
| Uploads answer 503 | `SUPABASE_SERVICE_ROLE_KEY` missing in the secrets file. |
| Calendar says not configured | `TOKEN_ENCRYPTION_KEY` missing. |
| All students share one rate limit | `TRUSTED_PROXY_IPS` does not contain the Node container's address (the compose file sets it). |
| First question after a new document is slow | Normal for up to a minute: the search index rebuilds in the background. |
| A student quotes "(ref abcd1234)" | `docker compose logs rag node-api | grep abcd1234` finds the failing request. |
