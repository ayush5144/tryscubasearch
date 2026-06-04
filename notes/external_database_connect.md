# ScubaSearch — External Database Connect (Phase 11)

Phase 11 is complete. Store owners can connect their own PostgreSQL or MySQL/MariaDB database directly to ScubaSearch, map their table columns to ScubaSearch fields, and trigger a full sync. Products are pulled, embedded, and indexed into Meilisearch without any CSV export.

---

## Why This Exists

CSV upload forces store owners to export, reformat, and re-upload whenever their catalog changes. Database connect eliminates that step entirely - the connection string is saved once, and re-sync is a single button click. It is the self-hosted equivalent of Shopify's webhook sync.

---

## Flow Summary

```text
Dashboard user opens /dashboard/database
          │
          ▼
Choose PostgreSQL or MySQL/MariaDB
          │
          ▼
Paste database connection string
          │
          ▼
Pick source table
          │
          ▼
Map source columns to ScubaSearch fields
          │
          ▼
POST /api/v1/database/connect
          │
          ▼
FastAPI
  - validates DSN
  - encrypts connection string
  - stores database_connections row
  - queues sync_external_database(client_id)
          │
          ▼
Celery worker
  - fetches rows from the selected customer database
  - normalizes them into ScubaSearch documents
  - wipes old live catalog for this client
  - embeds semantic fields with OpenAI
  - updates Postgres products
  - updates Meilisearch documents and vectors
          │
          ▼
Dashboard polls GET /api/v1/database/status until sync is done
```

---

## What Gets Built

| Layer | Files |
|---|---|
| Backend service | `backend/services/db_connect.py` |
| Backend router | `backend/routers/database_connect.py` |
| Celery task | `backend/workers/tasks.py` → `sync_external_database` |
| Frontend page | `frontend/app/dashboard/database/page.tsx` |
| API client | `frontend/lib/api-client.ts` → database functions |
| DB migration | `alembic/versions/c5d6e7f8a9b0_add_database_connections.py` |

---

## Database Schema — `database_connections`

```sql
CREATE TABLE database_connections (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id            UUID NOT NULL UNIQUE REFERENCES clients(id) ON DELETE CASCADE,
    db_type              TEXT NOT NULL DEFAULT 'postgres',
    connection_string_enc TEXT NOT NULL,   -- Fernet-encrypted connection string
    table_name           TEXT NOT NULL,
    field_mapping        JSONB NOT NULL DEFAULT '{}',  -- {"title":"name","price":"price",...}
    sync_status          TEXT NOT NULL DEFAULT 'pending',  -- pending/syncing/done/failed
    product_count        INTEGER,
    last_synced_at       TIMESTAMP,
    error_message        TEXT,
    created_at           TIMESTAMP NOT NULL DEFAULT NOW()
);
```

One row per client. `UNIQUE` on `client_id` enforces that a client can only connect one external database at a time. Mutual exclusivity with Shopify is enforced at the API level — `POST /database/connect` returns 409 if a `shopify_connections` row exists for the client.

---

## Connection String Encryption

All connection strings are encrypted at rest using Fernet symmetric encryption. Key lives in `DB_ENCRYPTION_KEY` env var.

```python
# services/db_connect.py
def encrypt_connection_string(conn_str: str) -> str:
    return Fernet(settings.db_encryption_key).encrypt(conn_str.encode()).decode()

def decrypt_connection_string(enc: str) -> str:
    return Fernet(settings.db_encryption_key).decrypt(enc.encode()).decode()
```

The plaintext connection string is never stored in Postgres. The Celery task decrypts on demand just before connecting to the customer's database.

---

## API Routes — `/api/v1/database`

All routes require Clerk JWT (dashboard auth, not API key auth). `client_id` is resolved from the JWT via `require_clerk_user` → `get_client_by_clerk_user_id`.

