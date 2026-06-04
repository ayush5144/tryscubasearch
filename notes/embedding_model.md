# Embedding Model — Jina jina-embeddings-v5-text-small

**Switched:** 2026-04-30 — OpenAI `text-embedding-3-small` → Jina `jina-embeddings-v5-text-small`

## Current Model

- Model: `jina-embeddings-v5-text-small`
- Dimensions: 1024
- API: `https://api.jina.ai/v1/embeddings`
- Batch size: up to 16 inputs per request
- Normalized: L2-normalized (unit length)
- Env var: `JINA_API_KEY`

## Previous Model (reference)

- OpenAI `text-embedding-3-small`
- Dimensions: 1536
- Cost: $0.02/1M tokens

## Latency Benchmarks (India → API, 3 sample queries, single calls)

| Model | Dims | Avg latency | Notes |
|-------|------|-------------|-------|
| OpenAI `text-embedding-3-small` | 1536 | ~504ms | ← previous |
| Jina `jina-embeddings-v5-text-small` | 1024 | ~418ms | -17% vs OpenAI |
| Jina `jina-embeddings-v5-text-nano` | ? | ~365ms | fastest, quality TBD |

**Batch of 3 (Jina v5 small):** 469ms total → ~156ms per item (3× faster than single-call OpenAI)

## Architecture (same section — merged)

```
FastAPI/Celery  →  Jina API  →  jina-embeddings-v5-text-small  →  1024d vector
              (httpx AsyncClient)
```

- `backend/services/embedding.py` — async httpx for search query embedding
- `backend/workers/tasks.py` — `_embed_batch()` uses sync httpx for product embedding during ingest
- Meilisearch stores `_vectors.default` as 1024 floats (was 1536)

## Configuration (same section — merged)

| Env var | Description |
|---|---|
| `JINA_API_KEY` | Jina API key (only used for embeddings; OpenAI still used for assistant) |

## Per-Client Embed Config (Phase 12 — 2026-04-28)

The embedding text is no longer hardcoded. Each client has an `embed_config` JSONB column on the `clients` table that stores an ordered list of fields to include in the embedding string.

**Default:** `["title", "category", "tags", "description"]` — identical to pre-Phase-12 behaviour.

**Custom fields:** DB connect stores can include any unmapped source column (e.g. `ingredients`, `material`). These are carried in `p["_extra"]` through the pipeline and consumed by `_build_embed_text()` — never stored in Postgres or Meilisearch.

**Key functions in `backend/workers/tasks.py`:**

```python
_DEFAULT_EMBED_FIELDS = ["title", "category", "tags", "description"]

def _get_embed_config(client_id: str) -> list[str]:
    # reads clients.embed_config via psycopg2; falls back to _DEFAULT_EMBED_FIELDS

def _build_embed_text(p: dict, fields: list[str]) -> str:
    # builds embedding string in field order
    # reads core fields from p, custom fields from p.get("_extra", {})
```

Field order affects embedding quality because transformer models have positional bias and truncation priority is applied top-to-bottom (each field truncated at 300 chars). Store owners configure the order via the Kanban UI at `/dashboard/settings/embed-config`.

## Migration Notes (2026-04-30)

- Switched from OpenAI `text-embedding-3-small` (1536d) → Jina `jina-embeddings-v5-text-small` (1024d)
- All Meilisearch indexes deleted and rebuilt with 1024-dim embedder config
- All products re-embedded with Jina (auto-reindex via `reindex_all_clients` Celery task)
- `backend/services/embedding.py` — rewrote to use httpx AsyncClient → Jina REST API
- `backend/workers/tasks.py` — `_embed_batch()` uses sync httpx → Jina REST API
- `backend/services/meilisearch.py` — embedder dimensions 1536 → 1024
- `backend/config.py` — added `jina_api_key` setting; `OPENAI_API_KEY` retained for assistant
- Jina v5 small is ~17% faster than OpenAI on single calls, ~3× faster in batch mode

## Migration Notes (2026-04-23)

- Switched back from EmbeddingGemma 300M (Ollama, 768 dims) to OpenAI text-embedding-3-small (1536 dims)
- All Meilisearch indexes deleted and rebuilt with 1536-dim embedder config
- All 964 products re-embedded with text-embedding-3-small
- `backend/services/embedding.py` — rewrote to use AsyncOpenAI client, removed httpx/Ollama
- `backend/workers/tasks.py` — `_embed_batch()` now uses sync OpenAI client, removed Ollama httpx call
- `backend/services/meilisearch.py` — embedder dimensions 768 → 1536
- `backend/config.py` — removed `ollama_url` setting
