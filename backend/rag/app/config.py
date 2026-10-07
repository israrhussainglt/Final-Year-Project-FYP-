"""PulseID RAG service configuration.

Everything is environment-driven and read once at import. The service is a
separate deployable from the Node API server: it has its own .env, its own
SQLite index, and (unlike the Node side) the Groq key never leaves this
process — the Node backend only ever talks to this service over HTTP.
"""

import os
from pathlib import Path

from dotenv import load_dotenv

# .env lives next to this package's parent (backend/rag/.env). Load it before
# reading anything — mirrors how the Node server loads backend/.env at boot.
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

# --- HTTP surface -----------------------------------------------------------

# Port the FastAPI service listens on. The Node client targets this via
# RAG_SERVICE_URL (see backend/src/lib/rag.ts).
RAG_PORT = int(os.getenv("RAG_PORT", "8100"))

# Optional shared secret. When set, every request must carry it in the
# X-RAG-Token header — the Node client sends it from the same env var. Empty
# on both sides means "trust the loopback", which is the local-dev default.
RAG_SERVICE_TOKEN = os.getenv("RAG_SERVICE_TOKEN", "")

# --- Embeddings --------------------------------------------------------------

# "fastembed" (ONNX, ~90 MB model download, no torch) or "fake" (deterministic
# hash vectors, for tests only). Fastembed normalizes vectors, so cosine
# similarity is a plain dot product.
EMBEDDING_BACKEND = os.getenv("RAG_EMBEDDING_BACKEND", "fastembed")
EMBEDDING_MODEL = os.getenv("RAG_EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2")

# Model weights cache. Kept inside backend/rag/data so the whole service is
# self-contained and gitignored.
_DATA_DIR = Path(os.getenv("RAG_DATA_DIR", Path(__file__).resolve().parent.parent / "data"))
CACHE_DIR = _DATA_DIR / "models"
INDEX_DB_PATH = Path(os.getenv("RAG_INDEX_DB_PATH", _DATA_DIR / "rag-index.db"))

# --- Chunking ----------------------------------------------------------------

CHUNK_SIZE = int(os.getenv("RAG_CHUNK_SIZE", "1200"))
CHUNK_OVERLAP = int(os.getenv("RAG_CHUNK_OVERLAP", "150"))

# --- Retrieval / generation ---------------------------------------------------

# Default top-k for context retrieval — small on purpose: a patient's corpus
# is hundreds of chunks at most and the drafting prompt stays focused.
MAX_CHUNKS = int(os.getenv("RAG_MAX_CHUNKS", "5"))

# Groq (https://console.groq.com) — OpenAI-compatible wire protocol. Empty key
# means the /draft endpoint answers 503 and /health reports groq_configured
# false; retrieval and indexing work without it.
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_BASE_URL = os.getenv("GROQ_BASE_URL", "https://api.groq.com/openai/v1")
GROQ_MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")
GROQ_MAX_TOKENS = int(os.getenv("GROQ_MAX_TOKENS", "8192"))


def groq_configured() -> bool:
    return bool(GROQ_API_KEY)
