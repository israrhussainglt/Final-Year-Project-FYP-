"""PulseID RAG service — FastAPI surface.

One small HTTP API the Node backend talks to (see backend/src/lib/rag.ts).
Ingest is fire-and-forget from the Node side, so ingest endpoints answer
quickly and never leak internals; retrieval and drafting carry the same
error contracts the Express routes used to implement inline.

Every route is scoped to identifiers the Node client already authorised:
the service holds no patient registry of its own, so it can only ever
return chunks that were explicitly indexed under the patient_id it is
asked about.
"""

import asyncio
import logging
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import Depends, FastAPI, Header, HTTPException

from . import config, embeddings, generation, indexer, retrieval
from .schemas import (
    AttachmentSource,
    DraftRequest,
    DraftResponse,
    ProfileSource,
    ReparentRequest,
    RetrieveRequest,
    RetrieveResponse,
    VisitSource,
)
from .store import RagStore

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
logger = logging.getLogger("pulseid.rag")

store = RagStore()


@asynccontextmanager
async def _lifespan(app: FastAPI):
    # Warm the local embedding model outside the request path; failure is
    # fine — retrieval just starts in keyword mode until it's ready.
    await asyncio.get_running_loop().run_in_executor(None, embeddings.ensure_embeddings_ready)
    yield


app = FastAPI(title="PulseID RAG service", version="1.0.0", lifespan=_lifespan)


async def require_token(x_rag_token: Optional[str] = Header(default=None)) -> None:
    """Optional shared-secret gate. Set RAG_SERVICE_TOKEN on both sides of
    the wire; leave empty on both for local loopback dev."""
    if config.RAG_SERVICE_TOKEN and x_rag_token != config.RAG_SERVICE_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid or missing RAG service token.")


@app.get("/health", dependencies=[Depends(require_token)])
def health():
    return {
        "status": "ok",
        "embeddingModel": config.EMBEDDING_MODEL if config.EMBEDDING_BACKEND != "fake" else "fake(test)",
        "embeddingReady": embeddings.ensure_embeddings_ready(),
        "groqConfigured": config.groq_configured(),
        "chunks": store.total_chunks(),
    }


@app.post("/index/profile", dependencies=[Depends(require_token)])
def index_profile(source: ProfileSource):
    chunks = indexer.index_profile(store, source)
    return {"ok": True, "chunks": chunks}


@app.post("/index/visit", dependencies=[Depends(require_token)])
def index_visit(source: VisitSource):
    chunks = indexer.index_visit(store, source)
    return {"ok": True, "chunks": chunks}


@app.post("/index/attachment", dependencies=[Depends(require_token)])
def index_attachment(source: AttachmentSource):
    try:
        chunks = indexer.index_attachment(store, source)
    except indexer.IndexableError as err:
        # A real skip (image PDF, bad payload) — not an error worth failing
        # the caller's fire-and-forget ingest over.
        return {"ok": False, "skipped": True, "reason": str(err)}
    return {"ok": True, "chunks": chunks}


@app.post("/reparent", dependencies=[Depends(require_token)])
def reparent(request: ReparentRequest):
    moved = store.reparent_registration(request.registrationId, request.patientId)
    return {"ok": True, "reparented": moved}


@app.delete("/sources/{source_type}/{source_id}", dependencies=[Depends(require_token)])
def delete_source(source_type: str, source_id: str):
    if source_type not in ("profile", "visit", "attachment"):
        raise HTTPException(status_code=404, detail="Unknown source type.")
    removed = store.delete_source(source_type, source_id)
    return {"ok": True, "removed": removed}


@app.get("/sources/{patient_id}", dependencies=[Depends(require_token)])
def list_sources(patient_id: str):
    return {"patientId": patient_id, "sources": store.list_source_ids_for_patient(patient_id)}


@app.post("/retrieve", response_model=RetrieveResponse, dependencies=[Depends(require_token)])
def retrieve_context(request: RetrieveRequest):
    chunks, mode = retrieval.retrieve(store, request.patientId, request.query, request.k)
    return RetrieveResponse(mode=mode, chunks=chunks)


@app.post("/draft", response_model=DraftResponse, dependencies=[Depends(require_token)])
def draft(request: DraftRequest):
    try:
        draft_model, model_name = generation.draft_report(request)
    except generation.DrafterNotConfiguredError:
        raise HTTPException(
            status_code=503,
            detail="AI report drafting isn't configured for this deployment yet. "
            "Set GROQ_API_KEY in backend/rag/.env (key from console.groq.com) and restart the RAG service.",
        )
    except generation.DraftIncompleteError:
        raise HTTPException(status_code=502, detail="RAG_DRAFT_INCOMPLETE")
    return DraftResponse(draft=draft_model, model=model_name)
