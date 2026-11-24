"""
Download the embedding models into the Hugging Face cache.

Run during `docker build` so that a started container does not download models at start-up
(slow, needs internet, and could pick up a newer model version). Safe to run anywhere: it
needs no credentials. Loads exactly what the service loads, so whatever it caches is what
the service will use.

    python scripts/download_models.py
"""
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


def main():
    from services.embedding_service import embedding_service   # loads (and so downloads) the models

    print(f"Models ready: text={embedding_service.model_id} ({embedding_service.dimension}-d), "
          f"images={embedding_service.image_model_id}")


if __name__ == "__main__":
    main()
