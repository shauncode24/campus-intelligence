# RAG service image.
#
# Reproducible: every Python package is pinned in requirements.txt (generated from
# requirements.in), the Python version matches the one the tests were run on, and the two
# embedding models are downloaded at BUILD time, so a started container needs no internet to
# load them and cannot pick up a different model version.
#
#   docker build -t campus-rag backend/python
#   docker run --rm -p 8000:8000 --env-file <your secrets env file> campus-rag
#
# Secrets are never copied into the image (see .dockerignore): pass them at run time.
FROM python:3.14-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HF_HOME=/opt/hf \
    PORT=8000

# An unprivileged user: a bug or a malicious PDF that gets code execution is not root
RUN useradd --create-home --uid 10001 app

WORKDIR /app

# Dependencies first, so this (slow) layer is reused until requirements.txt changes
COPY requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt

COPY . .

# Bake the embedding models into the image (bge-small for text, CLIP for images)
RUN python scripts/download_models.py \
    && chown -R app:app /app /opt/hf

USER app

EXPOSE 8000

# /healthz answers without touching Firestore, so checking it every 30 s costs nothing.
# The long start period covers loading the models.
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
    CMD python -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/healthz' % os.environ.get('PORT', '8000'), timeout=4)"

# Hosts such as Render set PORT; locally it defaults to 8000 (what the Node API and the frontend expect).
CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
