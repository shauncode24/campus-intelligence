"""
Export answer feedback (thumbs up/down with context) as JSON lines, to read it or to turn the
failures into evaluation cases (eval/README.md: "Building the real golden set").

    python scripts/export_feedback.py --out feedback.jsonl              # everything, anonymised
    python scripts/export_feedback.py --out bad.jsonl --only-down       # just the thumbs-downs

User ids and chat ids are NOT exported (a question can describe someone's personal situation);
each row keeps the question, the answer, the exact documents/pages/passages it was built from, the
rating, the reason and comment. Read the questions before sharing the file with anyone.

Run it from backend/python with the real credentials available (backend/.env or ENV_FILE).
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

PRIVATE_FIELDS = ("userId", "chatId", "historyId", "messageId")


def export_rows(db, only_down=False):
    """Feedback rows as plain dicts, newest last, without anything that identifies the person."""
    rows = []
    for snap in db.collection("feedback").stream():
        row = snap.to_dict() or {}
        if only_down and row.get("rating") != "down":
            continue
        for key in PRIVATE_FIELDS:
            row.pop(key, None)
        # timestamps are not JSON; keep them readable
        for key in ("createdAt", "updatedAt"):
            if row.get(key) is not None:
                row[key] = str(row[key])
        rows.append(row)
    rows.sort(key=lambda r: r.get("createdAt") or "")
    return rows


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True, help="file to write (JSON lines)")
    ap.add_argument("--only-down", action="store_true", help="only thumbs-down rows")
    args = ap.parse_args()

    from database.firebase_client import firebase_client
    if not firebase_client.db:
        print("Firebase is not available (check credentials / ENV_FILE)")
        sys.exit(1)
    rows = export_rows(firebase_client.db, only_down=args.only_down)
    with open(args.out, "w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    print(f"Wrote {len(rows)} feedback rows to {args.out}")


if __name__ == "__main__":
    main()
