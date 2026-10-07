"""Indexing — turning one source (profile, visit, uploaded PDF) into chunks.

Idempotent by design, exactly like the original pipeline: the Node client can
push the same source any number of times (booking created, lazy self-heal on
first ask, backfill after the model was down) and the index converges —
replace_source swaps the source's rows wholesale. Embeddings attach when the
local model is available; rows persist regardless, so the FTS5 keyword index
always serves them and a later retrieve backfills the vectors.
"""

import base64
import binascii
import io
import logging

from . import chunking, embeddings
from .schemas import AttachmentSource, ProfileSource, VisitSource
from .store import RagStore

logger = logging.getLogger("pulseid.rag.indexer")


class IndexableError(Exception):
    """The source exists but carries nothing indexable — not a fault."""


def _embed_texts(texts: list[str]) -> tuple[list[list[float]] | None, str | None]:
    """Vectors for the texts, or None when the model is unavailable. Never
    raises — model failure keeps rows (keyword fallback), like the original."""
    if not embeddings.ensure_embeddings_ready():
        return None, None
    try:
        embedder = embeddings.get_embedder()
        return embedder.encode(texts), embedder.model_id
    except Exception as err:  # noqa: BLE001 — degrade, never fail the ingest
        logger.error("Chunk embedding failed (rows kept for FTS fallback): %s", err)
        return None, None


def index_profile(store: RagStore, source: ProfileSource) -> int:
    """Personal details + emergency contacts as one chunk. Chunks are keyed to
    the pending registration at booking time and re-parented at approval."""
    label = (
        "Patient profile (from booking request)"
        if source.scope == "registration"
        else "Patient profile"
    )
    text = chunking.build_profile_chunk_text(source)
    vectors, model_id = _embed_texts([text])
    return store.replace_source(
        source_type="profile",
        source_id=source.sourceId,
        patient_id=source.scopeId if source.scope == "patient" else None,
        registration_id=source.scopeId if source.scope == "registration" else None,
        label=label,
        texts=[text],
        embeddings=vectors,
        embedding_model=model_id,
    )


def index_visit(store: RagStore, source: VisitSource) -> int:
    """One visit + its prescriptions, embedded as a single chunk."""
    text = chunking.build_visit_chunk_text(source)
    vectors, model_id = _embed_texts([text])
    return store.replace_source(
        source_type="visit",
        source_id=source.sourceId,
        patient_id=source.patientId,
        registration_id=None,
        label=f"Visit {source.visitDate}",
        texts=[text],
        embeddings=vectors,
        embedding_model=model_id,
    )


def index_attachment(store: RagStore, source: AttachmentSource) -> int:
    """An uploaded report PDF → extracted text → chunks. Only text PDFs are
    indexable; image uploads and scanned image-only PDFs have no extractable
    text — no OCR in this build, a documented limitation, not a silent gap."""
    if source.mimeType != "application/pdf":
        raise IndexableError(f"Not a text PDF: {source.mimeType}")
    try:
        content = base64.b64decode(source.contentB64, validate=True)
    except (binascii.Error, ValueError) as err:
        raise IndexableError("Attachment payload is not valid base64.") from err

    text = _extract_pdf_text(content)
    if not text:
        raise IndexableError("No extractable text (image-only or empty PDF).")

    texts = chunking.split_text(text)
    vectors, model_id = _embed_texts(texts)
    return store.replace_source(
        source_type="attachment",
        source_id=source.sourceId,
        patient_id=source.patientId,
        registration_id=source.registrationId,
        label=f"Report: {source.filename}",
        texts=texts,
        embeddings=vectors,
        embedding_model=model_id,
    )


def _extract_pdf_text(content: bytes) -> str:
    from pypdf import PdfReader  # deferred: only needed for PDF ingests

    try:
        reader = PdfReader(io.BytesIO(content))
        return "\n".join((page.extract_text() or "") for page in reader.pages).strip()
    except Exception as err:  # noqa: BLE001 — a corrupt PDF is a skipped source
        logger.error("Could not extract text from uploaded report: %s", err)
        return ""
