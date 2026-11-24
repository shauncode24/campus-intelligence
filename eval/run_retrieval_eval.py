"""
Evaluate retrieval on a question set.

  python eval/run_retrieval_eval.py \\
      --pages eval/examples/synthetic_demo/pages.jsonl \\
      --questions eval/examples/synthetic_demo/questions.jsonl \\
      --retriever production --embedding-backend bge-small --name bge-small

Run it with the backend's Python (it needs torch/transformers), from the repo
root. It writes eval/results/<name>.json and <name>.md. See eval/README.md.

Exit codes: 0 ok, 2 invalid dataset, 3 regression versus --compare baseline.
"""
import argparse
import json
import math
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import dataset  # noqa: E402
import evaluate as ev  # noqa: E402


def git_commit():
    try:
        return subprocess.run(["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True,
                              cwd=HERE, timeout=10).stdout.strip() or None
    except Exception:
        return None


def header_comments(path):
    lines = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            if line.startswith("#"):
                lines.append(line.lstrip("# ").strip())
            elif line.strip():
                break
    return lines


def fmt(x):
    return "n/a" if x is None or (isinstance(x, float) and math.isnan(x)) else f"{x:.3f}"


def ci(stat):
    return f"{fmt(stat['mean'])} [{fmt(stat['ci95'][0])}, {fmt(stat['ci95'][1])}]"


def render_markdown(report):
    r, meta = report["results"], report["meta"]
    out = [f"# Retrieval evaluation: {meta['name']}", ""]
    if meta["synthetic"]:
        out += ["> **SYNTHETIC DATA.** This dataset is invented and was written by the same author as the corpus, so it is",
                "> easier than real student questions. These numbers show the harness works and give a rough comparison between",
                "> retrievers. They are **not** a measurement of the system on your real documents.", ""]
    for w in meta["warnings"]:
        out += [f"> **Warning:** {w}", ""]
    c = r["retriever"]
    out += ["## Setup", "",
            f"- Dataset: {meta['n_pages']} pages, {r['counts']['answerable']} answerable + {r['counts']['unanswerable']} unanswerable questions (fingerprint `{meta['dataset_fingerprint']}`)",
            f"- Retriever: `{c['retriever']}`" + (f" using `{c['embedding_model']}` ({c['embedding_dimension']}-d, max {c['embedding_max_tokens']} tokens)" if "embedding_model" in c else ""),
            f"- Chunking: {c['chunk_size']} chars, {c['chunk_overlap']} overlap, {c['num_chunks']} chunks",
            f"- Follow-up questions are searched as: **{ {'raw': 'typed (no follow-up handling)', 'oracle': 'the hand-written ideal rewrite', 'rewrite': 'the production rewriter'}[meta['followups']] }**",
            f"- Code version: `{meta['git_commit']}` | run: {meta['date']}", ""]

    out += ["## Retrieval quality (answerable questions only)", "",
            "Mean [95% bootstrap confidence interval]. k counts chunks; production gives the model the top 5.", "",
            "| k | hit rate | recall | nDCG |", "|---|---|---|---|"]
    for k in ev.KS:
        rt = r["retrieval"]
        out.append(f"| {k} | {ci(rt[f'hit@{k}'])} | {ci(rt[f'recall@{k}'])} | {ci(rt[f'ndcg@{k}'])} |")
    out += ["", f"**MRR:** {ci(r['retrieval']['mrr'])}", "",
            "Hit rate = share of questions with at least one gold page in the top k. Recall = share of the gold pages found. "
            "Gold is labelled per page, so results stay comparable when chunking changes.", ""]

    out += ["## By question type (recall@5, MRR)", "", "| type | n | hit@5 | recall@5 | MRR |", "|---|---|---|---|---|"]
    for t, row in r["by_type"].items():
        out.append(f"| {t} | {row['n']} | {fmt(row['hit@5'])} | {fmt(row['recall@5'])} | {fmt(row['mrr'])} |")
    out.append("")

    a = r["abstention"]
    out += ["## Can the top retrieval score tell answerable from unanswerable questions?", "",
            f"**AUC = {fmt(a['auc'])}** (0.5 means the score cannot separate them at all, 1.0 means it separates them perfectly).", ""]
    if a["answerable_top_score"]:
        out.append(f"- top score, answerable questions: min {fmt(a['answerable_top_score']['min'])}, median {fmt(a['answerable_top_score']['median'])}, max {fmt(a['answerable_top_score']['max'])}")
    if a["unanswerable_top_score"]:
        out.append(f"- top score, unanswerable questions: min {fmt(a['unanswerable_top_score']['min'])}, median {fmt(a['unanswerable_top_score']['median'])}, max {fmt(a['unanswerable_top_score']['max'])}")
    if a["sweep"]:
        out += ["", "| relevance floor | answerable kept | unanswerable refused |", "|---|---|---|"]
        for row in a["sweep"]:
            out.append(f"| {row['floor']:.2f} | {row['answerable_kept']:.0%} | {row['unanswerable_refused']:.0%} |")
        if "production_relevance_floor" in c:
            out.append(f"\nProduction floor (`MIN_RETRIEVAL_SCORE`) is currently {c['production_relevance_floor']}.")
    out.append("")

    out += ["## Failures: answerable questions whose gold page is not in the top 5", ""]
    if not r["failures"]:
        out.append("None.")
    for f in r["failures"]:
        gold = ", ".join(f"{d} p.{p}" for d, p in f["gold"])
        top = "; ".join(f"{d} p.{p} ({s})" for d, p, s in f["top_retrieved"])
        out.append(f"- **{f['id']}** ({f['type']}) {f['question']}\n  - gold: {gold} | first gold at rank: {f['first_gold_rank'] or 'not in top 10'}\n  - top 3 retrieved: {top}")
    out += ["", "## Speed", "",
            f"- query latency (question embedding + search): p50 {r['latency_ms']['p50']:.1f} ms, p95 {r['latency_ms']['p95']:.1f} ms",
            f"- indexing the corpus: {r['build_seconds']:.1f} s", ""]
    return "\n".join(out)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pages", required=True)
    ap.add_argument("--questions", required=True)
    ap.add_argument("--retriever", default="production", choices=["production", "bm25", "hybrid", "rerank"])
    ap.add_argument("--embedding-backend", default=None, help="bge-small | clip (production retriever only)")
    ap.add_argument("--followups", default="raw", choices=ev.FOLLOWUP_MODES,
                    help="raw: follow-ups searched as typed | oracle: hand-written ideal rewrite | "
                         "rewrite: the production rewriter (CALLS GEMINI, needs --env-file and --yes)")
    ap.add_argument("--env-file", default=None, help="secrets file with GOOGLE_API_KEY (only for --followups rewrite)")
    ap.add_argument("--yes", action="store_true", help="confirm that --followups rewrite may spend Gemini calls")
    ap.add_argument("--name", default=None)
    ap.add_argument("--out", default=os.path.join(HERE, "results"))
    ap.add_argument("--compare", default=None, help="baseline report .json; exit 3 if quality dropped")
    ap.add_argument("--max-drop", type=float, default=0.05)
    args = ap.parse_args()

    pages = dataset.load_pages(args.pages)
    questions = dataset.load_questions(args.questions)
    errors = dataset.validate(pages, questions)
    if errors:
        print("Dataset is invalid:")
        for e in errors:
            print("  -", e)
        return 2

    rewrite = None
    if args.followups == "rewrite":
        n_calls = sum(1 for q in questions if q["type"] == "follow_up")
        if not (args.env_file and args.yes):
            print(f"--followups rewrite makes up to {n_calls} real Gemini calls (one per follow-up question).\n"
                  "Pass --env-file <your secrets file> --yes to allow it.")
            return 2
        os.environ["EVAL_ENV_FILE"] = args.env_file

    from retrievers import RETRIEVERS
    cls = RETRIEVERS[args.retriever]
    retriever = cls() if args.retriever == "bm25" else cls(args.embedding_backend)

    if args.followups == "rewrite":
        from services.query_condenser import query_condenser
        rewrite = lambda question, history: query_condenser.condense(question, history).standalone  # noqa: E731

    results = ev.evaluate(pages, questions, retriever, followups=args.followups, rewrite=rewrite)
    name = args.name or (f"{args.retriever}-{args.embedding_backend}" if args.embedding_backend else args.retriever)
    if args.followups != "raw" and not args.name:
        name += f"-followups-{args.followups}"
    comments = header_comments(args.pages) + header_comments(args.questions)
    report = {
        "meta": {
            "name": name,
            "date": time.strftime("%Y-%m-%d %H:%M"),
            "git_commit": git_commit(),
            "dataset_fingerprint": dataset.file_fingerprint(args.pages, args.questions),
            "n_pages": len(pages),
            "synthetic": any("SYNTHETIC" in c.upper() for c in comments),
            "followups": args.followups,
            "warnings": dataset.size_warnings(questions),
        },
        "results": results,
    }

    os.makedirs(args.out, exist_ok=True)
    with open(os.path.join(args.out, f"{name}.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, default=float)
    with open(os.path.join(args.out, f"{name}.md"), "w", encoding="utf-8") as f:
        f.write(render_markdown(report))
    print(f"wrote {os.path.join(args.out, name)}.json / .md")

    rt = results["retrieval"]
    print(f"{name}: recall@5 {rt['recall@5']['mean']:.3f} | hit@5 {rt['hit@5']['mean']:.3f} | MRR {rt['mrr']['mean']:.3f} | "
          f"nDCG@5 {rt['ndcg@5']['mean']:.3f} | abstention AUC {results['abstention']['auc']:.3f}")

    if args.compare:
        with open(args.compare, encoding="utf-8") as f:
            baseline = json.load(f)["results"]
        ok, lines = ev.compare(baseline, results, args.max_drop)
        print(f"\nComparison with {args.compare} (max allowed drop {args.max_drop}):")
        print("\n".join(lines))
        if not ok:
            return 3
    return 0


if __name__ == "__main__":
    sys.exit(main())
