"""The vector store — SQLite, the only persistence this service owns.

Vectors live as float32 BLOBs in its own database (data/rag-index.db), fully
separate from the Node clinical DB; brute-force cosine is correct and instant
at this corpus size (hundreds of chunks per patient), so an ANN index would
be ceremony, not engineering — same call the original TypeScript made.

An FTS5 mirror serves keyword retrieval when the embedding model is down.
Both indexes are written inside one transaction so they can never drift.

Trust boundary, unchanged from the original design: retrieval is ALWAYS
filtered by patient_id at the SQL layer before any text leaves this module.
There is no code path where another patient's chunk can enter a prompt.
"""

import sqlite3
import struct
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional, Tuple

from . import config


def pack_vector(vector: List[float]) -> bytes:
    return struct.pack(f"<{len(vector)}f", *vector)


def unpack_vector(blob: bytes) -> List[float]:
    return list(struct.unpack(f"<{len(blob) // 4}f", blob))


def cosine_similarity(a: List[float], b: List[float]) -> float:
    dot = norm_a = norm_b = 0.0
    for x, y in zip(a, b):
        dot += x * y
        norm_a += x * x
        norm_b += y * y
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot / ((norm_a**0.5) * (norm_b**0.5))


_SCHEMA = """
CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  patient_id TEXT,
  registration_id TEXT,
  source_type TEXT NOT NULL CHECK (source_type IN ('profile','visit','attachment')),
  source_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL DEFAULT 0,
  label TEXT NOT NULL,
  content TEXT NOT NULL,
  embedding BLOB,
  embedding_model TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chunks_patient ON chunks(patient_id);
CREATE INDEX IF NOT EXISTS idx_chunks_registration ON chunks(registration_id);
CREATE INDEX IF NOT EXISTS idx_chunks_source ON chunks(source_type, source_id);
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(chunk_id UNINDEXED, content);
"""


def _fts_match_expr(query: str) -> str:
    """Turn free text into a safe FTS5 phrase query. The value is bound as a
    parameter (never interpolated), so even adversarial input can only ever
    match or not match — same guarantee the Node version's quote-wrapping had."""
    tokens = [t for t in "".join(c if c.isalnum() else " " for c in query).split() if t]
    if not tokens:
        return ""
    return " ".join(f'"{t}"' for t in tokens)


