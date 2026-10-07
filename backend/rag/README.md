# PulseID RAG Service

The entire RAG pipeline behind the doctor-side **AI report drafter** — chunk
text building, PDF text extraction, local embeddings, the vector index,
retrieval with a keyword fallback, and Groq generation — lives here, in
Python, fully separate from the Node API server. `backend/src/lib/rag.ts` is
only a thin HTTP client: it gathers data the server already has and talks to
this service.

```
Node API (Express)                        this service (FastAPI)
────────────────────                      ──────────────────────
server.ts routes
  └─ src/lib/rag.ts  ──── HTTP/JSON ───▶  app/main.py
      repo lookups,                        ├─ indexer.py     (chunk + embed + persist)
      uploaded-file bytes                  ├─ retrieval.py   (vector + FTS5 fallback)
                                           ├─ generation.py  (Groq, structured output)
                                           ├─ embeddings.py  (fastembed MiniLM, local)
                                           └─ store.py       (SQLite index, data/rag-index.db)
```

## Why this shape

- **Separation** — the API server no longer carries LangChain/embedding
  dependencies; the RAG service has no Express, no clinical database, and no
  Groq key shared with Node. Each can be deployed, restarted, or scaled alone.
- **Modularity** — one concern per module under `app/`; every stage of the
  pipeline is independently testable (pytest suite, no network, no model
  download — see `tests/`).
- **Same trust boundaries as before** (see module docstrings):
  - Retrieval is always filtered by `patient_id` at the SQL layer before any
    text leaves `store.py`; the service can only ever return chunks that were
    explicitly indexed under the patient id it is asked about.
  - The drafted report is a convenience, never a decision — the doctor
    reviews and approves the editable draft before anything is saved (the
    Node `finalize` route is the human gate).
  - Embedding model failure never breaks retrieval: chunks persist un-embedded
    and the FTS5 keyword index serves them; vectors are backfilled on a later
    ask.

## Running

```bash
# 1. One-time setup (Python 3.11+)
cd backend/rag
python -m venv .venv
.venv\Scripts\activate        # Windows (source .venv/bin/activate on POSIX)
pip install -r requirements.txt

# 2. Configure — copy .env.example to .env and set GROQ_API_KEY
#    (key from https://console.groq.com; needed only for /draft).

# 3. Start (port 8100 by default; ~90 MB model download on first start)
python run.py             # or: npm run rag  from backend/

# 4. Test
python -m pytest tests    # or: npm run rag:test  from backend/
```

Then opt the backend in: set `RAG_SERVICE_ENABLED=1` in `backend/.env`
(optionally `RAG_SERVICE_URL`, default `http://127.0.0.1:8100`) and restart
the Node server. Until that flag is set, every RAG call on the Node side is a
no-op and the "Draft report with AI" button answers a clear 503.

Health check: `GET http://127.0.0.1:8100/health` →
`{ status, embeddingModel, embeddingReady, groqConfigured, chunks }`.

## HTTP API

All bodies are JSON. When `RAG_SERVICE_TOKEN` is set (here **and** in
`backend/.env`), requests must carry it in the `X-RAG-Token` header.

| Route | Purpose | Used by |
|---|---|---|
| `GET /health` | liveness + embedding/Groq status | ops |
| `POST /index/profile` | index a patient's personal details — `scope: "registration"` at booking time, `"patient"` for the lazy catch-up | booking POST, self-heal |
| `POST /index/visit` | index one visit + its prescriptions as a single chunk | visit save |
| `POST /index/attachment` | extract + index an uploaded report PDF (base64) | booking POST, self-heal |
| `POST /reparent` | re-parent a registration's chunks to the patient (booking approval) | allocate route |
| `DELETE /sources/{type}/{id}` | purge a source's chunks (booking rejection) | reject route |
| `GET /sources/{patientId}` | which sources are already indexed | lazy self-heal |
| `POST /retrieve` | top-k relevant chunks for a query, `mode: "vector" \| "keyword"` | draft route |
| `POST /draft` | Groq-drafted structured report from notes + retrieved docs | draft route |

Ingest endpoints are **idempotent**: a source's chunk rows are replaced
wholesale, so the Node client can push the same source any number of times
(booking created, self-heal on first ask, retry after downtime) without
duplicating the index.

`POST /draft` error contracts (preserved from the original in-process
implementation): `503` when no `GROQ_API_KEY` is configured, `502` with
`RAG_DRAFT_INCOMPLETE` when the model's tool call fails schema validation —
the UI maps that to "try again, it usually succeeds on retry".

## Pipeline details

- **Embeddings**: `all-MiniLM-L6-v2` via fastembed (ONNX on CPU, ~90 MB
  weights downloaded once into `data/models`; no torch). Vectors are
  normalized float32, stored as BLOBs. Swap models with `RAG_EMBEDDING_MODEL`.
- **Chunking**: profile and visits are one chunk each (fixed wording, pinned
  by tests because drafts cite these labels); PDF text is split recursively
  at 1200 chars / 150 overlap, mirroring the original splitter.
- **Store**: SQLite at `data/rag-index.db` — one `chunks` table plus an FTS5
  mirror for keyword retrieval. Brute-force cosine is correct and instant at
  this corpus size (hundreds of chunks per patient); an ANN index would be
  ceremony, not engineering.
- **Generation**: Groq's OpenAI-compatible endpoint, forced `report_draft`
  tool call whose parameters are the `ReportDraft` Pydantic schema — the
  schema is the labelling guarantee that every prescription comes back as
  structured fields, never prose.

## Configuration

Everything is env-driven (`.env` in this folder; see `.env.example`):
`GROQ_API_KEY`, `GROQ_MODEL`, `RAG_PORT`, `RAG_SERVICE_TOKEN`,
`RAG_EMBEDDING_BACKEND` (`fastembed` | `fake`), `RAG_EMBEDDING_MODEL`,
`RAG_CHUNK_SIZE`, `RAG_CHUNK_OVERLAP`, `RAG_MAX_CHUNKS`.
