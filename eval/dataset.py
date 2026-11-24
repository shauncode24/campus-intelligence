"""
Corpus and question-set loading, and label validation.

Corpus ("pages.jsonl"), one JSON object per page:
  {"doc": "fee_policy", "title": "Fee Payment Policy", "page": 1, "text": "..."}
  `doc` is a stable id, `page` is 1-based (what a student sees), `title` is the
  human-readable document name.

Questions ("questions.jsonl"), one JSON object per question:
  {
    "id": "q001",
    "question": "What is the late fee for paying tuition after the deadline?",
    "type": "numeric",                            # see QUESTION_TYPES
    "answerable": true,
    "gold": [{"doc": "fee_policy", "page": 1}],   # pages that contain the answer
    "must_include": ["Rs. 200 per day"],          # strings a correct answer must contain
    "reference_answer": "...",                    # optional
    "notes": ""                                   # optional
  }

Follow-up questions (type "follow_up", the question leans on earlier chat turns)
also need:
    "history": [{"role": "user", "text": "..."}, {"role": "bot", "text": "..."}],
    "standalone": "the same question written so it needs no history"
`standalone` is the IDEAL rewrite (hand-written): evaluating with it shows the best
a follow-up rewriter could achieve, and evaluating the raw question shows what
happens without one.
Lines starting with # are comments.

validate() checks the labels MECHANICALLY: every gold page must exist in the
corpus and every must_include string must literally appear on a gold page, so
a mislabelled question fails validation instead of silently skewing results.
"""
import hashlib
import json
import re

ANSWERABLE_TYPES = {"fact", "numeric", "deadline", "procedure", "eligibility", "multi_doc", "follow_up"}
# "absent_in_domain": a campus question the documents do not cover (the hard,
# realistic case). "out_of_scope": unrelated to campus documents.
UNANSWERABLE_TYPES = {"absent_in_domain", "out_of_scope"}
QUESTION_TYPES = ANSWERABLE_TYPES | UNANSWERABLE_TYPES

# Rules of thumb, not statistical guarantees: the bootstrap intervals in the
# report are the real measure of uncertainty.
MIN_ANSWERABLE = 30
MIN_UNANSWERABLE = 15


def normalize(text):
    """Lower-case, unify quotes/dashes, collapse whitespace (for literal matching)."""
    text = str(text).lower()
    for src, dst in (("’", "'"), ("‘", "'"), ("“", '"'), ("”", '"'),
                     ("–", "-"), ("—", "-"), (" ", " ")):
        text = text.replace(src, dst)
    return re.sub(r"\s+", " ", text).strip()


def load_jsonl(path):
    rows = []
    with open(path, encoding="utf-8") as f:
        for n, line in enumerate(f, start=1):
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError as e:
                raise ValueError(f"{path}:{n}: invalid JSON ({e.msg})") from None
    return rows


def load_pages(path):
    return load_jsonl(path)


def load_questions(path):
    return load_jsonl(path)


def file_fingerprint(*paths):
    """Short hash of the dataset files, so a report says exactly which data it used."""
    h = hashlib.sha256()
    for p in paths:
        with open(p, "rb") as f:
            h.update(f.read())
    return h.hexdigest()[:12]


