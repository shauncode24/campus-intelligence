# Retrieval evaluation: synthetic-bm25-followups-oracle

> **SYNTHETIC DATA.** This dataset is invented and was written by the same author as the corpus, so it is
> easier than real student questions. These numbers show the harness works and give a rough comparison between
> retrievers. They are **not** a measurement of the system on your real documents.

> **Warning:** Only 10 unanswerable questions (recommended minimum 15). Refusal/abstention figures are very rough.

## Setup

- Dataset: 12 pages, 32 answerable + 10 unanswerable questions (fingerprint `f7c6931f3826`)
- Retriever: `bm25`
- Chunking: 500 chars, 100 overlap, 23 chunks
- Follow-up questions are searched as: **the hand-written ideal rewrite**
- Code version: `541c36d` | run: 2026-11-24 09:30

## Retrieval quality (answerable questions only)

Mean [95% bootstrap confidence interval]. k counts chunks; production gives the model the top 5.

| k | hit rate | recall | nDCG |
|---|---|---|---|
| 1 | 0.781 [0.625, 0.906] | 0.766 [0.609, 0.906] | 0.781 [0.625, 0.906] |
| 3 | 0.969 [0.906, 1.000] | 0.953 [0.875, 1.000] | 0.892 [0.804, 0.965] |
| 5 | 1.000 [1.000, 1.000] | 1.000 [1.000, 1.000] | 0.911 [0.850, 0.965] |
| 10 | 1.000 [1.000, 1.000] | 1.000 [1.000, 1.000] | 0.911 [0.850, 0.965] |

**MRR:** 0.881 [0.797, 0.953]

Hit rate = share of questions with at least one gold page in the top k. Recall = share of the gold pages found. Gold is labelled per page, so results stay comparable when chunking changes.

## By question type (recall@5, MRR)

| type | n | hit@5 | recall@5 | MRR |
|---|---|---|---|---|
| deadline | 4 | 1.000 | 1.000 | 0.875 |
| eligibility | 4 | 1.000 | 1.000 | 1.000 |
| fact | 4 | 1.000 | 1.000 | 1.000 |
| follow_up | 8 | 1.000 | 1.000 | 0.938 |
| multi_doc | 2 | 1.000 | 1.000 | 0.750 |
| numeric | 7 | 1.000 | 1.000 | 0.929 |
| procedure | 3 | 1.000 | 1.000 | 0.400 |

## Can the top retrieval score tell answerable from unanswerable questions?

**AUC = 0.988** (0.5 means the score cannot separate them at all, 1.0 means it separates them perfectly).

- top score, answerable questions: min 3.310, median 6.475, max 16.144
- top score, unanswerable questions: min 0.000, median 2.013, max 3.931

## Failures: answerable questions whose gold page is not in the top 5

None.

## Speed

- query latency (question embedding + search): p50 0.2 ms, p95 0.3 ms
- indexing the corpus: 0.0 s
