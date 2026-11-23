"""The dataset validator must catch every kind of mislabelled question."""
import copy
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import dataset as d  # noqa: E402

HERE = os.path.dirname(__file__)
DEMO = os.path.join(HERE, "..", "examples", "synthetic_demo")

PAGES = [
    {"doc": "fees", "title": "Fees", "page": 1, "text": "The late fee is Rs. 200 per day."},
    {"doc": "fees", "title": "Fees", "page": 2, "text": "Refunds are 90 percent before classes."},
]
GOOD = {"id": "q1", "question": "What is the late fee?", "type": "numeric", "answerable": True,
        "gold": [{"doc": "fees", "page": 1}], "must_include": ["Rs. 200 per day"]}
UNANS = {"id": "u1", "question": "What is the weather?", "type": "out_of_scope", "answerable": False,
         "gold": [], "must_include": []}


def errors_for(**changes):
    q = copy.deepcopy(GOOD)
    q.update(changes)
    return d.validate(PAGES, [q])


class TestValidator(unittest.TestCase):
    def test_a_correct_dataset_has_no_errors(self):
        self.assertEqual(d.validate(PAGES, [GOOD, UNANS]), [])

    def test_the_shipped_demo_dataset_is_valid(self):
        pages = d.load_pages(os.path.join(DEMO, "pages.jsonl"))
        questions = d.load_questions(os.path.join(DEMO, "questions.jsonl"))
        self.assertEqual(d.validate(pages, questions), [])
        self.assertGreater(len(questions), 30)

    def test_gold_page_must_exist(self):
        self.assertTrue(any("not in the corpus" in e for e in errors_for(gold=[{"doc": "fees", "page": 9}])))
        self.assertTrue(any("not in the corpus" in e for e in errors_for(gold=[{"doc": "nope", "page": 1}])))

    def test_must_include_must_appear_on_a_gold_page(self):
        errs = errors_for(must_include=["Rs. 999 per day"])
        self.assertTrue(any("does not appear on any gold page" in e for e in errs))
        # a string that exists, but on a page that is NOT gold, is also an error
        errs = errors_for(must_include=["90 percent"])
        self.assertTrue(any("does not appear on any gold page" in e for e in errs))

    def test_must_include_matching_ignores_case_and_spacing(self):
        self.assertEqual(errors_for(must_include=["rs.   200  PER day"]), [])

    def test_answerable_needs_gold_and_must_include(self):
        self.assertTrue(any("at least one gold page" in e for e in errors_for(gold=[])))
        self.assertTrue(any("at least one must_include" in e for e in errors_for(must_include=[])))

    def test_unanswerable_must_not_have_labels(self):
        bad = dict(UNANS, gold=[{"doc": "fees", "page": 1}])
        self.assertTrue(any("no gold pages" in e for e in d.validate(PAGES, [bad])))
        bad = dict(UNANS, must_include=["x"])
        self.assertTrue(any("no must_include" in e for e in d.validate(PAGES, [bad])))

    def test_type_and_answerable_must_agree(self):
        self.assertTrue(any("must have answerable=false" in e for e in d.validate(PAGES, [dict(UNANS, answerable=True)])))
        self.assertTrue(any("must have answerable=true" in e for e in errors_for(answerable=False, type="numeric")))
        self.assertTrue(any("type must be one of" in e for e in errors_for(type="trivia")))

    def test_ids_and_questions_must_be_unique_and_present(self):
        dup = d.validate(PAGES, [GOOD, dict(GOOD)])
        self.assertTrue(any("duplicate id" in e for e in dup))
        same_text = d.validate(PAGES, [GOOD, dict(GOOD, id="q2", question="  WHAT is the LATE fee?  ")])
        self.assertTrue(any("duplicate question text" in e for e in same_text))
        self.assertTrue(any("empty question" in e for e in errors_for(question="  ")))
        self.assertTrue(any("missing id" in e for e in d.validate(PAGES, [{k: v for k, v in GOOD.items() if k != "id"}])))

    def test_answerable_flag_must_be_boolean(self):
        self.assertTrue(any("'answerable' must be true or false" in e for e in errors_for(answerable="yes")))

    def test_pages_are_one_based_unique_and_non_empty(self):
        errs = d.validate([{"doc": "a", "page": 0, "text": "x"}], [])
        self.assertTrue(any(">= 1" in e for e in errs))
        errs = d.validate([PAGES[0], dict(PAGES[0])], [])
        self.assertTrue(any("duplicate page" in e for e in errs))
        errs = d.validate([{"doc": "a", "page": 1, "text": "  "}], [])
        self.assertTrue(any("empty text" in e for e in errs))

    def test_size_warnings_fire_for_small_sets(self):
        warnings = d.size_warnings([GOOD, UNANS])
        self.assertEqual(len(warnings), 2)
        big = [dict(GOOD, id=f"q{i}") for i in range(30)] + [dict(UNANS, id=f"u{i}") for i in range(15)]
        self.assertEqual(d.size_warnings(big), [])

    def test_comment_lines_and_bad_json_are_handled(self):
        import tempfile
        with tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False, encoding="utf-8") as f:
            f.write('# a comment\n\n{"a": 1}\n')
            ok = f.name
        with tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False, encoding="utf-8") as f:
            f.write('{"a": 1}\n{not json}\n')
            bad = f.name
        self.assertEqual(d.load_jsonl(ok), [{"a": 1}])
        with self.assertRaises(ValueError) as ctx:
            d.load_jsonl(bad)
        self.assertIn(":2:", str(ctx.exception))     # tells you which line is broken
        os.unlink(ok)
        os.unlink(bad)


if __name__ == "__main__":
    unittest.main()