def validate(pages, questions):
    """Return a list of human-readable problems (empty list = dataset is valid)."""
    errors = []

    page_text = {}
    for i, p in enumerate(pages, start=1):
        for field in ("doc", "page", "text"):
            if field not in p:
                errors.append(f"pages[{i}]: missing '{field}'")
        if "doc" in p and "page" in p:
            key = (p["doc"], p["page"])
            if not isinstance(p["page"], int) or p["page"] < 1:
                errors.append(f"pages[{i}] {key}: page must be an integer >= 1 (pages are 1-based)")
            if key in page_text:
                errors.append(f"pages[{i}] {key}: duplicate page")
            page_text[key] = normalize(p.get("text", ""))
        if not str(p.get("text", "")).strip():
            errors.append(f"pages[{i}]: empty text")

    seen_ids, seen_questions = set(), set()
    for i, q in enumerate(questions, start=1):
        qid = q.get("id", f"#{i}")
        where = f"question {qid}"

        if "id" not in q or not str(q["id"]).strip():
            errors.append(f"question #{i}: missing id")
        elif q["id"] in seen_ids:
            errors.append(f"{where}: duplicate id")
        seen_ids.add(q.get("id"))

        text = str(q.get("question", "")).strip()
        if not text:
            errors.append(f"{where}: empty question")
        elif normalize(text) in seen_questions:
            errors.append(f"{where}: duplicate question text")
        seen_questions.add(normalize(text))

        qtype = q.get("type")
        if qtype not in QUESTION_TYPES:
            errors.append(f"{where}: type must be one of {sorted(QUESTION_TYPES)}, got {qtype!r}")

        answerable = q.get("answerable")
        if not isinstance(answerable, bool):
            errors.append(f"{where}: 'answerable' must be true or false")
            continue
        if answerable and qtype in UNANSWERABLE_TYPES:
            errors.append(f"{where}: type {qtype!r} must have answerable=false")
        if not answerable and qtype in ANSWERABLE_TYPES:
            errors.append(f"{where}: type {qtype!r} must have answerable=true")

        if qtype == "follow_up":
            history = q.get("history")
            if not isinstance(history, list) or not history:
                errors.append(f"{where}: follow_up questions need a non-empty 'history'")
            else:
                for t in history:
                    if not (isinstance(t, dict) and t.get("role") in ("user", "bot")
                            and isinstance(t.get("text"), str) and t["text"].strip()):
                        errors.append(f"{where}: every history turn needs role 'user'|'bot' and non-empty text")
                        break
            standalone = q.get("standalone")
            if not isinstance(standalone, str) or not standalone.strip():
                errors.append(f"{where}: follow_up questions need a 'standalone' rewrite")
            elif normalize(standalone) == normalize(text):
                errors.append(f"{where}: 'standalone' must differ from the question")
        elif "history" in q or "standalone" in q:
            errors.append(f"{where}: 'history' and 'standalone' are only for type 'follow_up'")

        gold = q.get("gold", [])
        must = q.get("must_include", [])
        if not answerable:
            if gold:
                errors.append(f"{where}: unanswerable questions must have no gold pages")
            if must:
                errors.append(f"{where}: unanswerable questions must have no must_include")
            continue

        if not gold:
            errors.append(f"{where}: answerable questions need at least one gold page")
        if not must:
            errors.append(f"{where}: answerable questions need at least one must_include string")

        gold_keys = []
        for g in gold:
            key = (g.get("doc"), g.get("page"))
            if key not in page_text:
                errors.append(f"{where}: gold page {key} is not in the corpus")
            else:
                gold_keys.append(key)
        if len(set(gold_keys)) != len(gold_keys):
            errors.append(f"{where}: duplicate gold pages")

        gold_text = " ".join(page_text[k] for k in gold_keys)
        for s in must:
            if normalize(s) not in gold_text:
                errors.append(f"{where}: must_include {s!r} does not appear on any gold page")

    return errors


def size_warnings(questions):
    """Warnings (not errors) about dataset size, shown at the top of every report."""
    n_ans = sum(1 for q in questions if q.get("answerable") is True)
    n_unans = sum(1 for q in questions if q.get("answerable") is False)
    warnings = []
    if n_ans < MIN_ANSWERABLE:
        warnings.append(
            f"Only {n_ans} answerable questions (recommended minimum {MIN_ANSWERABLE}). "
            "Differences between runs are likely to be noise; look at the confidence intervals."
        )
    if n_unans < MIN_UNANSWERABLE:
        warnings.append(
            f"Only {n_unans} unanswerable questions (recommended minimum {MIN_UNANSWERABLE}). "
            "Refusal/abstention figures are very rough."
        )
    return warnings
