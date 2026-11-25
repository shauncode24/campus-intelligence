"""
P1-4: answering a question no longer downloads whole PDFs for pictures: described figures are used
through their description, undescribed ones download their file once per question and are then
remembered, and the CLIP question embedding is skipped when no picture can match.
Real PDF fixtures built in memory; no Gemini, no network.
"""
import _env  # noqa: F401  (must be first)

import asyncio
import io
import unittest

import fitz
from langchain_core.documents import Document
from PIL import Image

from test_followup_endpoint import FollowUpCase  # noqa: E402  (stubs the Gemini client first)
from config import Config  # noqa: E402
from services import llm_service as llm_module  # noqa: E402
from services.llm_service import llm_service  # noqa: E402
from services.vector_index import VectorIndex  # noqa: E402
from database.firebase_client import firebase_client  # noqa: E402

URL = f"https://{Config.ALLOWED_FILE_HOSTS[0]}/storage/v1/object/public/documents/figs.pdf"


def pdf_with_images(n=3):
    doc = fitz.open()
    page = doc.new_page()
    for i in range(n):
        img = Image.effect_noise((200, 150), 60 + i * 10).convert("RGB")
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        page.insert_image(fitz.Rect(20, 20 + i * 200, 220, 170 + i * 200), stream=buf.getvalue())
    data = doc.tobytes()
    doc.close()
    return data


def image_doc(index, caption=False, doc_id="d1"):
    return Document(page_content="A figure", metadata={
        "type": "image", "caption": caption, "documentId": doc_id, "page": 0,
        "image_id": f"{doc_id}_page_0_img_{index}", "chunkId": f"c{index}", "similarity": 0.9})


class ImageCase(FollowUpCase):
    def setUp(self):
        super().setUp()
        self.pdf = pdf_with_images(3)
        self.downloads = []
        self._saved_dl = llm_module.download_pdf
        self._saved_cfg = (Config.ATTACH_CAPTIONED_IMAGES, Config.IMAGE_CACHE_ENTRIES)
        test = self

        async def fake_download(url):
            test.downloads.append(url)
            return test.pdf
        llm_module.download_pdf = fake_download
        llm_service._image_cache.clear()
        self.db.collection("documents").docs["d1"]["fileUrl"] = URL

    def tearDown(self):
        llm_module.download_pdf = self._saved_dl
        Config.ATTACH_CAPTIONED_IMAGES, Config.IMAGE_CACHE_ENTRIES = self._saved_cfg
        llm_service._image_cache.clear()
        super().tearDown()

    def message(self, docs):
        return asyncio.run(llm_service.create_multimodal_message("what does the figure show", docs, {"d1": "Fees"}))

    @staticmethod
    def pictures(message):
        return [p for p in message.content if p["type"] == "image_url"]


class TestNoDownloadsForDescribedFigures(ImageCase):
    def test_a_described_figure_is_used_through_its_description_without_any_download(self):
        docs = [image_doc(0, caption=True), image_doc(1, caption=True)]
        message = self.message(docs)
        self.assertEqual(self.downloads, [])
        self.assertEqual(self.pictures(message), [])

    def test_attaching_the_pixels_of_described_figures_can_be_switched_back_on(self):
        Config.ATTACH_CAPTIONED_IMAGES = True
        message = self.message([image_doc(0, caption=True)])
        self.assertEqual(len(self.downloads), 1)
        self.assertEqual(len(self.pictures(message)), 1)


class TestUndescribedFigures(ImageCase):
    def test_three_pictures_of_one_document_download_the_file_once(self):
        message = self.message([image_doc(0), image_doc(1), image_doc(2)])
        self.assertEqual(self.downloads, [URL])
        self.assertEqual(len(self.pictures(message)), 3)

    def test_asking_again_about_the_same_pictures_downloads_nothing(self):
        self.message([image_doc(0), image_doc(1)])
        self.assertEqual(len(self.downloads), 1)
        message = self.message([image_doc(0), image_doc(1)])
        self.assertEqual(len(self.downloads), 1, "second question: no download at all")
        self.assertEqual(len(self.pictures(message)), 2)

    def test_the_memory_is_bounded(self):
        Config.IMAGE_CACHE_ENTRIES = 2
        self.message([image_doc(0), image_doc(1), image_doc(2)])
        self.assertEqual(len(llm_service._image_cache), 2)

    def test_a_failed_download_just_leaves_the_picture_out(self):
        async def broken(url):
            raise RuntimeError("storage down")
        llm_module.download_pdf = broken
        message = self.message([image_doc(0), image_doc(1)])
        self.assertEqual(self.pictures(message), [])
        text = "".join(p["text"] for p in message.content if p["type"] == "text")
        self.assertIn("<question>", text)                     # the question is still asked


class TestClipOnlyWhenPicturesCanMatch(unittest.TestCase):
    class Chunk:
        def __init__(self, image):
            self.image = image

    def test_unknown_before_the_first_build_then_exact(self):
        index = VectorIndex()
        self.assertTrue(index.may_have_image_chunks(), "nothing built yet: cannot rule pictures out")
        index._state, index._have_state = ({(False, "bge"): object()}, {}, 5), True
        self.assertFalse(index.may_have_image_chunks(), "only text vectors: skip the picture search")
        index._state = ({(False, "bge"): object(), (True, "clip"): object()}, {}, 9)
        self.assertTrue(index.may_have_image_chunks())
        index.too_large = True
        index._state = ({}, {}, 0)
        self.assertTrue(index.may_have_image_chunks(), "scanning mode: cannot tell")


if __name__ == "__main__":
    unittest.main()