| Method | Path | Purpose |
|---|---|---|
| POST | `/tables` | List all connectable tables for a given source database |
| POST | `/preview-columns` | Return column names + types for a specific table |
| POST | `/connect` | Save connection + trigger initial sync via Celery |
| GET | `/status` | Return current sync status, product count, last synced timestamp |
| POST | `/sync` | Trigger re-sync (rejects if already syncing) |
| DELETE | `/disconnect` | Delete the connection row (does not delete the current catalog by itself) |

### Connection String Validation

The router validates the source URL before opening a connector:

For PostgreSQL:

1. Must start with `postgres://`, `postgresql://`, or `postgresql+asyncpg://`
2. Must not contain a comma or pasted table suffix

For MySQL/MariaDB:

1. Must start with `mysql://`, `mysql+pymysql://`, `mariadb://`, or `mariadb+pymysql://`
2. Must not contain a comma or pasted table suffix

The goal is to reject malformed "database URL + table name" pastes before any real connection attempt happens.

### JSONB field_mapping fix

asyncpg cannot serialize a raw Python `dict` into a JSONB column. The field mapping must be passed as `json.dumps(body.field_mapping)` not `body.field_mapping` directly. This was the cause of the 500 error on the `/connect` endpoint.

---

## Field Mapping

The UI lets store owners map their table's columns to ScubaSearch's 9 fields:

| ScubaSearch field | Required | Notes |
|---|---|---|
| `title` | Yes | Product name displayed in search results |
| `description` | No | Used in embedding text |
| `price` | No | Displayed in widget |
| `category` | No | Used in embedding + filtering |
| `tags` | No | Comma-separated string or array |
| `image_url` | No | Shown in widget results |
| `product_url` | No | Click destination |
| `in_stock` | No | Boolean or numeric (>0 = in stock) |
| `external_id` | No | Customer's primary key — used for upsert dedup |

Auto-mapping: on column preview, the frontend automatically maps any column whose name exactly matches a ScubaSearch field key (case-insensitive, ignoring underscores). For the test store, `description`, `price`, `category`, `tags`, `image_url`, `product_url` all auto-map. `name` → `title` and `stock_qty` → `in_stock` require manual selection.

JSON dot-notation is supported: if a column is `jsonb` type, the UI suggests sub-paths like `metadata.price`. The `fetch_products` function in `db_connect.py` resolves these at runtime.

---

## Celery Task — `sync_external_database`

Task name: `sync_external_database`. Registered in `workers/tasks.py`. Accepts `client_id` (UUID string).

```
sync_external_database(client_id)
  1. Load database_connections row for client
  2. Set sync_status = 'syncing'
  3. Decrypt connection string
  4. Call fetch_products(conn_str, table_name, field_mapping, db_type)
       → PostgreSQL uses psycopg2
       → MySQL/MariaDB uses PyMySQL
       → maps each row to ScubaSearch product shape via field_mapping
       → skips rows where title is empty/null
       → supports JSON dot-path mapping from top-level JSON columns
  5. Clear the existing live catalog for that client from Postgres + Meilisearch
  6. For each batch of 100 products:
       a. Build embedding text: title + category + tags + description[:200]
       b. Embed batch via OpenAI text-embedding-3-small (1536 dims)
       c. Build Meilisearch documents with _vectors.default
       d. add_documents() to products_{client_id} index (wait for task)
       e. UPSERT into Postgres products table:
            id = uuid4() (new UUID for each product)
            external_id = "dbsync_{customer_id}" or deterministic fallback id
            ON CONFLICT (client_id, external_id) DO UPDATE
  7. Set sync_status = 'done', product_count = synced, last_synced_at = NOW()
  8. Flush Redis search cache for client
```

### Known bugs fixed during Phase 11

| Bug | Root cause | Fix |
|---|---|---|
| `can't adapt type 'UUID'` | psycopg2 received `uuid.UUID` object | Changed to `str(client_uuid)` |
| `null value in column "id"` | INSERT didn't include `id` column | Added `id = str(uuid4())` as first column in INSERT |
| `invalid input syntax for type uuid: "dbsync_1"` | `prod_id` string used as Postgres UUID primary key | Separated concerns: `prod_uuid = str(uuid4())` for Postgres `id`, `external_id = "dbsync_{ext_id}"` for dedup |

