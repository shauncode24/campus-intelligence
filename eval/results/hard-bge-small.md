# Retrieval evaluation: hard-bge-small

> **SYNTHETIC DATA.** This dataset is invented and was written by the same author as the corpus, so it is
> easier than real student questions. These numbers show the harness works and give a rough comparison between
> retrievers. They are **not** a measurement of the system on your real documents.

> **Warning:** Only 20 answerable questions (recommended minimum 30). Differences between runs are likely to be noise; look at the confidence intervals.

> **Warning:** Only 8 unanswerable questions (recommended minimum 15). Refusal/abstention figures are very rough.

## Setup

- Dataset: 12 pages, 20 answerable + 8 unanswerable questions (fingerprint `8d7560874e9e`)
- Retriever: `production` using `BAAI/bge-small-en-v1.5` (384-d, max 512 tokens)
- Chunking: 500 chars, 100 overlap, 23 chunks
- Follow-up questions are searched as: **typed (no follow-up handling)**
- Code version: `9ce9dc0` | run: 2026-11-24 18:54

## Retrieval quality (answerable questions only)

Mean [95% bootstrap confidence interval]. k counts chunks; production gives the model the top 5.

| k | hit rate | recall | nDCG |
|---|---|---|---|
| 1 | 0.600 [0.400, 0.800] | 0.600 [0.400, 0.800] | 0.600 [0.400, 0.800] |
| 3 | 0.800 [0.600, 0.950] | 0.800 [0.600, 0.950] | 0.726 [0.545, 0.895] |
| 5 | 0.900 [0.750, 1.000] | 0.900 [0.750, 1.000] | 0.769 [0.612, 0.906] |
| 10 | 0.950 [0.850, 1.000] | 0.950 [0.850, 1.000] | 0.786 [0.646, 0.911] |

**MRR:** 0.732 [0.571, 0.882]

Hit rate = share of questions with at least one gold page in the top k. Recall = share of the gold pages found. Gold is labelled per page, so results stay comparable when chunking changes.

## By question type (recall@5, MRR)

| type | n | hit@5 | recall@5 | MRR |
|---|---|---|---|---|
| deadline | 1 | 1.000 | 1.000 | 1.000 |
| eligibility | 4 | 0.750 | 0.750 | 0.786 |
| fact | 8 | 0.875 | 0.875 | 0.656 |
| numeric | 5 | 1.000 | 1.000 | 0.650 |
| procedure | 2 | 1.000 | 1.000 | 1.000 |

## Can the top retrieval score tell answerable from unanswerable questions?

**AUC = 0.738** (0.5 means the score cannot separate them at all, 1.0 means it separates them perfectly).

- top score, answerable questions: min 0.488, median 0.627, max 0.702
- top score, unanswerable questions: min 0.415, median 0.576, max 0.677

| relevance floor | answerable kept | unanswerable refused |
|---|---|---|
| 0.30 | 100% | 0% |
| 0.35 | 100% | 0% |
| 0.40 | 100% | 0% |
| 0.45 | 100% | 12% |
| 0.50 | 95% | 25% |
| 0.55 | 85% | 38% |
| 0.60 | 65% | 62% |
| 0.65 | 30% | 88% |
| 0.70 | 5% | 100% |
| 0.75 | 0% | 100% |
| 0.80 | 0% | 100% |
| 0.85 | 0% | 100% |
| 0.90 | 0% | 100% |
| 0.95 | 0% | 100% |

Production floor (`MIN_RETRIEVAL_SCORE`) is currently 0.5.

## Failures: answerable questions whose gold page is not in the top 5

- **h06** (fact) Block A Room 12 accounts
  - gold: fee_policy p.1 | first gold at rank: not in top 10
  - top 3 retrieved: hostel_rules p.2 (0.5936); placement_policy p.2 (0.5662); scholarships p.2 (0.5565)
- **h13** (eligibility) do i lose my free ride if my grades slip
  - gold: scholarships p.1 | first gold at rank: 7
  - top 3 retrieved: scholarships p.2 (0.6449); fee_policy p.2 (0.6055); placement_policy p.2 (0.5986)

## Speed

- query latency (question embedding + search): p50 25.5 ms, p95 39.4 ms
- indexing the corpus: 1.2 s
