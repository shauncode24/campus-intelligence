# Chunking experiment: chunking-synthetic

> **SYNTHETIC DATA: the differences below are NOT evidence.** Run this on the real golden set.

> Warning: Only 10 unanswerable questions (recommended minimum 15). Refusal/abstention figures are very rough.

- date: 2026-11-25 02:14  commit: 528c6b1  dataset: f7c6931f3826

| configuration | recall@5 | hit@5 | MRR | nDCG@5 |
|---|---|---|---|---|
| production (500/100) | 0.906 [0.78-1.00] | 0.906 [0.78-1.00] | 0.767 [0.64-0.88] | 0.795 [0.67-0.90] |
| size 300/60 | 0.906 [0.78-1.00] | 0.906 [0.78-1.00] | 0.821 [0.71-0.93] | 0.834 [0.72-0.93] |
| size 800/150 | 0.875 [0.75-0.97] | 0.875 [0.75-0.97] | 0.701 [0.56-0.83] | 0.734 [0.61-0.85] |
| size 1200/200 | 0.875 [0.75-0.97] | 0.875 [0.75-0.97] | 0.701 [0.56-0.83] | 0.734 [0.61-0.85] |
| no overlap (500/0) | 0.812 [0.69-0.94] | 0.812 [0.69-0.94] | 0.726 [0.59-0.86] | 0.732 [0.60-0.86] |
| title prefix | 0.875 [0.75-0.97] | 0.875 [0.75-0.97] | 0.722 [0.59-0.85] | 0.752 [0.63-0.87] |
| cross-page passages | 0.906 [0.78-1.00] | 0.906 [0.78-1.00] | 0.767 [0.64-0.88] | 0.795 [0.67-0.90] |
| strip headers/footers | 0.906 [0.78-1.00] | 0.906 [0.78-1.00] | 0.767 [0.64-0.88] | 0.795 [0.67-0.90] |
| title prefix + 800/150 | 0.844 [0.72-0.97] | 0.844 [0.72-0.97] | 0.708 [0.57-0.83] | 0.729 [0.59-0.85] |

## Versus the production setting (recall@5, 95% intervals)

- size 300/60: **no clear difference**
- size 800/150: **no clear difference**
- size 1200/200: **no clear difference**
- no overlap (500/0): **no clear difference**
- title prefix: **no clear difference**
- cross-page passages: **no clear difference**
- strip headers/footers: **no clear difference**
- title prefix + 800/150: **no clear difference**

## What each configuration produced

- production (500/100): 23 passages
- size 300/60: 30 passages
- size 800/150: 12 passages
- size 1200/200: 12 passages
- no overlap (500/0): 23 passages
- title prefix: 23 passages
- cross-page passages: 23 passages
- strip headers/footers: 23 passages
- title prefix + 800/150: 12 passages
