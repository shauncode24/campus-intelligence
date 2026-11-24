# Evaluation harness

Answers one question objectively: **does a change make retrieval better or worse?**
Every retrieval experiment (a new embedding model, chunk size, hybrid search, a
reranker) should be run through this before it is trusted.

## Read this first: what is and is not measured yet

- **Included:** the harness, and a **synthetic** demo corpus (`examples/synthetic_demo/`,
  invented "Example Institute" policies, 12 pages, 34 questions). It proves the tooling
  works. It was written by one author, so its questions share vocabulary with the text and
  are **easier than real student questions**. Numbers from it are *not* your baseline.
- **Not included (needs you):** the **real golden set**. Real questions, with answers
  verified against your real documents by someone who knows them. Nobody else can create
  this, and until it exists the system's accuracy is unmeasured. See
  "Building the real golden set" below.
- **Retrieval only.** Answer-level scoring (correctness, faithfulness, citation accuracy,
  refusal behaviour of the LLM, cost per question) needs real Gemini calls and is still to
  do. Text retrieval and follow-up question handling are measured; **image retrieval is not**.

## Running it

From the repo root, with the backend's Python (it needs torch/transformers; no credentials
are needed and `backend/.env` is never loaded):

```
backend\venv\Scripts\python.exe eval\run_retrieval_eval.py ^
    --pages eval\examples\synthetic_demo\pages.jsonl ^
    --questions eval\examples\synthetic_demo\questions.jsonl ^
    --retriever production --embedding-backend bge-small --name my-run
```

| option | meaning |
|---|---|
| `--retriever production` | the real backend code: same chunker, embedding model and cosine ranking as the service |
| `--embedding-backend bge-small \| clip` | which embedding model `production` uses (run once per model to compare) |
| `--retriever bm25` | plain keyword search, a sanity reference ("does the embedding beat word matching?") |
| `--retriever hybrid` | **experiment (P2-2):** the production dense search + BM25 over the same chunks, fused with Reciprocal Rank Fusion (k=60, 50 candidates per list) |
| `--retriever rerank` | **experiment (P2-2):** production dense top-20 re-scored by a small cross-encoder (`cross-encoder/ms-marco-MiniLM-L-6-v2`, downloaded on first use, ~90 MB) |
| `--followups raw \| oracle \| rewrite` | how follow-up questions are searched: `raw` as typed (what happens with no follow-up handling), `oracle` with the hand-written ideal rewrite (the best a rewriter could do), `rewrite` with the real production rewriter (**calls Gemini**; refuses to run without `--env-file <secrets> --yes`) |
| `--compare baseline.json --max-drop 0.05` | regression gate: exit code 3 if recall@5, hit@5, nDCG@5 or MRR dropped by more than 0.05 |

Output goes to `eval/results/<name>.md` (readable) and `.json` (machine-readable, used by
`--compare`). Exit codes: `0` ok, `2` the dataset has labelling errors, `3` regression.

Cache-threshold calibration (P1-8): `python eval/calibrate_cache.py --pairs <pairs.jsonl> --embedding-backend bge-small --name my-cache`
measures, on labelled question pairs (`{"a","b","same","kind"}`), how many true paraphrases a similarity
threshold reuses and how many near-duplicates that need a different answer it wrongly reuses. The demo pairs
(`examples/synthetic_demo/cache_pairs.jsonl`) are synthetic; build a real set from real near-duplicate questions.

Unit tests (no models needed): `backend\venv\Scripts\python.exe -m unittest discover -s eval\tests`

## How to read a report

- **hit rate @k**: share of questions where at least one correct page is in the top k chunks.
  Production gives the model the top **5**.
- **recall @k**: share of the correct pages that were found (matters for multi-page answers).
- **MRR**: average of 1/rank of the first correct chunk (1.0 = always first).
- **nDCG @k**: like MRR but rewards finding every correct page and ranking them high.
- **[ ... ]**: 95% bootstrap confidence interval. **With few questions it is wide. If two
  runs' intervals overlap, you have not shown a difference.** The report prints a warning
  when the set is below 30 answerable / 15 unanswerable questions.
- **AUC (abstention)**: can the top retrieval score tell questions the documents *can*
  answer from ones they cannot? 0.5 = no, 1.0 = perfectly. The sweep table shows what a
  relevance floor (`MIN_RETRIEVAL_SCORE`) would keep and refuse, which is how that floor
  should be chosen.
- **Failures** lists every answerable question whose correct page was not in the top 5,
  with what was retrieved instead. Read these, they tell you what to fix.

Gold labels are at **page** level (not chunk level) so results stay comparable when the
chunker or embedder changes.

## Building the real golden set

1. **Collect real questions.** Ask students and staff directly (a short form, a WhatsApp
   poll, the office's most common emails). Aim for **at least 50 answerable and 25
   unanswerable**, and more is better: below ~100 total, differences between close
   systems will usually be noise. Do **not** copy raw questions out of the app's database
   without anonymising them (they can contain personal circumstances).
2. **Keep their wording.** Do not rewrite questions to echo the document's phrases; that
   makes retrieval look better than it is. Include typos, short forms and vague questions.
3. **Cover the types:** `fact`, `numeric`, `deadline`, `procedure`, `eligibility`,
   `multi_doc` (answer spans pages or documents), `follow_up` (a question that only makes
   sense after an earlier turn; add `history` (the earlier turns) and `standalone` (your ideal
   rewrite), and the harness shows how much the follow-up handling matters), and, importantly, unanswerable ones:
   `absent_in_domain` (a campus question the documents do not cover, the hard realistic
   case) and `out_of_scope` (unrelated). At least half of the unanswerable set should be
   `absent_in_domain`.
4. **Label each question** in `questions.jsonl`:
   ```json
   {"id": "q001", "question": "...", "type": "numeric", "answerable": true,
    "gold": [{"doc": "fee_policy", "page": 1}],
    "must_include": ["Rs. 200 per day"]}
   ```
   `gold` = every page that contains the answer. `must_include` = exact strings a correct
   answer has to contain. **`validate` checks that every `must_include` string literally
   appears on a gold page**, so a wrong label is rejected instead of silently skewing results.
5. **Build the corpus** (`pages.jsonl`, one line per page) from your real PDFs. Ids must be
   stable; page numbers are 1-based (what a student sees). Extract text the same way the
   service does (`page.get_text()` in PyMuPDF).
6. **Have a second person check** a sample of labels, especially `gold`.
7. **Freeze it.** Do not tune the system on the questions you report results on. Once you
   start fixing individual failures, keep a separate untouched set for the final numbers.
8. Commit `pages.jsonl` and `questions.jsonl` only if the documents may be shared; otherwise
   keep the real set outside git and point `--pages/--questions` at it.

## Roadmap for this folder

Done: dataset schema + mechanical label validation, retrieval metrics (hit/recall/MRR/nDCG)
with confidence intervals, abstention analysis, failure listing, latency, regression gate.

Still to build (audit P1-1): running the real rewriter on a real follow-up set, answer-level evaluation with Gemini (correctness proxy via
`must_include`, citation accuracy against gold pages, refusal accuracy, an LLM-judged
faithfulness score calibrated against human labels, tokens and cost per question), a
multi-turn set for follow-up questions, an image set, and a CI job that runs the gate.
