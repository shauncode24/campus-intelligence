# Retrieval evaluation: hard-bm25

> **SYNTHETIC DATA.** This dataset is invented and was written by the same author as the corpus, so it is
> easier than real student questions. These numbers show the harness works and give a rough comparison between
> retrievers. They are **not** a measurement of the system on your real documents.

> **Warning:** Only 20 answerable questions (recommended minimum 30). Differences between runs are likely to be noise; look at the confidence intervals.

> **Warning:** Only 8 unanswerable questions (recommended minimum 15). Refusal/abstention figures are very rough.

## Setup

- Dataset: 12 pages, 20 answerable + 8 unanswerable questions (fingerprint `8d7560874e9e`)
- Retriever: `bm25`
- Chunking: 500 chars, 100 overlap, 23 chunks
- Follow-up questions are searched as: **typed (no follow-up handling)**
- Code version: `9ce9dc0` | run: 2026-11-24 18:53

## Retrieval quality (answerable questions only)

Mean [95% bootstrap confidence interval]. k counts chunks; production gives the model the top 5.

| k | hit rate | recall | nDCG |
|---|---|---|---|
| 1 | 0.650 [0.400, 0.850] | 0.650 [0.400, 0.850] | 0.650 [0.400, 0.850] |
| 3 | 0.800 [0.600, 0.950] | 0.800 [0.600, 0.950] | 0.738 [0.557, 0.888] |
| 5 | 0.800 [0.600, 0.950] | 0.800 [0.600, 0.950] | 0.738 [0.557, 0.888] |
| 10 | 0.850 [0.700, 1.000] | 0.850 [0.700, 1.000] | 0.753 [0.574, 0.903] |

**MRR:** 0.722 [0.538, 0.880]

Hit rate = share of questions with at least one gold page in the top k. Recall = share of the gold pages found. Gold is labelled per page, so results stay comparable when chunking changes.

## By question type (recall@5, MRR)

| type | n | hit@5 | recall@5 | MRR |
|---|---|---|---|---|
| deadline | 1 | 0.000 | 0.000 | 0.000 |
| eligibility | 4 | 0.500 | 0.500 | 0.400 |
| fact | 8 | 0.875 | 0.875 | 0.729 |
| numeric | 5 | 1.000 | 1.000 | 1.000 |
| procedure | 2 | 1.000 | 1.000 | 1.000 |

## Can the top retrieval score tell answerable from unanswerable questions?

**AUC = 0.806** (0.5 means the score cannot separate them at all, 1.0 means it separates them perfectly).

- top score, answerable questions: min 0.000, median 3.959, max 9.299
- top score, unanswerable questions: min 0.000, median 1.802, max 4.296

## Failures: answerable questions whose gold page is not in the top 5

- **h13** (eligibility) do i lose my free ride if my grades slip
  - gold: scholarships p.1 | first gold at rank: not in top 10
  - top 3 retrieved: fee_policy p.1 (0.0); fee_policy p.1 (0.0); fee_policy p.2 (0.0)
- **h15** (fact) what happens if i get caught cheating
  - gold: exam_regulations p.1 | first gold at rank: not in top 10
  - top 3 retrieved: fee_policy p.1 (0.0); fee_policy p.1 (0.0); fee_policy p.2 (0.0)
- **h17** (eligibility) who gets a room by themselves
  - gold: hostel_rules p.1 | first gold at rank: 10
  - top 3 retrieved: fee_policy p.1 (1.8076); hostel_rules p.2 (1.7903); fee_policy p.1 (0.0)
- **h19** (deadline) when will i know my marks
  - gold: exam_regulations p.1 | first gold at rank: not in top 10
  - top 3 retrieved: exam_regulations p.2 (3.8227); exam_regulations p.2 (3.0422); fee_policy p.1 (0.0)

## Speed

- query latency (question embedding + search): p50 0.1 ms, p95 0.1 ms
- indexing the corpus: 0.0 s
