# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# PulseID RAG service (backend/rag) — the Python half of the AI report
# drafter. Runs entirely separately from the Node API image (Dockerfile);
# point the Node backend's RAG_SERVICE_URL at this container.
# ---------------------------------------------------------------------------

FROM python:3.12-slim

WORKDIR /app

# No compilers needed: fastembed/onnxruntime and pypdf ship wheels.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY run.py ./

# Persistent index + model cache live here — mount a volume at /app/data.
RUN mkdir -p /app/data && useradd --system --create-home pulseid \
    && chown -R pulseid:pulseid /app
USER pulseid

ENV RAG_PORT=8100
EXPOSE 8100

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD python -c "import urllib.request,os; urllib.request.urlopen('http://127.0.0.1:' + os.environ.get('RAG_PORT','8100') + '/health')" || exit 1

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.1 --port ${RAG_PORT}"]