### Product ID Design

Products synced from external databases get two IDs:

- **`id` (UUID)**: used as primary key in both Postgres `products` table and Meilisearch document `id`. Generated fresh as `uuid4()` per product per sync for new products; ON CONFLICT clause updates existing rows matched by `external_id`.
- **`external_id` ("dbsync_{customer_pk}")**: the customer's primary key from their database, prefixed with `dbsync_`. Used for upsert dedup — if the same external record syncs again, it updates the existing Postgres row instead of creating a duplicate.
- If the customer table has no mapped external id, ScubaSearch falls back to a deterministic fingerprint built from title + product_url + year + content_type + language so full resyncs stay stable.

### Internal app table guard

If Database Connect is pointed at ScubaSearch's own app database, internal tables such as `products`, `clients`, `api_keys`, and `search_logs` are filtered out of the table list and blocked on preview/connect/resync. This prevents the app from syncing its own catalog back into itself.

---

## Frontend — 3-Step Connect Wizard

`frontend/app/dashboard/database/page.tsx` implements a stepped form:

**Step 1 - Connection string**
- choose `PostgreSQL` or `MySQL / MariaDB`
- `type="text"` input (not `type="password"` — password type causes browser password managers to autofill the field with saved credentials, injecting garbage into the DSN)
- `autoComplete="off"` + `spellCheck={false}`
- Client-side validation depends on the selected database type
- Calls `POST /api/v1/database/tables` → loads table list on success

**Step 2 - Table picker**
- Dropdown of tables returned from `/tables`
- "Preview columns" button calls `POST /api/v1/database/preview-columns`
- On success, auto-maps obvious column matches and advances to step 3

**Step 3 - Field mapping**
- 9 rows (one per ScubaSearch field)
- Each row: field label + dropdown of all columns + JSON dot-path suggestions for JSONB columns
- "Title" row marked required (`*`) — validate before submit
- "Connect & sync" button calls `POST /api/v1/database/connect`

**Connected state**
- Shows sync status badge (pending / syncing / done / failed)
- Product count + last synced timestamp when done
- Error message when failed
- "Resync catalog" button (disabled while sync active/pending)
- "Disconnect" with inline confirm

Status polling: `setInterval(loadStatus, 3000)` while `sync_status` is `syncing` or `pending`.

### Supported direct database sources

- PostgreSQL
- MySQL
- MariaDB

Anything else should use one of the generic sync methods instead:

- REST API push
- Webhook sync
- Auto-sync pull

---

## Test Store

`scuba_teststore` Postgres database with 700 clothing products. Schema:

```sql
CREATE TABLE store_products (
    id          SERIAL PRIMARY KEY,
    sku         TEXT,
    name        TEXT NOT NULL,   -- maps to ScubaSearch "title"
    description TEXT,
    price       NUMERIC,
    category    TEXT,
    subcategory TEXT,
    brand       TEXT,
    color       TEXT,
    material    TEXT,
    tags        TEXT,
    image_url   TEXT,
    product_url TEXT,
    stock_qty   INTEGER,         -- maps to ScubaSearch "in_stock"
    is_active   BOOLEAN,
    created_at  TIMESTAMP
);
```

Connection string (local dev): `postgresql://ayush@localhost/scuba_teststore`  
Table: `store_products`  
Non-obvious mappings needed: `name` → title, `stock_qty` → in_stock, `id` → external_id

Seeded by `dev_scuba/seed_teststore.py`.

---

## Source Boundaries

The Database page is now the Postgres-specific source wizard only. Generic REST push, webhook sync, and scheduled pull live on the dashboard's Sync Methods page.

When a client connects an external database:

1. any active API pull connection is removed
2. the next DB sync rebuilds the live catalog from the database source
3. later file uploads or API pull connects will switch the source again and replace the live catalog

---

## What Stays After Disconnect

`DELETE /api/v1/database/disconnect` removes the `database_connections` row only. It does **not** delete products from the `products` table or Meilisearch index. Search keeps working with the last synced database catalog until a new source replaces it or products are manually deleted.
