"""Local embeddings — the only place this service touches a model.

all-MiniLM-L6-v2 via fastembed (ONNX runtime, ~90 MB of weights, no torch).
The model downloads once into data/models and is reused forever after, same
contract as the @huggingface/transformers setup it replaces on the Node side.

Failure contract (inherited from the original design): the embedding model is
a convenience, never a dependency. Any init/encode failure flips the shared
state to "unavailable", callers fall back to the FTS5 keyword index, and the
next call retries — a transient failure degrades the answer, it never breaks
the feature.
"""

import logging
import threading
from typing import List, Optional, Protocol

from . import config

logger = logging.getLogger("pulseid.rag.embeddings")


class Embedder(Protocol):
    model_id: str

    def encode(self, texts: List[str]) -> List[List[float]]: ...


class FastEmbedEmbedder:
    """Lazy, thread-safe wrapper around fastembed. One model per process."""

    def __init__(self, model_id: str) -> None:
        self.model_id = model_id
        self._model = None
        self._lock = threading.Lock()

    def _get_model(self):
        if self._model is None:
            with self._lock:
                if self._model is None:
                    from fastembed import TextEmbedding  # deferred: heavy import

                    self._model = TextEmbedding(
                        model_name=self.model_id, cache_dir=str(config.CACHE_DIR)
                    )
        return self._model

    def encode(self, texts: List[str]) -> List[List[float]]:
        model = self._get_model()
        return [list(map(float, v)) for v in model.embed(texts)]


class FakeEmbedder:
    """Deterministic hash-bag vectors — tests and offline CI only. Same text
    always yields the same vector; different texts differ enough for cosine
    ranking to be meaningful at toy scale."""

    def __init__(self, dims: int = 64) -> None:
        self.model_id = f"fake-{dims}"
        self._dims = dims

    def _vector(self, text: str) -> List[float]:
        import hashlib
        import math

        vec = [0.0] * self._dims
        for token in text.lower().split():
            digest = hashlib.sha256(token.encode("utf-8")).digest()
            idx = int.from_bytes(digest[:4], "big") % self._dims
            sign = 1.0 if digest[4] % 2 == 0 else -1.0
            vec[idx] += sign
        norm = math.sqrt(sum(x * x for x in vec)) or 1.0
        return [x / norm for x in vec]

    def encode(self, texts: List[str]) -> List[List[float]]:
        return [self._vector(t) for t in texts]


def make_embedder(backend: str, model_id: str) -> Embedder:
    if backend == "fake":
        return FakeEmbedder()
    if backend == "fastembed":
        return FastEmbedEmbedder(model_id)
    raise ValueError(f"Unknown RAG_EMBEDDING_BACKEND: {backend}")


# --- Shared instance + health state ------------------------------------------

_embedder: Optional[Embedder] = None
_embedder_lock = threading.Lock()
_state = "uninitialized"  # uninitialized | ready | unavailable


def get_embedder() -> Embedder:
    global _embedder
    if _embedder is None:
        with _embedder_lock:
            if _embedder is None:
                _embedder = make_embedder(config.EMBEDDING_BACKEND, config.EMBEDDING_MODEL)
    return _embedder


def embeddings_ready() -> bool:
    return _state == "ready"


def ensure_embeddings_ready() -> bool:
    """True when the local model is usable; never raises. Mirrors the Node
    ensureEmbeddingsReady() state machine."""
    global _state
    if _state == "ready":
        return True
    try:
        get_embedder().encode(["health check"])
        _state = "ready"
        return True
    except Exception as err:  # noqa: BLE001 — degrade, never crash the caller
        logger.error("Local embedding model unavailable — falling back to keyword search: %s", err)
        _state = "unavailable"
        return False


def set_embedder_for_testing(embedder: Embedder, ready: bool = True) -> None:
    """Test seam: swap the shared embedder and force the health state."""
    global _embedder, _state
    with _embedder_lock:
        _embedder = embedder
        _state = "ready" if ready else "uninitialized"
