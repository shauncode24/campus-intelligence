"""Budget checking for the load-test report (no heavy imports, so it can be unit-tested)."""


def lookup(report, path):
    cur = report
    for part in path.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return None
        cur = cur[part]
    return cur


def check_budgets(report, budgets, strict=True):
    """
    Returns (ok, lines). A budget is {"max": x} or {"min": x} on a dotted path into the report.
    `strict`: a budget whose value is missing FAILS (a scenario that silently stopped running must
    not look like a pass); pass strict=False for a deliberate partial run.
    """
    ok, lines = True, []
    for path, rule in budgets.items():
        if path.startswith("_"):
            continue
        value = lookup(report, path)
        if value is None:
            lines.append(f"  {path:<58} {'MISSING  FAIL' if strict else 'not measured in this run'}")
            ok &= not strict
            continue
        broken = ("max" in rule and value > rule["max"]) or ("min" in rule and value < rule["min"])
        lines.append(f"  {path:<58} {value!s:>10}  budget {rule}  {'FAIL' if broken else 'ok'}")
        ok &= not broken
    return ok, lines
