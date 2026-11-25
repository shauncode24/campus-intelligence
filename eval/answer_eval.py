"""
Answer-level evaluation (P1-1): not "was the right page found?" (retrieval evaluation does that)
but "was the ANSWER right, did it cite the right page, and did it refuse when it should?".

For every question the evaluation runs the production steps: retrieve the top k chunks, drop
chunks below the relevance floor (no chunk left = the service answers "not found" without calling
the model), give what is left to an *answerer*, and score the reply:

  answerable question     correct       the answer was not a refusal and contains EVERY must_include
                                        string (literal match, as in the dataset validation)
                          false refusal the service said "not found" although the documents answer it
                          cites gold    at least one citation that checks out points at a gold page
  unanswerable question   refused       the service declined (the right behaviour)
                          hallucinated  it answered anyway
  every answer            fabricated    citations naming a document/page the model was not shown
                          uncited       an answer with no checkable citation at all

Answerers: "extractive" (no model: the top passage with its citation; a deterministic floor that
proves the plumbing and gives a baseline), "gemini" (the real prompt and model: makes real, paid
calls), or any callable in tests.

must_include checking is deliberately strict and literal: it cannot tell a paraphrase from a wrong
answer. Treat "correct" as a lower bound and read the failures in the report.
"""
import os
import sys
import time

import dataset
import metrics

BACKEND_PY = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend", "python")
if BACKEND_PY not in sys.path:
    sys.path.insert(0, BACKEND_PY)

from utils.citation_check import check_citations  # noqa: E402  (pure module of the service)

NOT_FOUND = "NOT_FOUND"


def is_refusal(answer):
    """The refusal rule of the service's prompt: the reply is exactly the token (ignoring decoration)."""
    return str(answer or "").strip().strip("`*\"' .").upper().startswith(NOT_FOUND)


class ExtractiveAnswerer:
    """No model: quotes the best passage and cites it. A reproducible baseline, not a product."""
    name = "extractive"

    def answer(self, question, hits, titles):
        top = hits[0]
        return f"{top['text'].strip()} [{titles.get(top['doc'], top['doc'])}, p. {top['page']}]"

    def describe(self):
        return {"answerer": self.name}


class GeminiAnswerer:
    """The real prompt and model (paid calls). Needs the service's credentials (see run_answer_eval.py)."""
    name = "gemini"

    def __init__(self):
        from langchain_core.messages import HumanMessage
        from services.llm_service import llm_service, SYSTEM_PROMPT, _neutralize
        self._Human, self._llm, self._system, self._neutralize = HumanMessage, llm_service, SYSTEM_PROMPT, _neutralize

    def answer(self, question, hits, titles):
        context = "\n\n".join(
            f"[Source: {titles.get(h['doc'], h['doc'])}, p. {h['page']}]\n{self._neutralize(h['text'])}" for h in hits)
        message = self._Human(content=[
            {"type": "text", "text": f"<context>\n{context}\n</context>\n\n"},
            {"type": "text", "text": f"<question>\n{self._neutralize(question)}\n</question>\n\n"
                                     f"Answer using only the context above. If it does not contain the answer, "
                                     f"reply with exactly {NOT_FOUND}."},
        ])
        return self._llm.invoke_with_system(self._system, message)

    def describe(self):
        from config import Config
        return {"answerer": self.name, "model": Config.GEMINI_MODEL_NAME, "temperature": Config.GEMINI_TEMPERATURE}


def score_question(q, answer, hits, titles):
    """Score one reply. `answer` is None when the service would have declined without asking the model."""
    declined = answer is None or is_refusal(answer)
    shown = [{"documentName": titles.get(h["doc"], h["doc"]), "displayPage": h["page"]} for h in hits]
    row = {"id": q["id"], "type": q["type"], "answerable": q["answerable"], "declined": declined}

    if not q["answerable"]:
        row["correct"] = declined                    # refusing IS the right behaviour
        row["hallucinated"] = not declined
    else:
        text = dataset.normalize(answer or "")
        row["false_refusal"] = declined
        row["correct"] = (not declined) and all(dataset.normalize(s) in text for s in q["must_include"])

    if not declined:
        check = check_citations(answer, shown)
        gold = {(titles.get(g["doc"], g["doc"]).lower(), g["page"]) for g in q.get("gold", [])}
        row["fabricated_citations"] = check.removed
        row["uncited"] = check.uncited
        row["cites_gold"] = bool(q["answerable"] and any(
            (str(name).lower(), page) in gold for name, page in check.cited_pages))
    return row


