# Retrieval evaluation: hard-rerank

> **SYNTHETIC DATA.** This dataset is invented and was written by the same author as the corpus, so it is
> easier than real student questions. These numbers show the harness works and give a rough comparison between
> retrievers. They are **not** a measurement of the system on your real documents.

> **Warning:** Only 20 answerable questions (recommended minimum 30). Differences between runs are likely to be noise; look at the confidence intervals.

> **Warning:** Only 8 unanswerable questions (recommended minimum 15). Refusal/abstention figures are very rough.

## Setup

- Dataset: 12 pages, 20 answerable + 8 unanswerable questions (fingerprint `8d7560874e9e`)
- Retriever: `rerank` using `BAAI/bge-small-en-v1.5` (384-d, max 512 tokens)
- Chunking: 500 chars, 100 overlap, 23 chunks
- Follow-up questions are searched as: **typed (no follow-up handling)**
- Code version: `9ce9dc0` | run: 2026-11-24 18:55

## Retrieval quality (answerable questions only)

Mean [95% bootstrap confidence interval]. k counts chunks; production gives the model the top 5.

| k | hit rate | recall | nDCG |
|---|---|---|---|
| 1 | 0.850 [0.700, 1.000] | 0.850 [0.700, 1.000] | 0.850 [0.700, 1.000] |
| 3 | 0.850 [0.700, 1.000] | 0.850 [0.700, 1.000] | 0.850 [0.700, 1.000] |
| 5 | 0.950 [0.850, 1.000] | 0.950 [0.850, 1.000] | 0.889 [0.758, 1.000] |
| 10 | 1.000 [1.000, 1.000] | 1.000 [1.000, 1.000] | 0.904 [0.802, 1.000] |

**MRR:** 0.876 [0.745, 1.000]

Hit rate = share of questions with at least one gold page in the top k. Recall = share of the gold pages found. Gold is labelled per page, so results stay comparable when chunking changes.

## By question type (recall@5, MRR)

| type | n | hit@5 | recall@5 | MRR |
|---|---|---|---|---|
| deadline | 1 | 1.000 | 1.000 | 0.200 |
| eligibility | 4 | 1.000 | 1.000 | 0.800 |
| fact | 8 | 0.875 | 0.875 | 0.891 |
| numeric | 5 | 1.000 | 1.000 | 1.000 |
| procedure | 2 | 1.000 | 1.000 | 1.000 |

## Can the top retrieval score tell answerable from unanswerable questions?

**AUC = 0.662** (0.5 means the score cannot separate them at all, 1.0 means it separates them perfectly).

- top score, answerable questions: min 0.439, median 0.600, max 0.702
- top score, unanswerable questions: min 0.368, median 0.569, max 0.645

| relevance floor | answerable kept | unanswerable refused |
|---|---|---|
| 0.30 | 100% | 0% |
| 0.35 | 100% | 0% |
| 0.40 | 100% | 12% |
| 0.45 | 95% | 12% |
| 0.50 | 85% | 38% |
| 0.55 | 70% | 38% |
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

- **h15** (fact) what happens if i get caught cheating
  - gold: exam_regulations p.1 | first gold at rank: 8
  - top 3 retrieved: attendance_rules p.1 (0.4393); hostel_rules p.1 (0.4184); scholarships p.2 (0.5499)

## Speed

- query latency (question embedding + search): p50 292.5 ms, p95 361.0 ms
- indexing the corpus: 1.1 s
