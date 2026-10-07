"""Retrieval — load (and lazily complete) the patient's index, then retrieve.

Falls back to FTS5 keyword search when the embedding model is unavailable —
the answer degrades, the feature doesn't break. Chunks whose embedding could
not be backfilled are invisible to the vector search, so they're served
through the keyword index instead: a transient model failure can never
silently drop a chunk from a draft.
"""

import logging
from typing import List, Optional, Tuple

from . import embeddings
from .store import RagStore

logger = logging.getLogger("pulseid.rag.retrieval")


def backfill_missing_embeddings(store: RagStore, patient_id: str) -> None:
    """Embed rows that were written while the model was down. Opportunistic:
    failure leaves them for a later ask."""
    rows = [r for r in store.list_chunks_for_patient(patient_id) if r["embedding"] is None]
    if not rows:
        return
    try:
        embedder = embeddings.get_embedder()
        vectors = embedder.encode([r["content"] for r in rows])
        for row, vector in zip(rows, vectors):
            store.set_embedding(row["id"], vector, embedder.model_id)
    except Exception as err:  # noqa: BLE001
        logger.error("RAG embedding backfill failed: %s", err)


def retrieve(
    store: RagStore, patient_id: str, query: str, k: Optional[int] = None
) -> Tuple[List[dict], str]:
    """Returns (chunks, mode). Every chunk dict carries chunkId/label/content/
    sourceType/sourceId (plus score in vector mode)."""
    from . import config

    k = k or config.MAX_CHUNKS
    backfill_missing_embeddings(store, patient_id)
    ready = embeddings.ensure_embeddings_ready()

    if ready:
        embedder = embeddings.get_embedder()
        query_vector = embedder.encode([query])[0]
        hits = store.search_vector(patient_id, query_vector, k)
        if hits:
            # Keyword-top-up for chunks that could not be backfilled.
            seen = {row["id"] for row, _ in hits}
            all_rows = store.list_chunks_for_patient(patient_id)
            still_missing = {r["id"] for r in all_rows if r["embedding"] is None}
            if still_missing - seen:
                for row in store.search_keyword(patient_id, query, k):
                    if row["id"] in still_missing and row["id"] not in seen:
                        seen.add(row["id"])
                        hits.append((row, None))
            chunks = [
                _chunk_dict(row, score if score is not None else 0.0) for row, score in hits
            ]
            return chunks, "vector"

    return [_chunk_dict(r) for r in store.search_keyword(patient_id, query, k)], "keyword"


def _chunk_dict(row: dict, score: Optional[float] = None) -> dict:
    return {
        "chunkId": row["id"],
        "label": row["label"],
        "content": row["content"],
        "sourceType": row["source_type"],
        "sourceId": row["source_id"],
        "score": score,
    }
