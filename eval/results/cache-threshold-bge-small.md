# Cache threshold calibration: BAAI/bge-small-en-v1.5

**Synthetic labelled pairs, written by one author: 35 should-share, 35 must-not-share. This is a starting point, not your real near-duplicate traffic.**

| threshold | embedding only: hit rate | false hits | production (intent+entities+similarity): hit rate | false hits | false-hit rate, 95% upper bound |
|---|---|---|---|---|---|
| 0.70 | 0.97 | 32 | 0.63 | 25 | 0.84 |
| 0.71 | 0.97 | 31 | 0.63 | 24 | 0.81 |
| 0.72 | 0.97 | 31 | 0.63 | 24 | 0.81 |
| 0.73 | 0.97 | 29 | 0.63 | 22 | 0.77 |
| 0.74 | 0.97 | 29 | 0.63 | 22 | 0.77 |
| 0.75 | 0.94 | 28 | 0.60 | 21 | 0.74 |
| 0.76 | 0.94 | 25 | 0.60 | 18 | 0.67 |
| 0.77 | 0.94 | 25 | 0.60 | 18 | 0.67 |
| 0.78 | 0.94 | 24 | 0.60 | 17 | 0.64 |
| 0.79 | 0.94 | 23 | 0.60 | 17 | 0.64 |
| 0.80 | 0.94 | 23 | 0.60 | 17 | 0.64 |
| 0.81 | 0.94 | 23 | 0.60 | 17 | 0.64 |
| 0.82 | 0.94 | 20 | 0.60 | 14 | 0.56 |
| 0.83 | 0.94 | 19 | 0.60 | 13 | 0.54 |
| 0.84 | 0.91 | 17 | 0.60 | 11 | 0.48 |
| 0.85 | 0.86 | 15 | 0.60 | 10 | 0.45 |
| 0.86 | 0.80 | 13 | 0.60 | 9 | 0.42 |
| 0.87 | 0.77 | 12 | 0.57 | 9 | 0.42 |
| 0.88 | 0.74 | 10 | 0.57 | 7 | 0.36 |
| 0.89 | 0.71 | 8 | 0.54 | 6 | 0.33 |
| 0.90 | 0.66 | 6 | 0.51 | 5 | 0.29 |
| 0.91 | 0.54 | 4 | 0.46 | 3 | 0.22 |
| 0.92 | 0.54 | 2 | 0.46 | 1 | 0.15 |
| 0.93 | 0.46 | 2 | 0.37 | 1 | 0.15 |
| 0.94 | 0.43 | 2 | 0.34 | 1 | 0.15 |
| 0.95 | 0.23 | 0 | 0.20 | 0 | 0.10 |
| 0.96 | 0.17 | 0 | 0.14 | 0 | 0.10 |
| 0.97 | 0.11 | 0 | 0.09 | 0 | 0.10 |
| 0.98 | 0.11 | 0 | 0.09 | 0 | 0.10 |
| 0.99 | 0.09 | 0 | 0.09 | 0 | 0.10 |

Highest similarity among must-not-share pairs that pass the entity/intent guard: **0.948**.
Recommended threshold (that + 0.02 margin): **0.97**.

## Must-not-share pairs with the highest similarity (what the threshold has to stay above)

- 0.948  guard=pass  [different subject]  "Is there a penalty at the university for a missed deadline?" vs "Is there a penalty at the faculty for a missed deadline?"
- 0.941  guard=blocked  [different number]  "Late fee of Rs. 200 per day: when does it start?" vs "Late fee of Rs. 2000 per day: when does it start?"
- 0.918  guard=pass  [different subject]  "Is a medical certificate needed for a missed exam?" vs "Is a medical certificate needed for a missed lecture?"
- 0.917  guard=pass  [different scope]  "What are the library opening hours?" vs "What are the library opening hours during exams?"
- 0.905  guard=pass  [different question]  "How long does the bonafide certificate take to issue?" vs "How long is the bonafide certificate valid?"
- 0.900  guard=pass  [different scope]  "What is the re-exam fee?" vs "What is the re-exam fee for the final year?"
- 0.898  guard=blocked  [different programme]  "What are the fees for semester 1 BTech?" vs "What are the fees for semester 1 MTech?"
- 0.897  guard=pass  [different subject]  "What is the re-exam fee?" vs "What is the re-evaluation fee?"
- 0.889  guard=blocked  [different number]  "What are the fees for sem 5?" vs "What are the fees for sem 6?"
- 0.881  guard=pass  [different subject]  "How many books can I borrow from the library?" vs "How many books can I borrow from the hostel library?"
- 0.879  guard=pass  [different subject]  "What documents are needed for admission?" vs "What documents are needed for hostel admission?"
- 0.871  guard=pass  [different subject]  "What documents are needed for admission?" vs "What documents are needed for a scholarship?"

## Should-share pairs with the lowest similarity (what a higher threshold would lose)

- 0.697  guard=blocked  [paraphrase]  "What are the library opening hours?" vs "library timings"
- 0.748  guard=pass  [typo]  "What is the late fee for tuition?" vs "What is the late fee for tuiton?"
- 0.831  guard=blocked  [paraphrase]  "What are the hostel visiting hours?" vs "When can visitors come to the hostel?"
- 0.843  guard=blocked  [paraphrase]  "What are the library opening hours?" vs "When does the library open and close?"
- 0.846  guard=blocked  [paraphrase]  "How many books can I borrow from the library?" vs "What is the borrowing limit at the library?"
- 0.852  guard=blocked  [paraphrase]  "What is the penalty for late submission of assignments?" vs "What happens if I submit an assignment late?"
- 0.858  guard=blocked  [paraphrase]  "What are the hostel visiting hours?" vs "hostel visitor timings"
- 0.867  guard=pass  [paraphrase]  "Where do I submit the leave application?" vs "To whom do I hand in a leave application?"
