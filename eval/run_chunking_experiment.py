"""
Compare ways of cutting documents into passages, on the same questions, and report what each does
to retrieval (recall, hit rate, MRR, nDCG) with confidence intervals.

    backend\\venv\\Scripts\\python.exe eval\\run_chunking_experiment.py ^
        --pages <pages.jsonl> --questions <questions.jsonl> --name chunking-real

Defaults compare the production setting with larger/smaller passages, a title prefix, cross-page
passages and header stripping. Pass --configs <file.json> (a list of {"label": ..., "size": ...,
"overlap": ..., "title_prefix": ..., "cross_page": ..., "strip_headers": ...}) to test your own.

READ THIS: on the synthetic demo data the differences are NOT evidence of anything (12 pages, questions
written by the author of the text). The numbers matter only on the real golden set (see README).
A change is worth adopting only if its interval clearly separates from the production row.
"""
import argparse
import json
import os
import sys
import time

import dataset
import evaluate as ev

HERE = os.path.dirname(os.path.abspath(__file__))

DEFAULT_CONFIGS = [
    {"label": "production (500/100)"},
    {"label": "size 300/60", "size": 300, "overlap": 60},
    {"label": "size 800/150", "size": 800, "overlap": 150},
    {"label": "size 1200/200", "size": 1200, "overlap": 200},
    {"label": "no overlap (500/0)", "size": 500, "overlap": 0},
    {"label": "title prefix", "title_prefix": True},
    {"label": "cross-page passages", "cross_page": True},
    {"label": "strip headers/footers", "strip_headers": True},
    {"label": "title prefix + 800/150", "title_prefix": True, "size": 800, "overlap": 150},
]


def row_for(label, results):
    r = results["retrieval"]
    f = lambda k: f"{r[k]['mean']:.3f} [{r[k]['ci95'][0]:.2f}-{r[k]['ci95'][1]:.2f}]"   # noqa: E731
    return f"| {label} | {f('recall@5')} | {f('hit@5')} | {f('mrr')} | {f('ndcg@5')} |"


def verdicts(rows, key="recall@5"):
    """For each configuration after the first (the baseline): does its interval clearly beat/lose to the baseline's?"""
    base = rows[0]["results"]["retrieval"][key]
    out = []
    for row in rows[1:]:
        s = row["results"]["retrieval"][key]
        if s["ci95"][0] > base["ci95"][1]:
            out.append((row["label"], "clearly better"))
        elif s["ci95"][1] < base["ci95"][0]:
            out.append((row["label"], "clearly worse"))
        else:
            out.append((row["label"], "no clear difference"))
    return out


def render(meta, rows):
    out = [f"# Chunking experiment: {meta['name']}", ""]
    if meta["synthetic"]:
        out += ["> **SYNTHETIC DATA: the differences below are NOT evidence.** Run this on the real golden set.", ""]
    for w in meta["warnings"]:
        out.append(f"> Warning: {w}")
    out += ["", f"- date: {meta['date']}  commit: {meta['git_commit']}  dataset: {meta['dataset_fingerprint']}", "",
            "| configuration | recall@5 | hit@5 | MRR | nDCG@5 |", "|---|---|---|---|---|"]
    out += [row_for(r["label"], r["results"]) for r in rows]
    out += ["", "## Versus the production setting (recall@5, 95% intervals)", ""]
    out += [f"- {label}: **{verdict}**" for label, verdict in verdicts(rows)]
    out += ["", "## What each configuration produced", ""]
    out += [f"- {r['label']}: {r['results']['meta_chunks']} passages" for r in rows]
    return "\n".join(out) + "\n"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pages", required=True)
    ap.add_argument("--questions", required=True)
    ap.add_argument("--embedding-backend", default=None)
    ap.add_argument("--configs", default=None)
    ap.add_argument("--name", default="chunking")
    ap.add_argument("--out", default=os.path.join(HERE, "results"))
    args = ap.parse_args()

    pages, questions = dataset.load_pages(args.pages), dataset.load_questions(args.questions)
    errors = dataset.validate(pages, questions)
    if errors:
        print("Dataset is invalid:")
        print("\n".join("  - " + e for e in errors))
        return 2
    configs = DEFAULT_CONFIGS
    if args.configs:
        with open(args.configs, encoding="utf-8") as f:
            configs = json.load(f)

    from chunking import ChunkingRetriever
    from run_retrieval_eval import git_commit, header_comments
    rows = []
    for cfg in configs:
        options = {k: v for k, v in cfg.items() if k != "label"}
        retriever = ChunkingRetriever(args.embedding_backend, **options)
        results = ev.evaluate(pages, questions, retriever)
        results["meta_chunks"] = len(retriever.chunks)
        rows.append({"label": cfg["label"], "config": options, "results": results})
        print(f"{cfg['label']}: recall@5 {results['retrieval']['recall@5']['mean']:.3f} ({len(retriever.chunks)} passages)")

    comments = header_comments(args.pages) + header_comments(args.questions)
    meta = {"name": args.name, "date": time.strftime("%Y-%m-%d %H:%M"), "git_commit": git_commit(),
            "dataset_fingerprint": dataset.file_fingerprint(args.pages, args.questions),
            "synthetic": any("SYNTHETIC" in c.upper() for c in comments), "warnings": dataset.size_warnings(questions)}
    os.makedirs(args.out, exist_ok=True)
    with open(os.path.join(args.out, f"{args.name}.json"), "w", encoding="utf-8") as f:
        json.dump({"meta": meta, "rows": rows}, f, indent=2, default=float)
    with open(os.path.join(args.out, f"{args.name}.md"), "w", encoding="utf-8") as f:
        f.write(render(meta, rows))
    print(f"wrote {os.path.join(args.out, args.name)}.json / .md")
    return 0


if __name__ == "__main__":
    sys.exit(main())
