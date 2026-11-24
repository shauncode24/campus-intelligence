# Retrieval evaluation: hard-hybrid

> **SYNTHETIC DATA.** This dataset is invented and was written by the same author as the corpus, so it is
> easier than real student questions. These numbers show the harness works and give a rough comparison between
> retrievers. They are **not** a measurement of the system on your real documents.

> **Warning:** Only 20 answerable questions (recommended minimum 30). Differences between runs are likely to be noise; look at the confidence intervals.

> **Warning:** Only 8 unanswerable questions (recommended minimum 15). Refusal/abstention figures are very rough.

## Setup

- Dataset: 12 pages, 20 answerable + 8 unanswerable questions (fingerprint `8d7560874e9e`)
- Retriever: `hybrid` using `BAAI/bge-small-en-v1.5` (384-d, max 512 tokens)
- Chunking: 500 chars, 100 overlap, 23 chunks
- Follow-up questions are searched as: **typed (no follow-up handling)**
- Code version: `9ce9dc0` | run: 2026-11-24 18:54

## Retrieval quality (answerable questions only)

Mean [95% bootstrap confidence interval]. k counts chunks; production gives the model the top 5.

| k | hit rate | recall | nDCG |
|---|---|---|---|
| 1 | 0.700 [0.500, 0.900] | 0.700 [0.500, 0.900] | 0.700 [0.500, 0.900] |
| 3 | 0.900 [0.750, 1.000] | 0.900 [0.750, 1.000] | 0.807 [0.650, 0.938] |
| 5 | 0.950 [0.850, 1.000] | 0.950 [0.850, 1.000] | 0.828 [0.693, 0.947] |
| 10 | 1.000 [1.000, 1.000] | 1.000 [1.000, 1.000] | 0.845 [0.730, 0.947] |

**MRR:** 0.795 [0.643, 0.929]

Hit rate = share of questions with at least one gold page in the top k. Recall = share of the gold pages found. Gold is labelled per page, so results stay comparable when chunking changes.

## By question type (recall@5, MRR)

| type | n | hit@5 | recall@5 | MRR |
|---|---|---|---|---|
| deadline | 1 | 1.000 | 1.000 | 0.333 |
| eligibility | 4 | 0.750 | 0.750 | 0.494 |
| fact | 8 | 1.000 | 1.000 | 0.823 |
| numeric | 5 | 1.000 | 1.000 | 1.000 |
| procedure | 2 | 1.000 | 1.000 | 1.000 |

## Can the top retrieval score tell answerable from unanswerable questions?

**AUC = 0.681** (0.5 means the score cannot separate them at all, 1.0 means it separates them perfectly).

- top score, answerable questions: min 0.463, median 0.608, max 0.702
- top score, unanswerable questions: min 0.415, median 0.569, max 0.645

| relevance floor | answerable kept | unanswerable refused |
|---|---|---|
| 0.30 | 100% | 0% |
| 0.35 | 100% | 0% |
| 0.40 | 100% | 0% |
| 0.45 | 100% | 12% |
| 0.50 | 95% | 25% |
| 0.55 | 75% | 38% |
| 0.60 | 50% | 62% |
| 0.65 | 30% | 100% |
| 0.70 | 5% | 100% |
| 0.75 | 0% | 100% |
| 0.80 | 0% | 100% |
| 0.85 | 0% | 100% |
| 0.90 | 0% | 100% |
| 0.95 | 0% | 100% |

Production floor (`MIN_RETRIEVAL_SCORE`) is currently 0.5.

## Failures: answerable questions whose gold page is not in the top 5

- **h13** (eligibility) do i lose my free ride if my grades slip
  - gold: scholarships p.1 | first gold at rank: 7
  - top 3 retrieved: scholarships p.2 (0.6449); fee_policy p.2 (0.6055); placement_policy p.2 (0.5986)

## Speed

- query latency (question embedding + search): p50 21.7 ms, p95 33.5 ms
- indexing the corpus: 0.8 s
