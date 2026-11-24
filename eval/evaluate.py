"""
Run a retriever over a question set and compute the report. Retriever-agnostic
(see retrievers.py) and free of heavy dependencies, so it is unit-testable.
"""
import time
from collections import defaultdict

import metrics as m

KS = (1, 3, 5, 10)
PRODUCTION_K = 5            # production gives the model the top-5 chunks
SWEEP = [round(0.30 + 0.05 * i, 2) for i in range(14)]    # 0.30 .. 0.95


FOLLOWUP_MODES = ("raw", "oracle", "rewrite")


def query_text(q, followups, rewrite):
    """
    The text actually searched for. Only follow-up questions differ by mode:
      raw      the question exactly as typed (what happens with NO follow-up handling)
      oracle   the hand-written ideal standalone question (the best a rewriter could do)
      rewrite  what the production rewriter (a model call) produced: `rewrite(question, history)`
    """
    if q.get("type") != "follow_up" or followups == "raw":
        return q["question"]
    if followups == "oracle":
        return q["standalone"]
    if followups == "rewrite":
        return rewrite(q["question"], q["history"])
    raise ValueError(f"followups must be one of {FOLLOWUP_MODES}")


def evaluate(pages, questions, retriever, ks=KS, followups="raw", rewrite=None):
    """Returns a result dict (JSON-serialisable)."""
    if followups == "rewrite" and rewrite is None:
        raise ValueError("followups='rewrite' needs a rewrite(question, history) function")
    depth = max(ks)

    t0 = time.perf_counter()
    retriever.build(pages)
    build_seconds = time.perf_counter() - t0

    per_question = []
    for q in questions:
        searched = query_text(q, followups, rewrite)
        t0 = time.perf_counter()
        hits = retriever.search(searched, depth)
        latency_ms = (time.perf_counter() - t0) * 1000.0
        ranked = [(h["doc"], h["page"]) for h in hits]
        gold = {(g["doc"], g["page"]) for g in q.get("gold", [])}
        rec = {
            "id": q["id"],
            "question": q["question"],
            "searched": searched,
            "type": q["type"],
            "answerable": q["answerable"],
            "gold": sorted(gold),
            "top_score": hits[0]["score"] if hits else float("-inf"),
            "ranked": [(h["doc"], h["page"], round(h["score"], 4)) for h in hits],
            "latency_ms": latency_ms,
        }
        if q["answerable"]:
            rec["metrics"] = {
                "mrr": m.reciprocal_rank(ranked, gold, depth),
                **{f"hit@{k}": m.hit_rate_at_k(ranked, gold, k) for k in ks},
                **{f"recall@{k}": m.recall_at_k(ranked, gold, k) for k in ks},
                **{f"ndcg@{k}": m.ndcg_at_k(ranked, gold, k) for k in ks},
            }
        per_question.append(rec)

    answerable = [r for r in per_question if r["answerable"]]
    unanswerable = [r for r in per_question if not r["answerable"]]

    # ---- retrieval quality (answerable questions only) ----
    def summarise(rows, name):
        vals = [r["metrics"][name] for r in rows]
        lo, hi = m.bootstrap_ci(vals)
        return {"mean": m.mean(vals), "ci95": [lo, hi]}

    names = ["mrr"] + [f"{kind}@{k}" for kind in ("hit", "recall", "ndcg") for k in ks]
    retrieval = {n: summarise(answerable, n) for n in names} if answerable else {}

    by_type = {}
    types = defaultdict(list)
    for r in answerable:
        types[r["type"]].append(r)
    for t, rows in sorted(types.items()):
        by_type[t] = {
            "n": len(rows),
            "hit@5": m.mean(r["metrics"]["hit@5"] for r in rows),
            "recall@5": m.mean(r["metrics"]["recall@5"] for r in rows),
            "mrr": m.mean(r["metrics"]["mrr"] for r in rows),
        }

    # ---- can the top retrieval score tell answerable from unanswerable questions? ----
    pos = [r["top_score"] for r in answerable]
    neg = [r["top_score"] for r in unanswerable]
    abstention = {
        "auc": m.auc(pos, neg),
        "answerable_top_score": _dist(pos),
        "unanswerable_top_score": _dist(neg),
        "sweep": [],
    }
    if getattr(retriever, "score_kind", "other") == "cosine" and pos and neg:
        for floor in SWEEP:
            abstention["sweep"].append({
                "floor": floor,
                "answerable_kept": sum(s >= floor for s in pos) / len(pos),
                "unanswerable_refused": sum(s < floor for s in neg) / len(neg),
            })

    # ---- failure analysis: answerable questions whose gold is not in the production top-k ----
    failures = [
        {
            "id": r["id"], "question": r["question"], "type": r["type"],
            "gold": [list(g) for g in r["gold"]],
            "top_retrieved": [list(x[:2]) + [x[2]] for x in r["ranked"][:3]],
            "first_gold_rank": next((i + 1 for i, x in enumerate(r["ranked"]) if (x[0], x[1]) in set(r["gold"])), None),
        }
        for r in answerable if r["metrics"][f"hit@{PRODUCTION_K}"] == 0.0
    ]

    latencies = [r["latency_ms"] for r in per_question]
    return {
        "counts": {"answerable": len(answerable), "unanswerable": len(unanswerable)},
        "retrieval": retrieval,
        "by_type": by_type,
        "abstention": abstention,
        "failures": failures,
        "latency_ms": {"p50": m.percentile(latencies, 50), "p95": m.percentile(latencies, 95)},
        "build_seconds": build_seconds,
        "retriever": retriever.describe(),
        "followups": followups,
        "per_question": per_question,
    }


def _dist(values):
    if not values:
        return {}
    return {"min": min(values), "median": m.percentile(values, 50), "max": max(values)}


# ------------------------------------------------------------------ comparison

GATED_METRICS = ("recall@5", "hit@5", "ndcg@5", "mrr")


def compare(baseline, new, max_drop=0.05):
    """
    Regression gate. Returns (ok, lines). A metric fails if it dropped by more
    than `max_drop` (absolute) versus the baseline report. Remember that with a
    small question set a drop can be noise; use a set big enough for the
    confidence intervals to be narrow before trusting a gate.
    """
    lines, ok = [], True
    for name in GATED_METRICS:
        b = baseline["retrieval"].get(name, {}).get("mean")
        n = new["retrieval"].get(name, {}).get("mean")
        if b is None or n is None:
            lines.append(f"  {name:<10} missing in one of the reports")
            ok = False
            continue
        drop = b - n
        status = "FAIL" if drop > max_drop else "ok"
        if drop > max_drop:
            ok = False
        lines.append(f"  {name:<10} baseline {b:.3f} -> new {n:.3f}  ({-drop:+.3f})  {status}")
    return ok, lines
