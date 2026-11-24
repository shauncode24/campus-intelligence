"""
P1-8: the shared answer cache. Exact-question reuse only (by default), invalidated by any change to
the document set, with an age limit, and strict entity guards for the optional semantic mode.
"""
import time
import unittest

from test_followup_endpoint import FollowUpCase  # noqa: E402  (sets up the app)
from config import Config  # noqa: E402
from database.corpus_epoch import bump_epoch, get_epoch  # noqa: E402
from utils.entity_extractor import extract_entities, entities_match  # noqa: E402
from utils.intent_detector import detect_intent  # noqa: E402
from test_ingestion import quiet  # noqa: E402

Q = "What is the late fee for tuition?"


class TestEntities(unittest.TestCase):
    def test_words_that_merely_contain_letters_are_not_entities(self):
        """The old substring tests matched 'ty' in university, 'ly' in apply, 'sy' in easy, 'fy' in notify."""
        for q in ["Is there a penalty at the university?", "How do I apply for the faculty facility?",
                  "Is it an easy system to notify and verify?", "Only early quantity"]:
            self.assertEqual(extract_entities(q), {}, q)

    def test_real_years_programmes_and_semesters_are_found_as_whole_words(self):
        self.assertEqual(extract_entities("fees for TY btech sem 5"),
                         {"year": ["TY"], "program": ["BTech"], "semester": [5], "numbers": ["5"]})
        self.assertEqual(extract_entities("Semester 8 B.Tech fees")["semester"], [8])
        self.assertEqual(extract_entities("sem-6 fees")["semester"], [6])

    def test_semesters_beyond_four_are_distinguished(self):
        """Only 1-4 used to be recognised, so 'sem 5' and 'sem 6' both produced {} and could share an answer."""
        self.assertFalse(entities_match(extract_entities("fees for sem 5"), extract_entities("fees for sem 6")))

    def test_any_number_difference_blocks_sharing(self):
        a, b = extract_entities("late fee of Rs. 200 per day"), extract_entities("late fee of Rs. 2000 per day")
        self.assertFalse(entities_match(a, b))
        self.assertTrue(entities_match(extract_entities("fee Rs. 5,000"), extract_entities("fee Rs 5000")))

    def test_programme_and_year_differences_block_sharing(self):
        self.assertFalse(entities_match(extract_entities("exam fee btech"), extract_entities("exam fee mtech")))
        self.assertFalse(entities_match(extract_entities("attendance for FY"), extract_entities("attendance for TY")))
        self.assertTrue(entities_match(extract_entities("late fee"), extract_entities("Late Fee?")))

    def test_a_detail_present_in_only_one_question_blocks_sharing(self):
        self.assertFalse(entities_match(extract_entities("exam fee"), extract_entities("exam fee for sem 3")))


class TestIntent(unittest.TestCase):
    def test_a_last_date_question_is_a_deadline_not_a_definition(self):
        self.assertEqual(detect_intent("what is the last date to pay fees"), "deadline")

    def test_other_intents(self):
        self.assertEqual(detect_intent("How do I apply for a bonafide?"), "procedure")
        self.assertEqual(detect_intent("What is a bonafide certificate?"), "definition")
        self.assertEqual(detect_intent("Eligibility for the fee waiver"), "requirement")
        self.assertEqual(detect_intent("When is the exam form due"), "deadline")
        self.assertEqual(detect_intent("library timings"), "general")

    def test_it_matches_whole_words_not_substrings(self):
        self.assertEqual(detect_intent("Which footsteps lead to the whenever room"), "general")


class CacheCase(FollowUpCase):
    def setUp(self):
        super().setUp()
        self._cfg = (Config.CACHE_SEMANTIC_MATCH, Config.CACHE_SEMANTIC_THRESHOLD, Config.CACHE_TTL_DAYS)

    def tearDown(self):
        Config.CACHE_SEMANTIC_MATCH, Config.CACHE_SEMANTIC_THRESHOLD, Config.CACHE_TTL_DAYS = self._cfg
        super().tearDown()

    def ask(self, question, token="tokA"):
        return quiet(self.client.post, "/query", json={"question": question}, headers={"Authorization": f"Bearer {token}"})

    def entries(self):
        return self.db.collection("questions").docs


class TestExactReuse(CacheCase):
    def test_the_same_question_is_answered_once_and_then_reused(self):
        first, second = self.ask(Q), self.ask(Q)
        self.assertFalse(first.json()["cached"])
        self.assertTrue(second.json()["cached"])
        self.assertEqual(len(self.llm.calls), 1)

    def test_case_punctuation_and_spacing_do_not_matter(self):
        self.ask(Q)
        self.assertTrue(self.ask("what  is the LATE fee for tuition").json()["cached"])
        self.assertEqual(len(self.llm.calls), 1)

    def test_a_paraphrase_is_not_reused_because_semantic_matching_is_off(self):
        self.ask(Q)
        again = self.ask("How much is the tuition late fee?")
        self.assertFalse(again.json()["cached"])
        self.assertEqual(len(self.llm.calls), 2)

    def test_one_entry_per_question_and_it_records_what_it_needs(self):
        self.ask(Q)
        self.ask(Q)
        self.assertEqual(len(self.entries()), 1)
        entry = next(iter(self.entries().values()))
        self.assertEqual(entry["documentIds"], ["d1"])
        self.assertEqual(entry["corpusEpoch"], 0)
        self.assertNotIn("embedding", entry, "no vector is stored unless the semantic mode is on")
        self.assertEqual(entry["count"], 2)


