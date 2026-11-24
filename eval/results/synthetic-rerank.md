# Retrieval evaluation: synthetic-rerank

> **SYNTHETIC DATA.** This dataset is invented and was written by the same author as the corpus, so it is
> easier than real student questions. These numbers show the harness works and give a rough comparison between
> retrievers. They are **not** a measurement of the system on your real documents.

> **Warning:** Only 10 unanswerable questions (recommended minimum 15). Refusal/abstention figures are very rough.

## Setup

- Dataset: 12 pages, 32 answerable + 10 unanswerable questions (fingerprint `f7c6931f3826`)
- Retriever: `rerank` using `BAAI/bge-small-en-v1.5` (384-d, max 512 tokens)
- Chunking: 500 chars, 100 overlap, 23 chunks
- Follow-up questions are searched as: **typed (no follow-up handling)**
- Code version: `9ce9dc0` | run: 2026-11-24 18:56

## Retrieval quality (answerable questions only)

Mean [95% bootstrap confidence interval]. k counts chunks; production gives the model the top 5.

| k | hit rate | recall | nDCG |
|---|---|---|---|
| 1 | 0.812 [0.688, 0.938] | 0.781 [0.641, 0.906] | 0.812 [0.688, 0.938] |
| 3 | 0.938 [0.844, 1.000] | 0.922 [0.828, 1.000] | 0.871 [0.770, 0.957] |
| 5 | 0.938 [0.844, 1.000] | 0.938 [0.844, 1.000] | 0.879 [0.785, 0.965] |
| 10 | 1.000 [1.000, 1.000] | 1.000 [1.000, 1.000] | 0.900 [0.827, 0.968] |

**MRR:** 0.873 [0.777, 0.964]

Hit rate = share of questions with at least one gold page in the top k. Recall = share of the gold pages found. Gold is labelled per page, so results stay comparable when chunking changes.

## By question type (recall@5, MRR)

| type | n | hit@5 | recall@5 | MRR |
|---|---|---|---|---|
| deadline | 4 | 1.000 | 1.000 | 1.000 |
| eligibility | 4 | 1.000 | 1.000 | 1.000 |
| fact | 4 | 1.000 | 1.000 | 1.000 |
| follow_up | 8 | 0.750 | 0.750 | 0.492 |
| multi_doc | 2 | 1.000 | 1.000 | 1.000 |
| numeric | 7 | 1.000 | 1.000 | 1.000 |
| procedure | 3 | 1.000 | 1.000 | 1.000 |

## Can the top retrieval score tell answerable from unanswerable questions?

**AUC = 0.878** (0.5 means the score cannot separate them at all, 1.0 means it separates them perfectly).

- top score, answerable questions: min 0.460, median 0.699, max 0.855
- top score, unanswerable questions: min 0.334, median 0.529, max 0.636

| relevance floor | answerable kept | unanswerable refused |
|---|---|---|
| 0.30 | 100% | 0% |
| 0.35 | 100% | 10% |
| 0.40 | 100% | 20% |
| 0.45 | 100% | 30% |
| 0.50 | 91% | 40% |
| 0.55 | 84% | 60% |
| 0.60 | 78% | 70% |
| 0.65 | 69% | 100% |
| 0.70 | 50% | 100% |
| 0.75 | 31% | 100% |
| 0.80 | 12% | 100% |
| 0.85 | 3% | 100% |
| 0.90 | 0% | 100% |
| 0.95 | 0% | 100% |

Production floor (`MIN_RETRIEVAL_SCORE`) is currently 0.5.

## Failures: answerable questions whose gold page is not in the top 5

- **f03** (follow_up) And for seniors?
  - gold: hostel_rules p.2 | first gold at rank: 7
  - top 3 retrieved: scholarships p.1 (0.4598); scholarships p.1 (0.4891); hostel_rules p.1 (0.4617)
- **f05** (follow_up) How do I keep it?
  - gold: scholarships p.1 | first gold at rank: 8
  - top 3 retrieved: fee_policy p.1 (0.4976); fee_policy p.2 (0.4921); hostel_rules p.2 (0.473)

## Speed

- query latency (question embedding + search): p50 327.5 ms, p95 388.1 ms
- indexing the corpus: 0.7 s
