"""Dev entrypoint: python run.py — mirrors `npm run dev` on the Node side."""

import uvicorn

from app import config

if __name__ == "__main__":
    uvicorn.run("app.main:app", host="127.0.0.1", port=config.RAG_PORT, reload=False)
