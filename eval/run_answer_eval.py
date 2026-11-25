"""
Answer-level evaluation: is the answer right, does it cite the right page, does it refuse when it
should? (See answer_eval.py for exactly what is scored.)

    backend\\venv\\Scripts\\python.exe eval\\run_answer_eval.py ^
        --pages eval\\examples\\synthetic_demo\\pages.jsonl ^
        --questions eval\\examples\\synthetic_demo\\questions.jsonl ^
        --answerer extractive --name answers-extractive

    # the real model (REAL, PAID calls: one per question the relevance floor lets through)
    ... --answerer gemini --env-file C:\\Users\\you\\secrets\\campus-intel.env --yes

Exit codes: 0 ok, 2 invalid dataset or missing confirmation, 3 regression against --compare.
"""
import argparse
import json
import os
import sys
import time

import answer_eval as ae
import dataset

HERE = os.path.dirname(os.path.abspath(__file__))


def pct(stat):
    lo, hi = stat["ci"]
    return f"{stat['mean']:.1%} [{lo:.0%}-{hi:.0%}] (n={stat['n']})"


def render_markdown(report):
    m, s, rows = report["meta"], report["results"]["summary"], report["results"]["rows"]
    out = [f"# Answer evaluation: {m['name']}", ""]
    if m.get("synthetic"):
        out += ["> **SYNTHETIC DATA.** These numbers show the tooling works; they are not your baseline.", ""]
    for w in m.get("warnings", []):
        out.append(f"> Warning: {w}")
    out += ["", f"- date: {m['date']}  commit: {m['git_commit']}  dataset: {m['dataset_fingerprint']}",
            f"- answerer: {json.dumps(m['answerer'])}", f"- relevance floor: {m['min_score']}, top-k: {m['k']}", "",
            "## Answerable questions", "",
            f"- **correct** (every must_include present): {pct(s['answerable']['correct'])}",
            f"- false refusals: {pct(s['answerable']['false_refusal'])}",
            f"- cites a gold page (when answered): {pct(s['answerable']['cites_gold_when_answered'])}", "",
            "## Unanswerable questions", "",
            f"- **refused** (the right behaviour): {pct(s['unanswerable']['refused'])}",
            f"- hallucinated (answered anyway): {pct(s['unanswerable']['hallucinated'])}", "",
            "## Citations", "",
            f"- answers containing a fabricated citation: {pct(s['citations']['with_fabricated'])}",
            f"- answers with no checkable citation: {pct(s['citations']['uncited'])}", "",
            f"Time: {s['seconds']['total']} s total, p50 {s['seconds']['p50']:.2f} s, p95 {s['seconds']['p95']:.2f} s", "",
            "## Failures (read these, the percentages hide the story)", ""]
    failures = [r for r in rows if not r["correct"]]
    if not failures:
        out.append("None.")
    for r in failures:
        why = ("answered an unanswerable question" if not r["answerable"] else
               "refused although the documents answer it" if r["declined"] else "answer misses a required fact")
        out.append(f"- `{r['id']}` ({r['type']}): {why}")
        if r.get("answer"):
            out.append(f"  - answer: {str(r['answer']).strip()[:300]}")
    return "\n".join(out) + "\n"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pages", required=True)
    ap.add_argument("--questions", required=True)
    ap.add_argument("--answerer", default="extractive", choices=["extractive", "gemini"])
    ap.add_argument("--embedding-backend", default=None)
    ap.add_argument("--followups", default="raw", choices=["raw", "oracle"])
    ap.add_argument("--k", type=int, default=5)
    ap.add_argument("--min-score", type=float, default=None, help="relevance floor (default: the service's MIN_RETRIEVAL_SCORE)")
    ap.add_argument("--env-file", default=None, help="secrets file with GOOGLE_API_KEY (only for --answerer gemini)")
    ap.add_argument("--yes", action="store_true", help="confirm that --answerer gemini may spend real model calls")
    ap.add_argument("--name", default=None)
    ap.add_argument("--out", default=os.path.join(HERE, "results"))
    ap.add_argument("--compare", default=None, help="baseline report .json; exit 3 if quality dropped")
    ap.add_argument("--max-drop", type=float, default=0.05)
    args = ap.parse_args()

    pages, questions = dataset.load_pages(args.pages), dataset.load_questions(args.questions)
    errors = dataset.validate(pages, questions)
    if errors:
        print("Dataset is invalid:")
        print("\n".join("  - " + e for e in errors))
        return 2

    if args.answerer == "gemini":
        if not (args.env_file and args.yes):
            print(f"--answerer gemini makes up to {len(questions)} real, paid model calls.\n"
                  "Pass --env-file <your secrets file> --yes to allow it.")
            return 2
        os.environ["EVAL_ENV_FILE"] = args.env_file

    from retrievers import ProductionRetriever
    retriever = ProductionRetriever(args.embedding_backend)
    retriever.build(pages)
    min_score = args.min_score if args.min_score is not None else retriever.Config.MIN_RETRIEVAL_SCORE
    answerer = ae.ExtractiveAnswerer() if args.answerer == "extractive" else ae.GeminiAnswerer()

    results = ae.evaluate(pages, questions, retriever, answerer, k=args.k, min_score=min_score, followups=args.followups)
    name = args.name or f"answers-{args.answerer}"
    from run_retrieval_eval import git_commit, header_comments
    comments = header_comments(args.pages) + header_comments(args.questions)
    report = {"meta": {
        "name": name, "date": time.strftime("%Y-%m-%d %H:%M"), "git_commit": git_commit(),
        "dataset_fingerprint": dataset.file_fingerprint(args.pages, args.questions),
        "synthetic": any("SYNTHETIC" in c.upper() for c in comments), "warnings": dataset.size_warnings(questions),
        "answerer": {**answerer.describe(), **retriever.describe()}, "min_score": min_score, "k": args.k,
    }, "results": results}

    os.makedirs(args.out, exist_ok=True)
    with open(os.path.join(args.out, f"{name}.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, default=float)
    with open(os.path.join(args.out, f"{name}.md"), "w", encoding="utf-8") as f:
        f.write(render_markdown(report))
    s = results["summary"]
    print(f"wrote {os.path.join(args.out, name)}.json / .md")
    print(f"{name}: correct {s['answerable']['correct']['mean']:.3f} | false refusals {s['answerable']['false_refusal']['mean']:.3f} | "
          f"refused (unanswerable) {s['unanswerable']['refused']['mean']:.3f} | cites gold {s['answerable']['cites_gold_when_answered']['mean']:.3f}")

    if args.compare:
        with open(args.compare, encoding="utf-8") as f:
            baseline = json.load(f)["results"]["summary"]
        ok, lines = ae.compare(baseline, s, args.max_drop)
        print(f"\nComparison with {args.compare} (max allowed drop {args.max_drop}):")
        print("\n".join(lines))
        if not ok:
            return 3
    return 0


if __name__ == "__main__":
    sys.exit(main())
