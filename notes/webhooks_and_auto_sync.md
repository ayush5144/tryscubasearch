# ScubaSearch - Webhooks and Auto-Sync

This note explains the three generic sync methods now available outside CSV and direct Postgres sync:

- REST push
- webhook sync
- scheduled pull sync

These methods are generic on purpose. OTT platforms, CMSs, internal backends, and even commerce systems can all use the same pattern as long as they can produce structured JSON.

If you want a step-by-step dashboard guide written for non-technical users as well, read:

- `notes/sync_methods_user_guide.md`

---

## The three sync methods

### 1. REST push

Use this when the platform backend can send a JSON batch directly to ScubaSearch.

- Endpoint: `POST /api/v1/push/documents`
- Auth: API key
- Best for:
  - nightly catalog exports from a CMS
  - admin tools that save batches of titles
  - migration scripts

### 2. Webhook sync

Use this when the platform already emits an event at publish time or on metadata change.

- Endpoint: `POST /api/v1/push/webhook`
- Auth: API key
- Best for:
  - "Publish" button in a CMS
  - metadata correction events
  - near-real-time updates after editorial actions

### 3. Scheduled pull sync

Use this when the customer exposes a JSON API and wants ScubaSearch to fetch from it on a schedule.

- Endpoints:
  - `POST /api/v1/api-sync/preview`
  - `POST /api/v1/api-sync/connect`
  - `GET /api/v1/api-sync/status`
  - `POST /api/v1/api-sync/sync`
  - `DELETE /api/v1/api-sync/disconnect`
- Auth: Clerk dashboard auth
- Best for:
  - public or internal catalog APIs
  - teams that do not want to build push logic
  - one-time field mapping followed by ongoing automatic refresh

---

## How the architecture works

```text
Customer CMS / backend / content API
          │
          ├───────────────────────────────────────────────┐
          │                                               │
          ▼                                               ▼
REST push                                         Webhook event
POST /api/v1/push/documents                       POST /api/v1/push/webhook
          │                                               │
          └──────────────────────┬────────────────────────┘
                                 ▼
FastAPI
  - authenticates with API key
  - resolves client_id
  - normalizes payload into ScubaSearch documents
  - writes rows into Postgres products
  - queues process_ingest_job()
                                 │
                                 ▼
Celery worker
  - builds embedding text from embed_config
  - calls OpenAI text-embedding-3-small
  - writes Meilisearch docs and vectors
  - flushes Redis cache


Dashboard user connects a pull source
POST /api/v1/api-sync/connect
          │
          ▼
FastAPI stores api_sync_connections row
  - source_url
  - encrypted headers
  - items_path
  - field_mapping
  - sync interval
          │
          ▼
Celery Beat wakes every 5 minutes
          │
          ▼
sync_due_api_sources()
          │
          ▼
sync_external_api_source(client_id)
  - fetch remote JSON payload
  - map source fields into ScubaSearch fields
  - replace the live catalog in Postgres
  - embed semantic fields with OpenAI
  - write Meilisearch docs and vectors
  - flush Redis cache
```

---

## Flow 1 - REST push and webhook sync

1. Customer system sends JSON to ScubaSearch.
2. FastAPI authenticates with the API key.
3. Payload is normalized into ScubaSearch document shape.
4. Rows are written to the `products` table first.
5. A Celery job is queued.
6. Celery embeds semantic fields using the client's embed config.
7. Meilisearch receives the document plus `_vectors.default`.
8. Cache is flushed so new search results appear immediately.

## Flow 2 - Scheduled pull sync

1. Dashboard user previews a JSON endpoint.
2. User maps source fields like `name`, `meta.description`, or `watch.url` to ScubaSearch fields.
3. ScubaSearch stores the source config in `api_sync_connections`.
4. A first sync runs immediately.
5. Celery Beat keeps checking for due sources.
6. Each due source is fetched, mapped, embedded, and reindexed.

---

## Source switching rules

ScubaSearch keeps one active live catalog source at a time.

- File upload switches away from DB or pull sync.
- Database connect switches away from pull sync.
- API pull connect switches away from database sync.

When the active source changes, the old live catalog is wiped from:

- Postgres `products`
- Meilisearch documents
- stored vectors inside Meilisearch documents

That keeps search results and counts aligned with the active source.

---

## Replace, append, and update

REST push and webhook sync use the same ingest semantics as file upload:

- `replace`
  - rebuild the catalog from the payload
- `append`
  - add new IDs and fully overwrite matching IDs
- `update`
  - patch only the fields that were sent

Scheduled pull sync is authoritative and behaves like a replace of the active pull source.

---

## Dashboard surface

The dashboard now exposes these methods at:

- `/dashboard/sync`

That page gives the client:

- sample payloads
- live cURL examples
- a webhook tester
- pull API preview and field mapping
- current pull sync status

The Postgres-specific wizard remains at:

- `/dashboard/database`

---

## Operational note

Scheduled pull sync depends on both of these running:

- Celery worker
- Celery Beat

If Beat is down, manual "Sync now" still works, but automatic recurring pull syncs will not fire.