class RagStore:
    """Thread-safe SQLite store. One connection per call keeps FastAPI's
    threadpool honest; WAL keeps concurrent readers cheap."""

    def __init__(self, db_path: Optional[Path] = None) -> None:
        self.db_path = Path(db_path or config.INDEX_DB_PATH)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._write_lock = threading.Lock()
        with self._connect() as db:
            db.executescript(_SCHEMA)

    def _connect(self) -> sqlite3.Connection:
        db = sqlite3.connect(self.db_path, timeout=10)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("PRAGMA foreign_keys=ON")
        return db

    # --- writes ---------------------------------------------------------------

    def replace_source(
        self,
        *,
        source_type: str,
        source_id: str,
        patient_id: Optional[str],
        registration_id: Optional[str],
        label: str,
        texts: List[str],
        embeddings: Optional[List[List[float]]],
        embedding_model: Optional[str],
    ) -> int:
        """Idempotent upsert: a source's chunk rows are replaced wholesale so
        re-indexing can never duplicate. Rows always persist (content + label);
        the embedding BLOBs attach when vectors are available. Returns the
        number of chunks written."""
        with self._write_lock, self._connect() as db:
            db.execute(
                "DELETE FROM chunks_fts WHERE chunk_id IN "
                "(SELECT id FROM chunks WHERE source_type = ? AND source_id = ?)",
                (source_type, source_id),
            )
            db.execute(
                "DELETE FROM chunks WHERE source_type = ? AND source_id = ?",
                (source_type, source_id),
            )
            now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
            for i, content in enumerate(texts):
                chunk_id = str(uuid.uuid4())
                chunk_label = f"{label} (part {i + 1})" if len(texts) > 1 else label
                embedding = pack_vector(embeddings[i]) if embeddings else None
                db.execute(
                    "INSERT INTO chunks (id, patient_id, registration_id, source_type, source_id,"
                    " chunk_index, label, content, embedding, embedding_model, created_at)"
                    " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        chunk_id,
                        patient_id,
                        registration_id,
                        source_type,
                        source_id,
                        i,
                        chunk_label,
                        content,
                        embedding,
                        embedding_model if embeddings else None,
                        now,
                    ),
                )
                db.execute(
                    "INSERT INTO chunks_fts (chunk_id, content) VALUES (?, ?)",
                    (chunk_id, content),
                )
            return len(texts)

    def delete_source(self, source_type: str, source_id: str) -> int:
        with self._write_lock, self._connect() as db:
            ids = [
                r["id"]
                for r in db.execute(
                    "SELECT id FROM chunks WHERE source_type = ? AND source_id = ?",
                    (source_type, source_id),
                ).fetchall()
            ]
            for chunk_id in ids:
                db.execute("DELETE FROM chunks_fts WHERE chunk_id = ?", (chunk_id,))
            db.execute(
                "DELETE FROM chunks WHERE source_type = ? AND source_id = ?",
                (source_type, source_id),
            )
            return len(ids)

    def reparent_registration(self, registration_id: str, patient_id: str) -> int:
        """Booking approval moved a registration to a real patient — the
        indexed chunks follow, exactly as the Node approval transaction did."""
        with self._write_lock, self._connect() as db:
            cur = db.execute(
                "UPDATE chunks SET patient_id = ? WHERE registration_id = ?",
                (patient_id, registration_id),
            )
            return cur.rowcount

    def set_embedding(self, chunk_id: str, vector: List[float], model: str) -> None:
        with self._write_lock, self._connect() as db:
            db.execute(
                "UPDATE chunks SET embedding = ?, embedding_model = ? WHERE id = ?",
                (pack_vector(vector), model, chunk_id),
            )

    # --- reads ------------------------------------------------------------------

    def source_chunk_count(self, source_type: str, source_id: str) -> int:
        with self._connect() as db:
            row = db.execute(
                "SELECT COUNT(*) AS n FROM chunks WHERE source_type = ? AND source_id = ?",
                (source_type, source_id),
            ).fetchone()
            return int(row["n"])

    def list_source_ids_for_patient(self, patient_id: str) -> List[dict]:
        with self._connect() as db:
            rows = db.execute(
                "SELECT DISTINCT source_type, source_id FROM chunks WHERE patient_id = ?",
                (patient_id,),
            ).fetchall()
            return [{"sourceType": r["source_type"], "sourceId": r["source_id"]} for r in rows]

    def list_chunks_for_patient(self, patient_id: str) -> List[dict]:
        with self._connect() as db:
            rows = db.execute(
                "SELECT * FROM chunks WHERE patient_id = ? ORDER BY created_at ASC",
                (patient_id,),
            ).fetchall()
            return [dict(r) for r in rows]

    def search_vector(
        self, patient_id: str, query_vector: List[float], k: int
    ) -> List[Tuple[dict, float]]:
        with self._connect() as db:
            rows = db.execute(
                "SELECT * FROM chunks WHERE patient_id = ? AND embedding IS NOT NULL",
                (patient_id,),
            ).fetchall()
        scored = [
            (dict(r), cosine_similarity(query_vector, unpack_vector(r["embedding"])))
            for r in rows
        ]
        scored.sort(key=lambda pair: pair[1], reverse=True)
        return scored[:k]

    def search_keyword(self, patient_id: str, query: str, k: int) -> List[dict]:
        match = _fts_match_expr(query)
        if not match:
            return []
        with self._connect() as db:
            rows = db.execute(
                "SELECT r.* FROM chunks_fts f JOIN chunks r ON r.id = f.chunk_id"
                " WHERE chunks_fts MATCH ? AND r.patient_id = ?"
                " ORDER BY bm25(chunks_fts) ASC LIMIT ?",
                (match, patient_id, k),
            ).fetchall()
            return [dict(r) for r in rows]

    def missing_embedding_count(self, patient_id: str) -> int:
        with self._connect() as db:
            row = db.execute(
                "SELECT COUNT(*) AS n FROM chunks WHERE patient_id = ? AND embedding IS NULL",
                (patient_id,),
            ).fetchone()
            return int(row["n"])

    def total_chunks(self) -> int:
        with self._connect() as db:
            return int(db.execute("SELECT COUNT(*) AS n FROM chunks").fetchone()["n"])
