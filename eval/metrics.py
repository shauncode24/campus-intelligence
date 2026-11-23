"""
Retrieval and statistics metrics. Pure Python, no dependencies, fully tested
(see tests/test_metrics.py, which checks them against hand-computed values).

Terminology
-----------
A *ranked list* is what a retriever returns for one question: chunks in rank
order, each represented by the (doc, page) it came from. Several chunks can
come from the same page, so the same page can appear more than once.

The *gold set* is the set of (doc, page) pairs that contain the answer. Gold is
labelled at PAGE level (not chunk level) on purpose: chunk boundaries change
whenever the chunker or embedder changes, but a page is stable, so results stay
comparable across experiments.

All k values are counted in CHUNKS, matching production (which gives the model
the top-5 chunks).
"""
import math
import random


def hit_rate_at_k(ranked, gold, k):
    """1.0 if at least one gold page appears in the top-k chunks, else 0.0."""
    return 1.0 if any(p in gold for p in ranked[:k]) else 0.0


def recall_at_k(ranked, gold, k):
    """Fraction of the gold pages that appear (at least once) in the top-k chunks."""
    if not gold:
        raise ValueError("recall is undefined for a question with no gold pages")
    return len(set(ranked[:k]) & set(gold)) / len(set(gold))


def reciprocal_rank(ranked, gold, k=None):
    """1 / (1-based rank of the first chunk from a gold page); 0 if none in the top-k."""
    for i, p in enumerate(ranked[:k] if k else ranked, start=1):
        if p in gold:
            return 1.0 / i
    return 0.0


def ndcg_at_k(ranked, gold, k):
    """
    nDCG@k with binary relevance, where each gold page is credited only the
    FIRST time it appears (a second chunk from the same page adds nothing).
    The ideal ranking puts every gold page at the top, once each.
    """
    gold = set(gold)
    if not gold:
        raise ValueError("nDCG is undefined for a question with no gold pages")
    seen = set()
    dcg = 0.0
    for i, p in enumerate(ranked[:k], start=1):
        if p in gold and p not in seen:
            seen.add(p)
            dcg += 1.0 / math.log2(i + 1)
    ideal = sum(1.0 / math.log2(i + 1) for i in range(1, min(k, len(gold)) + 1))
    return dcg / ideal


def mean(values):
    values = list(values)
    return sum(values) / len(values) if values else float("nan")


def percentile(values, p):
    """Linear-interpolated percentile (p in 0..100)."""
    values = sorted(values)
    if not values:
        return float("nan")
    if len(values) == 1:
        return values[0]
    pos = (len(values) - 1) * p / 100.0
    lo, hi = math.floor(pos), math.ceil(pos)
    return values[lo] + (values[hi] - values[lo]) * (pos - lo)


def bootstrap_ci(values, n_resamples=2000, seed=0, alpha=0.05):
    """
    Percentile bootstrap confidence interval for the mean. Deterministic (seeded)
    so a re-run of the same evaluation reports the same interval. With few
    questions the interval is wide; that is the point, report it.
    """
    values = list(values)
    if not values:
        return (float("nan"), float("nan"))
    rng = random.Random(seed)
    n = len(values)
    means = sorted(mean(rng.choices(values, k=n)) for _ in range(n_resamples))
    lo = means[int((alpha / 2) * n_resamples)]
    hi = means[min(int((1 - alpha / 2) * n_resamples), n_resamples - 1)]
    return (lo, hi)


def auc(positive_scores, negative_scores):
    """
    Probability that a random positive scores higher than a random negative
    (ties count half): the area under the ROC curve, via the Mann-Whitney U
    statistic. 0.5 = the score cannot tell the two groups apart, 1.0 = perfect.
    """
    pos, neg = list(positive_scores), list(negative_scores)
    if not pos or not neg:
        return float("nan")
    wins = 0.0
    for p in pos:
        for q in neg:
            if p > q:
                wins += 1.0
            elif p == q:
                wins += 0.5
    return wins / (len(pos) * len(neg))
