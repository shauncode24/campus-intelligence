"""
Choose the answer-cache similarity threshold from labelled question pairs.

The cache may answer a new question with a stored answer when the two questions are
"the same question". Too low a threshold serves WRONG answers (a false hit); too high
never reuses anything. This measures both on labelled pairs:

    {"a": ..., "b": ..., "same": true|false, "kind": "..."}

`same` = the two questions must share an answer (paraphrase, typo, case);
not `same` = they differ in a way that changes the answer (other subject, number,
programme, ...) and must NEVER share one.

Two views are reported for every threshold:
  * embedding only: cosine similarity of the two question vectors (what the threshold alone does);
  * as production uses it: same intent AND same entities (utils/entity_extractor) AND similarity.

A false hit is the costly error, so the recommendation is the LOWEST threshold at which the
production view has no false hits and a safety margin of 0.02 above the highest false-hit
similarity seen. With few pairs this is a starting point, not a guarantee, and the report
prints the confidence bound. Calibrate again on real near-duplicate questions from your logs.

    python eval/calibrate_cache.py --pairs eval/examples/synthetic_demo/cache_pairs.jsonl \
        --embedding-backend bge-small --name cache-threshold-bge-small
"""
import argparse
import json
import math
import os
import sys

for _stream in (sys.stdout, sys.stderr):      # the backend prints emoji; a Windows pipe defaults to cp1252
    try:
        _stream.reconfigure(encoding="utf-8")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from retrievers import load_backend  # noqa: E402

THRESHOLDS = [round(0.70 + 0.01 * i, 2) for i in range(0, 30)]
MARGIN = 0.02


def wilson_upper(k, n, z=1.96):
    """Upper bound of the 95% Wilson interval for a rate k/n."""
    if n == 0:
        return 1.0
    p = k / n
    denom = 1 + z * z / n
    centre = p + z * z / (2 * n)
    spread = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return min(1.0, (centre + spread) / denom)


def load_pairs(path):
    pairs = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            if line.strip():
                pairs.append(json.loads(line))
    return pairs


def measure(pairs, embed, detect_intent, extract_entities, entities_match):
    rows = []
    for p in pairs:
        va, vb = embed(p["a"]), embed(p["b"])
        sim = float(sum(x * y for x, y in zip(va, vb)))
        guard = (detect_intent(p["a"]) == detect_intent(p["b"])
                 and entities_match(extract_entities(p["a"]), extract_entities(p["b"])))
        rows.append({**p, "similarity": sim, "guard_ok": bool(guard)})
    return rows


def sweep(rows):
    same = [r for r in rows if r["same"]]
    diff = [r for r in rows if not r["same"]]
    out = []
    for t in THRESHOLDS:
        emb_hit = sum(r["similarity"] >= t for r in same)
        emb_false = sum(r["similarity"] >= t for r in diff)
        prod_hit = sum(r["similarity"] >= t and r["guard_ok"] for r in same)
        prod_false = sum(r["similarity"] >= t and r["guard_ok"] for r in diff)
        out.append({
            "threshold": t,
            "embedding_hit_rate": emb_hit / len(same), "embedding_false_hits": emb_false,
            "production_hit_rate": prod_hit / len(same), "production_false_hits": prod_false,
            "production_false_upper95": wilson_upper(prod_false, len(diff)),
        })
    return out, len(same), len(diff)


def recommend(rows):
    """Lowest threshold with no production false hits, kept MARGIN above the worst false hit."""
    diff = [r for r in rows if not r["same"] and r["guard_ok"]]
    worst = max((r["similarity"] for r in diff), default=0.0)
    return round(math.ceil((worst + MARGIN) * 100) / 100, 2), worst


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pairs", required=True)
    ap.add_argument("--embedding-backend", default="bge-small")
    ap.add_argument("--name", default="cache-threshold")
    args = ap.parse_args()

    load_backend(args.embedding_backend)
    from services.embedding_service import embedding_service
    from utils.entity_extractor import extract_entities, entities_match
    from utils.intent_detector import detect_intent

    rows = measure(load_pairs(args.pairs), lambda q: embedding_service.embed_query(q).tolist(),
                   detect_intent, extract_entities, entities_match)
    table, n_same, n_diff = sweep(rows)
    rec, worst = recommend(rows)

    out_dir = os.path.join(HERE, "results")
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, args.name + ".json"), "w", encoding="utf-8") as f:
        json.dump({"embedding_model": embedding_service.model_id, "recommended": rec,
                   "highest_false_hit_similarity": worst, "table": table, "pairs": rows}, f, indent=1)

    lines = [
        f"# Cache threshold calibration: {embedding_service.model_id}", "",
        f"**Synthetic labelled pairs, written by one author: {n_same} should-share, {n_diff} must-not-share. "
        "This is a starting point, not your real near-duplicate traffic.**", "",
        "| threshold | embedding only: hit rate | false hits | production (intent+entities+similarity): hit rate | false hits | false-hit rate, 95% upper bound |",
        "|---|---|---|---|---|---|",
    ]
    for r in table:
        lines.append(f"| {r['threshold']:.2f} | {r['embedding_hit_rate']:.2f} | {r['embedding_false_hits']} | "
                     f"{r['production_hit_rate']:.2f} | {r['production_false_hits']} | {r['production_false_upper95']:.2f} |")
    lines += ["", f"Highest similarity among must-not-share pairs that pass the entity/intent guard: **{worst:.3f}**.",
              f"Recommended threshold (that + {MARGIN} margin): **{rec:.2f}**.", "",
              "## Must-not-share pairs with the highest similarity (what the threshold has to stay above)", ""]
    for r in sorted((r for r in rows if not r["same"]), key=lambda r: -r["similarity"])[:12]:
        lines.append(f"- {r['similarity']:.3f}  guard={'pass' if r['guard_ok'] else 'blocked'}  [{r['kind']}]  "
                     f"\"{r['a']}\" vs \"{r['b']}\"")
    lines += ["", "## Should-share pairs with the lowest similarity (what a higher threshold would lose)", ""]
    for r in sorted((r for r in rows if r["same"]), key=lambda r: r["similarity"])[:8]:
        lines.append(f"- {r['similarity']:.3f}  guard={'pass' if r['guard_ok'] else 'blocked'}  [{r['kind']}]  "
                     f"\"{r['a']}\" vs \"{r['b']}\"")
    with open(os.path.join(out_dir, args.name + ".md"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
