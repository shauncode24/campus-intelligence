"""
Public FAQ, read from the admin-curated `faqs` collection.

The FAQ is written by hand by administrators (Node: routes/faqAdminRoutes.js).
It must NEVER be built from what users asked: user questions can contain
personal circumstances, and an answer cached for one person is not a published
fact. The `questions` collection is an internal answer cache and is not read
here.
"""
from database.firebase_client import firebase_client

MAX_PUBLIC_FAQS = 200


class FaqRepository:
    @staticmethod
    def get_published(limit: int = 50):
        """Published FAQs in the order the admins set (then oldest first)."""
        db = firebase_client.db
        if not db:
            return []

        faqs = []
        # Single equality filter: no composite index needed. Sorted in Python.
        for snap in db.collection('faqs').where('published', '==', True).limit(MAX_PUBLIC_FAQS).stream():
            data = snap.to_dict()

            sources = []
            if data.get('sourceName'):
                sources.append({
                    "documentName": data['sourceName'],
                    "displayPage": data.get('sourcePage'),
                })

            faqs.append({
                "id": snap.id,
                "question": data.get('question', ''),
                "answer": data.get('answer', ''),
                "intent": data.get('intent', 'general'),
                "order": data.get('order', 100),
                "sources": sources,
                "createdAt": data.get('createdAt'),
                "updatedAt": data.get('updatedAt'),
            })

        faqs.sort(key=lambda f: (f["order"], f["createdAt"] is None, str(f["createdAt"])))
        return faqs[:limit]


faq_repository = FaqRepository()
