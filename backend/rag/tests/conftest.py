"""Shared test fixtures.

The whole suite runs with the deterministic FakeEmbedder and a throwaway
index DB (same isolation spirit as PULSEID_DB_PATH on the Node side) —
no model download, no network, no shared state.
"""

import os
import sys
import tempfile
from pathlib import Path

import pytest

# Env must be set BEFORE app.config is imported anywhere.
os.environ.setdefault("RAG_EMBEDDING_BACKEND", "fake")
os.environ.setdefault(
    "RAG_INDEX_DB_PATH", os.path.join(tempfile.mkdtemp(prefix="pulseid-rag-"), "test-index.db")
)

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


@pytest.fixture()
def store(tmp_path):
    from app.store import RagStore

    return RagStore(db_path=tmp_path / "index.db")


@pytest.fixture()
def patient_id() -> str:
    return "11111111-1111-1111-1111-111111111111"


@pytest.fixture()
def registration_id() -> str:
    return "22222222-2222-2222-2222-222222222222"
