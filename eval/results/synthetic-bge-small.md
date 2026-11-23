# Retrieval evaluation: synthetic-bge-small

> **SYNTHETIC DATA.** This dataset is invented and was written by the same author as the corpus, so it is
> easier than real student questions. These numbers show the harness works and give a rough comparison between
> retrievers. They are **not** a measurement of the system on your real documents.

> **Warning:** Only 24 answerable questions (recommended minimum 30). Differences between runs are likely to be noise; look at the confidence intervals.

> **Warning:** Only 10 unanswerable questions (recommended minimum 15). Refusal/abstention figures are very rough.

## Setup

- Dataset: 12 pages, 24 answerable + 10 unanswerable questions (fingerprint `f2f4cb840c86`)
- Retriever: `production` using `BAAI/bge-small-en-v1.5` (384-d, max 512 tokens)
- Chunking: 500 chars, 100 overlap, 23 chunks
- Code version: `2404c00` | run: 2026-11-24 00:48

## Retrieval quality (answerable questions only)

Mean [95% bootstrap confidence interval]. k counts chunks; production gives the model the top 5.

| k | hit rate | recall | nDCG |
|---|---|---|---|
| 1 | 0.875 [0.750, 1.000] | 0.833 [0.688, 0.958] | 0.875 [0.750, 1.000] |
| 3 | 0.958 [0.875, 1.000] | 0.958 [0.875, 1.000] | 0.922 [0.818, 1.000] |
| 5 | 1.000 [1.000, 1.000] | 1.000 [1.000, 1.000] | 0.940 [0.870, 1.000] |
| 10 | 1.000 [1.000, 1.000] | 1.000 [1.000, 1.000] | 0.940 [0.870, 1.000] |

**MRR:** 0.920 [0.826, 1.000]

Hit rate = share of questions with at least one gold page in the top k. Recall = share of the gold pages found. Gold is labelled per page, so results stay comparable when chunking changes.

## By question type (recall@5, MRR)

| type | n | hit@5 | recall@5 | MRR |
|---|---|---|---|---|
| deadline | 4 | 1.000 | 1.000 | 0.812 |
| eligibility | 4 | 1.000 | 1.000 | 1.000 |
| fact | 4 | 1.000 | 1.000 | 0.833 |
| multi_doc | 2 | 1.000 | 1.000 | 1.000 |
| numeric | 7 | 1.000 | 1.000 | 1.000 |
| procedure | 3 | 1.000 | 1.000 | 0.833 |

## Can the top retrieval score tell answerable from unanswerable questions?

**AUC = 0.983** (0.5 means the score cannot separate them at all, 1.0 means it separates them perfectly).

- top score, answerable questions: min 0.591, median 0.725, max 0.855
- top score, unanswerable questions: min 0.424, median 0.562, max 0.636

| relevance floor | answerable kept | unanswerable refused |
|---|---|---|
| 0.30 | 100% | 0% |
| 0.35 | 100% | 0% |
| 0.40 | 100% | 0% |
| 0.45 | 100% | 20% |
| 0.50 | 100% | 40% |
| 0.55 | 100% | 40% |
| 0.60 | 96% | 70% |
| 0.65 | 92% | 100% |
| 0.70 | 75% | 100% |
| 0.75 | 46% | 100% |
| 0.80 | 17% | 100% |
| 0.85 | 4% | 100% |
| 0.90 | 0% | 100% |
| 0.95 | 0% | 100% |

Production floor (`MIN_RETRIEVAL_SCORE`) is currently 0.5.

## Failures: answerable questions whose gold page is not in the top 5

None.

## Speed

- query latency (question embedding + search): p50 19.2 ms, p95 22.9 ms
- indexing the corpus: 2.5 s
