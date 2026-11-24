# Retrieval evaluation: synthetic-hybrid

> **SYNTHETIC DATA.** This dataset is invented and was written by the same author as the corpus, so it is
> easier than real student questions. These numbers show the harness works and give a rough comparison between
> retrievers. They are **not** a measurement of the system on your real documents.

> **Warning:** Only 10 unanswerable questions (recommended minimum 15). Refusal/abstention figures are very rough.

## Setup

- Dataset: 12 pages, 32 answerable + 10 unanswerable questions (fingerprint `f7c6931f3826`)
- Retriever: `hybrid` using `BAAI/bge-small-en-v1.5` (384-d, max 512 tokens)
- Chunking: 500 chars, 100 overlap, 23 chunks
- Follow-up questions are searched as: **typed (no follow-up handling)**
- Code version: `9ce9dc0` | run: 2026-11-24 18:55

## Retrieval quality (answerable questions only)

Mean [95% bootstrap confidence interval]. k counts chunks; production gives the model the top 5.

| k | hit rate | recall | nDCG |
|---|---|---|---|
| 1 | 0.750 [0.594, 0.875] | 0.719 [0.562, 0.859] | 0.750 [0.594, 0.875] |
| 3 | 0.875 [0.750, 0.969] | 0.875 [0.750, 0.969] | 0.829 [0.704, 0.934] |
| 5 | 0.938 [0.844, 1.000] | 0.938 [0.844, 1.000] | 0.854 [0.751, 0.942] |
| 10 | 0.969 [0.906, 1.000] | 0.969 [0.906, 1.000] | 0.864 [0.771, 0.944] |

**MRR:** 0.830 [0.720, 0.928]

Hit rate = share of questions with at least one gold page in the top k. Recall = share of the gold pages found. Gold is labelled per page, so results stay comparable when chunking changes.

## By question type (recall@5, MRR)

| type | n | hit@5 | recall@5 | MRR |
|---|---|---|---|---|
| deadline | 4 | 1.000 | 1.000 | 0.875 |
| eligibility | 4 | 1.000 | 1.000 | 1.000 |
| fact | 4 | 1.000 | 1.000 | 1.000 |
| follow_up | 8 | 0.750 | 0.750 | 0.509 |
| multi_doc | 2 | 1.000 | 1.000 | 1.000 |
| numeric | 7 | 1.000 | 1.000 | 1.000 |
| procedure | 3 | 1.000 | 1.000 | 0.667 |

## Can the top retrieval score tell answerable from unanswerable questions?

**AUC = 0.916** (0.5 means the score cannot separate them at all, 1.0 means it separates them perfectly).

- top score, answerable questions: min 0.504, median 0.705, max 0.855
- top score, unanswerable questions: min 0.424, median 0.543, max 0.623

| relevance floor | answerable kept | unanswerable refused |
|---|---|---|
| 0.30 | 100% | 0% |
| 0.35 | 100% | 0% |
| 0.40 | 100% | 0% |
| 0.45 | 100% | 20% |
| 0.50 | 100% | 40% |
| 0.55 | 91% | 50% |
| 0.60 | 78% | 80% |
| 0.65 | 72% | 100% |
| 0.70 | 56% | 100% |
| 0.75 | 31% | 100% |
| 0.80 | 12% | 100% |
| 0.85 | 3% | 100% |
| 0.90 | 0% | 100% |
| 0.95 | 0% | 100% |

Production floor (`MIN_RETRIEVAL_SCORE`) is currently 0.5.

## Failures: answerable questions whose gold page is not in the top 5

- **f03** (follow_up) And for seniors?
  - gold: hostel_rules p.2 | first gold at rank: not in top 10
  - top 3 retrieved: scholarships p.2 (0.5149); attendance_rules p.2 (0.4894); scholarships p.1 (0.4891)
- **f05** (follow_up) How do I keep it?
  - gold: scholarships p.1 | first gold at rank: 8
  - top 3 retrieved: exam_regulations p.1 (0.5774); placement_policy p.2 (0.5497); attendance_rules p.2 (0.5382)

## Speed

- query latency (question embedding + search): p50 22.7 ms, p95 25.4 ms
- indexing the corpus: 0.8 s