class TestInvalidation(CacheCase):
    def test_any_change_to_the_document_set_stops_old_answers_being_reused(self):
        self.ask(Q)
        quiet(bump_epoch, self.db)                        # e.g. a document was processed, replaced or deleted
        self.assertEqual(get_epoch(self.db), 1)
        again = self.ask(Q)
        self.assertFalse(again.json()["cached"])
        self.assertEqual(len(self.llm.calls), 2)

    def test_the_fresh_answer_replaces_the_stale_one_and_is_reused_next_time(self):
        self.ask(Q)
        quiet(bump_epoch, self.db)
        self.ask(Q)                                       # regenerated, stored under epoch 1
        self.assertEqual(len(self.entries()), 1, "the stale entry was replaced, not left to shadow the new one")
        self.assertEqual(next(iter(self.entries().values()))["corpusEpoch"], 1)
        self.assertTrue(self.ask(Q).json()["cached"])
        self.assertEqual(len(self.llm.calls), 2)

    def test_a_document_change_while_an_answer_is_being_generated_does_not_poison_the_cache(self):
        original = self.llm.invoke

        def invoke_and_change(messages):
            quiet(bump_epoch, self.db)                    # an admin deletes a document mid-answer
            return original(messages)
        self.llm.invoke = invoke_and_change
        self.ask(Q)
        self.llm.invoke = original
        self.assertFalse(self.ask(Q).json()["cached"], "the answer was made under the OLD document set")

    def test_old_entries_from_before_this_change_are_never_served(self):
        fingerprint = __import__("database.cache_repository", fromlist=["x"]).CacheRepository.question_fingerprint(Q)
        self.entries()[fingerprint] = {"question": Q, "fingerprint": fingerprint, "answer": "OLD ANSWER", "sources": [],
                                       "intent": "general", "entities": {}}
        body = self.ask(Q).json()
        self.assertFalse(body["cached"])
        self.assertNotEqual(body["answer"], "OLD ANSWER")


class TestAgeLimit(CacheCase):
    def age(self, days):
        for entry in self.entries().values():
            entry["cachedAtMs"] -= int(days * 86400 * 1000)

    def test_an_entry_older_than_the_limit_is_not_served(self):
        Config.CACHE_TTL_DAYS = 30
        self.ask(Q)
        self.age(31)
        self.assertFalse(self.ask(Q).json()["cached"])

    def test_a_younger_entry_is_served(self):
        Config.CACHE_TTL_DAYS = 30
        self.ask(Q)
        self.age(29)
        self.assertTrue(self.ask(Q).json()["cached"])

    def test_zero_means_never_expire(self):
        Config.CACHE_TTL_DAYS = 0
        self.ask(Q)
        self.age(4000)
        self.assertTrue(self.ask(Q).json()["cached"])


class TestOptionalSemanticMode(CacheCase):
    def setUp(self):
        super().setUp()
        Config.CACHE_SEMANTIC_MATCH = True
        Config.CACHE_SEMANTIC_THRESHOLD = 0.70            # low on purpose: the guards must do the protecting

    def test_a_close_variant_with_the_same_details_can_share_an_answer_when_enabled(self):
        self.ask(Q)
        self.assertTrue(self.ask("What is the late fee for tuiton?").json()["cached"])

    def test_the_vector_is_stored_only_in_this_mode(self):
        self.ask(Q)
        self.assertIn("embedding", next(iter(self.entries().values())))

    def test_questions_differing_in_a_number_or_programme_never_share_even_at_a_low_threshold(self):
        self.ask("What are the fees for sem 5?")
        self.assertFalse(self.ask("What are the fees for sem 6?").json()["cached"])
        self.ask("What is the exam fee for BTech?")
        self.assertFalse(self.ask("What is the exam fee for MTech?").json()["cached"])
        self.ask("Late fee of Rs. 200 per day: when does it start?")
        self.assertFalse(self.ask("Late fee of Rs. 2000 per day: when does it start?").json()["cached"])

    def test_the_same_guards_apply_to_semantic_hits_after_a_document_change(self):
        self.ask(Q)
        quiet(bump_epoch, self.db)
        self.assertFalse(self.ask("What is the late fee for tuiton?").json()["cached"])


class TestPurgeScript(CacheCase):
    def test_it_removes_only_what_could_never_be_served(self):
        from scripts.purge_cache import purge
        now = int(time.time() * 1000)
        e = self.entries()
        e["fresh"] = {"corpusEpoch": 3, "cachedAtMs": now}
        e["old_epoch"] = {"corpusEpoch": 2, "cachedAtMs": now}
        e["legacy"] = {"answer": "no epoch, no time"}
        e["aged"] = {"corpusEpoch": 3, "cachedAtMs": now - 40 * 86400 * 1000}
        Config.CACHE_TTL_DAYS = 30
        self.assertEqual(purge(self.db, 3, dry_run=True), 3)
        self.assertEqual(len(e), 4, "a dry run deletes nothing")
        self.assertEqual(purge(self.db, 3), 3)
        self.assertEqual(list(e), ["fresh"])
        self.assertEqual(purge(self.db, 3, delete_all=True), 1)
        self.assertEqual(len(e), 0)


if __name__ == "__main__":
    unittest.main()
