"""P0-7: the calendar button appears for real deadlines, with the right date, and not otherwise."""
import _env  # noqa: F401  (must be first)

import unittest
from datetime import date

from utils.deadline_extractor import extract_deadline_info

TODAY = date(2026, 11, 25)
SRC = [{"documentId": "abc123", "documentName": "Fee Policy 2026"}]


def find(answer, sources=SRC):
    return extract_deadline_info(answer, sources, today=TODAY)


class TestDates(unittest.TestCase):
    def test_every_common_way_of_writing_a_date(self):
        for text, expected in [
            ("The last date to pay fees is 5 March 2027.", "2027-03-05"),
            ("The last date to pay fees is 5th March 2027.", "2027-03-05"),
            ("Fees are due by March 5, 2027.", "2027-03-05"),
            ("Fees are due by May 5, 2027.", "2027-05-05"),           # used to fail: "%B %d %Y" vs a comma
            ("Fees are due by May 5th, 2027.", "2027-05-05"),
            ("Submit before 5 Sept 2027.", "2027-09-05"),
            ("Submit before 5 Dec. 2026.", "2026-12-05"),
            ("Deadline: 2027-03-05.", "2027-03-05"),
            ("Deadline: 05/03/2027.", "2027-03-05"),                  # day first
            ("Deadline: 5-3-2027.", "2027-03-05"),
            ("**Deadline:** **5 March 2027**", "2027-03-05"),
        ]:
            with self.subTest(text=text):
                r = find(text)
                self.assertIsNotNone(r, text)
                self.assertEqual(r["date"], expected)

    def test_the_first_matching_pattern_no_longer_wins_over_a_sooner_date(self):
        r = find("Applications close 20 March 2027. Fees are due 2027-02-15.")
        self.assertEqual(r["date"], "2027-02-15")           # soonest upcoming deadline-like date

    def test_past_dates_and_invalid_dates_give_nothing(self):
        self.assertIsNone(find("The deadline was 5 March 2026."))
        self.assertIsNone(find("Deadline: 31 February 2027."))
        self.assertIsNone(find("Deadline: 32/01/2027."))

    def test_today_still_counts(self):
        self.assertEqual(find("Due on 25 November 2026.")["date"], "2026-11-25")

    def test_a_date_that_is_not_a_deadline_gets_no_button(self):
        self.assertIsNone(find("The new library opens on 3 March 2027."))
        self.assertIsNone(find("The semester begins on 4 January 2027 and there is a break in the middle."))

    def test_a_deadline_word_far_from_the_date_does_not_count(self):
        far = "Fees are due in installments. " + "x" * 300 + " The library opens 3 March 2027."
        self.assertIsNone(find(far))

    def test_no_dates_no_answer(self):
        self.assertIsNone(find("The fee is Rs. 5,000."))
        self.assertIsNone(find(""))
        self.assertIsNone(find(None))


class TestFields(unittest.TestCase):
    def test_title_description_and_source_are_useful(self):
        r = find("Hostel rules apply. The last date to pay the fee is 5 March 2027. Late fee is Rs. 200.")
        self.assertEqual(r["title"], "Deadline: Fee Policy 2026")
        self.assertEqual(r["sourceDocument"], "Fee Policy 2026")          # the name, not the document id
        self.assertEqual(r["description"], "The last date to pay the fee is 5 March 2027.")
        self.assertTrue(r["canAddToCalendar"] and r["allDay"])

    def test_without_sources_it_still_works(self):
        for sources in ([], None, [{}]):
            r = find("Due on 5 March 2027.", sources)
            self.assertEqual((r["title"], r["sourceDocument"]), ("Deadline", "Campus documents"))

    def test_markdown_is_removed_from_the_context(self):
        self.assertNotIn("**", find("**Due** 5 March 2027")["context"])


if __name__ == "__main__":
    unittest.main()
