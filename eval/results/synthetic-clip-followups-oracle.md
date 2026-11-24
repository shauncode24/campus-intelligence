# Retrieval evaluation: synthetic-clip-followups-oracle

> **SYNTHETIC DATA.** This dataset is invented and was written by the same author as the corpus, so it is
> easier than real student questions. These numbers show the harness works and give a rough comparison between
> retrievers. They are **not** a measurement of the system on your real documents.

> **Warning:** Only 10 unanswerable questions (recommended minimum 15). Refusal/abstention figures are very rough.

## Setup

- Dataset: 12 pages, 32 answerable + 10 unanswerable questions (fingerprint `f7c6931f3826`)
- Retriever: `production` using `openai/clip-vit-base-patch32` (512-d, max 77 tokens)
- Chunking: 500 chars, 100 overlap, 23 chunks
- Follow-up questions are searched as: **the hand-written ideal rewrite**
- Code version: `541c36d` | run: 2026-11-24 09:29

## Retrieval quality (answerable questions only)

Mean [95% bootstrap confidence interval]. k counts chunks; production gives the model the top 5.

| k | hit rate | recall | nDCG |
|---|---|---|---|
| 1 | 0.062 [0.000, 0.156] | 0.062 [0.000, 0.156] | 0.062 [0.000, 0.156] |
| 3 | 0.375 [0.219, 0.531] | 0.359 [0.203, 0.531] | 0.244 [0.133, 0.359] |
| 5 | 0.562 [0.406, 0.750] | 0.547 [0.391, 0.719] | 0.324 [0.219, 0.435] |
| 10 | 0.969 [0.906, 1.000] | 0.969 [0.906, 1.000] | 0.462 [0.395, 0.534] |

**MRR:** 0.307 [0.229, 0.393]

Hit rate = share of questions with at least one gold page in the top k. Recall = share of the gold pages found. Gold is labelled per page, so results stay comparable when chunking changes.

## By question type (recall@5, MRR)

| type | n | hit@5 | recall@5 | MRR |
|---|---|---|---|---|
| deadline | 4 | 0.250 | 0.250 | 0.234 |
| eligibility | 4 | 1.000 | 1.000 | 0.550 |
| fact | 4 | 0.250 | 0.250 | 0.186 |
| follow_up | 8 | 0.500 | 0.500 | 0.357 |
| multi_doc | 2 | 1.000 | 0.750 | 0.375 |
| numeric | 7 | 0.571 | 0.571 | 0.233 |
| procedure | 3 | 0.667 | 0.667 | 0.236 |

## Can the top retrieval score tell answerable from unanswerable questions?

**AUC = 0.931** (0.5 means the score cannot separate them at all, 1.0 means it separates them perfectly).

- top score, answerable questions: min 0.707, median 0.871, max 0.915
- top score, unanswerable questions: min 0.746, median 0.799, max 0.848

| relevance floor | answerable kept | unanswerable refused |
|---|---|---|
| 0.30 | 100% | 0% |
| 0.35 | 100% | 0% |
| 0.40 | 100% | 0% |
| 0.45 | 100% | 0% |
| 0.50 | 100% | 0% |
| 0.55 | 100% | 0% |
| 0.60 | 100% | 0% |
| 0.65 | 100% | 0% |
| 0.70 | 100% | 0% |
| 0.75 | 97% | 10% |
| 0.80 | 97% | 50% |
| 0.85 | 81% | 100% |
| 0.90 | 12% | 100% |
| 0.95 | 0% | 100% |

Production floor (`MIN_RETRIEVAL_SCORE`) is currently 0.7.

## Failures: answerable questions whose gold page is not in the top 5

- **q01** (numeric) What is the late fee if I pay my tuition after the deadline?
  - gold: fee_policy p.1 | first gold at rank: 6
  - top 3 retrieved: scholarships p.1 (0.9); scholarships p.2 (0.869); fee_policy p.2 (0.8437)
- **q02** (numeric) Is there a cap on how much late fee I can be charged in one semester?
  - gold: fee_policy p.1 | first gold at rank: 6
  - top 3 retrieved: scholarships p.1 (0.8703); scholarships p.2 (0.8218); fee_policy p.2 (0.8177)
- **q03** (deadline) By what day of the month must semester tuition be cleared?
  - gold: fee_policy p.1 | first gold at rank: 8
  - top 3 retrieved: scholarships p.1 (0.9002); scholarships p.2 (0.8489); fee_policy p.2 (0.8401)
- **q04** (procedure) Can I pay my fees from my phone instead of going to the office?
  - gold: fee_policy p.1 | first gold at rank: 8
  - top 3 retrieved: scholarships p.1 (0.8653); scholarships p.2 (0.8379); fee_policy p.2 (0.8317)
- **q12** (deadline) When can I submit my hostel application?
  - gold: hostel_rules p.1 | first gold at rank: 6
  - top 3 retrieved: scholarships p.1 (0.8686); placement_policy p.1 (0.8381); fee_policy p.2 (0.8378)
- **q14** (fact) How late can first year students come back to the hostel in the evening?
  - gold: hostel_rules p.2 | first gold at rank: not in top 10
  - top 3 retrieved: scholarships p.1 (0.85); attendance_rules p.2 (0.8438); fee_policy p.2 (0.8371)
- **q15** (numeric) How much is the hostel security deposit and how long until I get it back?
  - gold: hostel_rules p.2 | first gold at rank: 10
  - top 3 retrieved: scholarships p.1 (0.8184); fee_policy p.2 (0.792); attendance_rules p.2 (0.7838)
- **q16** (fact) Can I keep an induction cooktop in my hostel room?
  - gold: hostel_rules p.2 | first gold at rank: 10
  - top 3 retrieved: hostel_rules p.1 (0.707); scholarships p.1 (0.7022); placement_policy p.1 (0.6866)
- **q17** (deadline) How many days after results do I have to ask for my paper to be rechecked?
  - gold: exam_regulations p.2 | first gold at rank: 7
  - top 3 retrieved: scholarships p.1 (0.8647); placement_policy p.1 (0.85); fee_policy p.2 (0.8309)
- **q19** (fact) From when can I download my hall ticket?
  - gold: exam_regulations p.1 | first gold at rank: 7
  - top 3 retrieved: scholarships p.1 (0.8397); attendance_rules p.2 (0.7973); fee_policy p.2 (0.7967)
- **f01** (follow_up) And what is the maximum?
  - gold: fee_policy p.1 | first gold at rank: 7
  - top 3 retrieved: scholarships p.1 (0.905); scholarships p.2 (0.8707); fee_policy p.2 (0.8449)
- **f03** (follow_up) And for seniors?
  - gold: hostel_rules p.2 | first gold at rank: 9
  - top 3 retrieved: scholarships p.1 (0.8332); scholarships p.2 (0.8164); fee_policy p.2 (0.8151)
- **f04** (follow_up) How long do I have to apply for it?
  - gold: exam_regulations p.2 | first gold at rank: 7
  - top 3 retrieved: scholarships p.1 (0.871); placement_policy p.1 (0.8551); attendance_rules p.1 (0.8325)
- **f08** (follow_up) Is it refundable?
  - gold: hostel_rules p.2 | first gold at rank: 8
  - top 3 retrieved: scholarships p.1 (0.8171); hostel_rules p.1 (0.8164); scholarships p.2 (0.8045)

## Speed

- query latency (question embedding + search): p50 66.2 ms, p95 88.0 ms
- indexing the corpus: 1.2 s
