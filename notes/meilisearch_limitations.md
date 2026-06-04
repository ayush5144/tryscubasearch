# Meilisearch Limits That Matter for ScubaSearch

Source set:

- https://www.meilisearch.com/docs/resources/help/known_limitations
- https://www.meilisearch.com/docs/resources/internals/documents
- https://www.meilisearch.com/docs/resources/self_hosting/performance/ram_multithreading
- https://www.meilisearch.com/docs/resources/self_hosting/configuration/reference

This note is for the current OTT/content-platform architecture:

- one Meilisearch instance
- one index per client
- PostgreSQL as source of truth
- app-side embeddings

## Limits that matter

| Limitation | Value | ScubaSearch impact |
|---|---:|---|
| Default HTTP payload limit | 100 MB | Large indexing batches must be split internally or the limit must be raised intentionally. |
| Concurrent search queue size | 1,000 | When the queue is full, Meilisearch can return `503 too_many_search_requests` with `Retry-After`. |
| Primary key length | 511 bytes | Our generated `csv_`, `dbsync_`, and `pull_` IDs stay well below this and should continue to do so. |
| Filterable value length | 468 bytes | Long individual facet values should be avoided for fields like category, language, and tags. |
| Max query words considered | 10 | Very long user queries will have words after the 10th ignored. |
| Large batch indexing risk | Internal error possible | Very large document batches can hit file descriptor limits or RAM pressure. |
| Max indexes in one instance | Practical, not tiny | Many indexes are supported, but hitting hundreds frequently can hurt performance. |

## Current product implications

### Search

- We should avoid semantic search for 1-2 character prefixes.
- We should allow semantic or hybrid search from 3 characters onward.
- Redis result caching remains important because repeated queries reduce Meilisearch pressure.

### Indexing

- We should batch indexing safely on our side instead of asking users to split files manually.
- Postgres should remain the source of truth, so Meilisearch chunking can be retried safely.
- We should set `MEILI_MAX_INDEXING_MEMORY` explicitly in production.
- We should raise file descriptor limits on the VPS for large catalogs.

## Capacity notes

These are planning estimates, not load-tested guarantees.

### 8 GB VPS

Good for:

- early launch
- a modest number of OTT clients
- moderate live search traffic
- catalogs in the low hundreds of thousands of total documents

Needs guardrails:

- conservative worker tuning
- Meilisearch indexing memory cap
- internal indexing batches

### 16 GB VPS

Recommended before:

- heavier concurrent search traffic
- frequent large sync jobs
- many active clients searching while indexing is also happening

Why:

- gives Meilisearch more room during indexing
- gives FastAPI and Celery more breathing room
- reduces contention when search and indexing overlap

## Not the right move right now

- per-client Meilisearch instances
- custom sharding layer
- removing PostgreSQL

The simpler and stronger default remains:

- one shared Meilisearch instance
- one index per client
- PostgreSQL source of truth
- Redis cache + queue
