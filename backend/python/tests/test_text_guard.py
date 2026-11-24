"""
P0-6: a scanned PDF (pictures, no text layer) is refused with a clear message, and a mostly
scanned one is flagged for the admin: never "Processed" with nothing searchable.
Real PDF parsing (fixtures built in memory); no Gemini calls, no network.
"""
import _env  # noqa: F401  (must be first)

import io
import unittest

import fitz
from PIL import Image

from test_ingestion import IngestCase  # noqa: E402  (sets up the app)
from config import Config  # noqa: E402
from services import ingestion  # noqa: E402

LONG = "The late fee for tuition is Rs. 200 per day, up to a maximum of Rs. 5,000 per semester. " * 3


def picture_page(doc):
    page = doc.new_page()
    img = Image.effect_noise((400, 300), 80).convert("RGB")      # noisy, so it is not "decorative"/duplicate
    buf = io.BytesIO(); img.save(buf, format="PNG")
    page.insert_image(fitz.Rect(50, 50, 450, 350), stream=buf.getvalue())


def text_page(doc, text=LONG):
    doc.new_page().insert_textbox(fitz.Rect(50, 50, 500, 700), text, fontsize=11)


def make_pdf(kinds):
    doc = fitz.open()
    for k in kinds:
        (text_page if k == "text" else picture_page)(doc)
    data = doc.tobytes(); doc.close()
    return data


class TextGuard(IngestCase):
    def setUp(self):
        super().setUp()
        self._cfg = (Config.IMAGE_CAPTIONING, Config.MIN_TEXT_PAGE_FRACTION)
        Config.IMAGE_CAPTIONING = False                  # no model calls: pictures fall back to CLIP
        ingestion.pdf_processor.process_pdf = self._saved_ing[0]   # the real parser (IngestCase replaced it)
        self.pdf = b""

        async def dl(url):
            return self.pdf
        ingestion.download_pdf = dl

    def tearDown(self):
        Config.IMAGE_CAPTIONING, Config.MIN_TEXT_PAGE_FRACTION = self._cfg
        super().tearDown()

    def run_doc(self, kinds):
        self.pdf = make_pdf(kinds)
        doc = self.make_doc()
        self.process(doc)
        return doc, self.wait_for(doc)

    def test_a_scan_is_an_error_with_a_clear_message_and_nothing_is_stored(self):
        doc, rec = self.run_doc(["picture", "picture"])
        self.assertEqual(rec["status"], "Error")
        self.assertIn("no readable text", rec["errorMessage"])
        self.assertEqual(self.chunks(doc), [])

    def test_a_normal_text_pdf_is_processed_without_a_warning(self):
        doc, rec = self.run_doc(["text", "text"])
        self.assertEqual(rec["status"], "Processed")
        self.assertNotIn("warning", rec)
        self.assertEqual(rec["textStats"]["pagesWithText"], 2)
        self.assertGreater(len(self.chunks(doc)), 0)

    def test_a_mostly_scanned_pdf_is_processed_but_flagged(self):
        doc, rec = self.run_doc(["text", "picture", "picture"])
        self.assertEqual(rec["status"], "Processed")
        self.assertIn("Only 1 of 3 pages have readable text", rec["warning"])

    def test_the_threshold_is_configurable(self):
        Config.MIN_TEXT_PAGE_FRACTION = 0.3
        _, rec = self.run_doc(["text", "picture", "picture"])
        self.assertNotIn("warning", rec)

    def test_reprocessing_clears_an_old_warning(self):
        doc = self.make_doc(status="Error", warning="old warning")
        self.pdf = make_pdf(["text"])
        self.process(doc)
        self.assertNotIn("warning", self.wait_for(doc))


if __name__ == "__main__":
    unittest.main()
