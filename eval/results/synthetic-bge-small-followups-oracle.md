# Retrieval evaluation: synthetic-bge-small-followups-oracle

> **SYNTHETIC DATA.** This dataset is invented and was written by the same author as the corpus, so it is
> easier than real student questions. These numbers show the harness works and give a rough comparison between
> retrievers. They are **not** a measurement of the system on your real documents.

> **Warning:** Only 10 unanswerable questions (recommended minimum 15). Refusal/abstention figures are very rough.

## Setup

- Dataset: 12 pages, 32 answerable + 10 unanswerable questions (fingerprint `f7c6931f3826`)
- Retriever: `production` using `BAAI/bge-small-en-v1.5` (384-d, max 512 tokens)
- Chunking: 500 chars, 100 overlap, 23 chunks
- Follow-up questions are searched as: **the hand-written ideal rewrite**
- Code version: `541c36d` | run: 2026-11-24 09:30

## Retrieval quality (answerable questions only)

Mean [95% bootstrap confidence interval]. k counts chunks; production gives the model the top 5.

| k | hit rate | recall | nDCG |
|---|---|---|---|
| 1 | 0.875 [0.750, 0.969] | 0.844 [0.719, 0.953] | 0.875 [0.750, 0.969] |
| 3 | 0.969 [0.906, 1.000] | 0.969 [0.906, 1.000] | 0.926 [0.844, 0.988] |
| 5 | 1.000 [1.000, 1.000] | 1.000 [1.000, 1.000] | 0.939 [0.877, 0.988] |
| 10 | 1.000 [1.000, 1.000] | 1.000 [1.000, 1.000] | 0.939 [0.877, 0.988] |

**MRR:** 0.919 [0.836, 0.984]

Hit rate = share of questions with at least one gold page in the top k. Recall = share of the gold pages found. Gold is labelled per page, so results stay comparable when chunking changes.

## By question type (recall@5, MRR)

| type | n | hit@5 | recall@5 | MRR |
|---|---|---|---|---|
| deadline | 4 | 1.000 | 1.000 | 0.812 |
| eligibility | 4 | 1.000 | 1.000 | 1.000 |
| fact | 4 | 1.000 | 1.000 | 0.833 |
| follow_up | 8 | 1.000 | 1.000 | 0.917 |
| multi_doc | 2 | 1.000 | 1.000 | 1.000 |
| numeric | 7 | 1.000 | 1.000 | 1.000 |
| procedure | 3 | 1.000 | 1.000 | 0.833 |

## Can the top retrieval score tell answerable from unanswerable questions?

**AUC = 0.988** (0.5 means the score cannot separate them at all, 1.0 means it separates them perfectly).

- top score, answerable questions: min 0.591, median 0.760, max 0.855
- top score, unanswerable questions: min 0.424, median 0.562, max 0.636

| relevance floor | answerable kept | unanswerable refused |
|---|---|---|
| 0.30 | 100% | 0% |
| 0.35 | 100% | 0% |
| 0.40 | 100% | 0% |
| 0.45 | 100% | 20% |
| 0.50 | 100% | 40% |
| 0.55 | 100% | 40% |
| 0.60 | 97% | 70% |
| 0.65 | 94% | 100% |
| 0.70 | 81% | 100% |
| 0.75 | 53% | 100% |
| 0.80 | 22% | 100% |
| 0.85 | 3% | 100% |
| 0.90 | 0% | 100% |
| 0.95 | 0% | 100% |

Production floor (`MIN_RETRIEVAL_SCORE`) is currently 0.5.

## Failures: answerable questions whose gold page is not in the top 5

None.

## Speed

- query latency (question embedding + search): p50 75.3 ms, p95 88.7 ms
- indexing the corpus: 3.1 s