def evaluate(pages, questions, retriever, answerer, k=5, min_score=0.5, followups="raw"):
    titles = {}
    for p in pages:
        titles.setdefault(p["doc"], p.get("title") or p["doc"])
    rows, started = [], time.time()
    for q in questions:
        text = q["standalone"] if (followups == "oracle" and q["type"] == "follow_up") else q["question"]
        t0 = time.time()
        hits = retriever.search(text, k)
        if getattr(retriever, "score_kind", "cosine") == "cosine":
            hits = [h for h in hits if h["score"] >= min_score]       # the service's relevance floor
        answer = answerer.answer(text, hits, titles) if hits else None  # nothing relevant: declined without a model call
        row = score_question(q, answer, hits, titles)
        row["seconds"] = round(time.time() - t0, 3)
        row["answer"] = answer
        rows.append(row)

    def rate(subset, field):
        values = [1.0 if r.get(field) else 0.0 for r in subset]
        lo, hi = metrics.bootstrap_ci(values)
        return {"mean": metrics.mean(values), "ci": [lo, hi], "n": len(values)}

    ans = [r for r in rows if r["answerable"]]
    unans = [r for r in rows if not r["answerable"]]
    answered = [r for r in rows if not r["declined"]]
    answered_ans = [r for r in ans if not r["declined"]]
    summary = {
        "answerable": {"n": len(ans), "correct": rate(ans, "correct"), "false_refusal": rate(ans, "false_refusal"),
                       "cites_gold_when_answered": rate(answered_ans, "cites_gold")},
        "unanswerable": {"n": len(unans), "refused": rate(unans, "correct"), "hallucinated": rate(unans, "hallucinated")},
        "citations": {"answers": len(answered),
                      "with_fabricated": rate([dict(r, f=r.get("fabricated_citations", 0) > 0) for r in answered], "f"),
                      "uncited": rate(answered, "uncited")},
        "seconds": {"total": round(time.time() - started, 2),
                    "p50": metrics.percentile([r["seconds"] for r in rows], 50),
                    "p95": metrics.percentile([r["seconds"] for r in rows], 95)},
    }
    return {"summary": summary, "rows": rows}


# What the regression gate watches: (label, getter) - higher is better, except the ones in LOWER_IS_BETTER
GATED = {
    "answer correct (answerable)": lambda s: s["answerable"]["correct"]["mean"],
    "refused (unanswerable)": lambda s: s["unanswerable"]["refused"]["mean"],
    "cites gold page": lambda s: s["answerable"]["cites_gold_when_answered"]["mean"],
}
LOWER_IS_BETTER = {
    "false refusal rate": lambda s: s["answerable"]["false_refusal"]["mean"],
    "answers with fabricated citations": lambda s: s["citations"]["with_fabricated"]["mean"],
}


def compare(baseline_summary, new_summary, max_drop=0.05):
    """(ok, lines): fails if any quality number got worse by more than `max_drop`."""
    ok, lines = True, []
    for label, get in GATED.items():
        a, b = get(baseline_summary), get(new_summary)
        bad = (a - b) > max_drop
        ok &= not bad
        lines.append(f"{'FAIL' if bad else 'ok  '} {label}: {a:.3f} -> {b:.3f}")
    for label, get in LOWER_IS_BETTER.items():
        a, b = get(baseline_summary), get(new_summary)
        bad = (b - a) > max_drop
        ok &= not bad
        lines.append(f"{'FAIL' if bad else 'ok  '} {label}: {a:.3f} -> {b:.3f} (lower is better)")
    return ok, lines
