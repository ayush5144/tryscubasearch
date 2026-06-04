# Phase 6.8 — Postgres Products Table + Inline Editor

## Problem

Currently: CSV uploaded → rows embedded → stored in Meilisearch only → CSV deleted.
No product data in Postgres. No source of truth. Meilisearch index is the only copy.

Consequences:
- Cannot edit a product without re-uploading the whole CSV
- If Meilisearch index is wiped, all catalog data is gone
- Cannot re-index individual products
- Shopify/webhook sync has nowhere to write
- Plan downgrade with data retention is impossible
- Inline editor is impossible

## Decision

Add a `products` table to Postgres. It becomes the source of truth.
Meilisearch remains the search index — populated from Postgres, not from CSV directly.

---

## Postgres Schema

```sql
products
├── id              UUID, PK          — same UUID that goes into Meilisearch as document id
├── client_id       UUID, FK → clients.id
├── external_id     TEXT, nullable    — the id from their CSV/Shopify (stored separately)
├── title           TEXT, NOT NULL
├── description     TEXT
├── price           FLOAT
├── category        TEXT
├── tags            TEXT              — comma-separated string
├── image_url       TEXT
├── product_url     TEXT
├── in_stock        BOOLEAN, default true
├── last_indexed_at TIMESTAMP, nullable  — NULL = never indexed; stale if < updated_at
├── created_at      TIMESTAMP
└── updated_at      TIMESTAMP         — auto-updated on every edit
```

### Stale detection
No `embedding_status` enum. Simple rule:
- `last_indexed_at IS NULL` → never indexed, needs embed+index
- `last_indexed_at < updated_at` → edited since last index, needs re-embed
- `last_indexed_at >= updated_at` → fresh, skip

---

## Updated Ingest Flow

```
CSV / JSON / NDJSON uploaded
         │
         ▼
FastAPI /api/v1/ingest/csv
         │  parse file (existing _normalize_product_dict)
         │  bulk UPSERT into products table (ON CONFLICT external_id DO UPDATE)
         │  set last_indexed_at = NULL on upserted rows
         │  create ingest_job row
         │  delete temp file
         │
         ▼
Celery worker (process_ingest_job)
         │  SELECT * FROM products
         │  WHERE client_id = X
         │    AND (last_indexed_at IS NULL OR last_indexed_at < updated_at)
         │
         │  smart embed logic (existing — unchanged):
         │  ├── new product           → embed + add_documents
         │  ├── text hash changed     → re-embed + add_documents
         │  ├── price/stock changed   → PUT update_documents (no embed)
         │  └── unchanged             → skip
         │
         │  per batch success:
         │  UPDATE products SET last_indexed_at = NOW() WHERE id IN (batch_ids)
         │
         ▼
Meilisearch updated
Redis cache flushed
ingest_job marked done
```

### Single product add (POST /api/v1/products)
Same flow — INSERT into Postgres first, then embed + add_documents, then set last_indexed_at.

---

## New API Endpoints

```
GET    /api/v1/products
       ?page=1&limit=50&q=<search>&category=<partial>&in_stock=true|false&stale_only=true
       → paginated list from Postgres (not Meilisearch)
       → q: title ILIKE partial match
       → category: category ILIKE partial match
       → in_stock: filter by stock status (omit = show all)
       → stale_only: show only products where last_indexed_at IS NULL or < updated_at
       → returns: id, title, price, category, tags, description,
                  image_url, product_url, in_stock,
                  last_indexed_at, updated_at, external_id

PUT    /api/v1/products/{id}
       body: any subset of editable fields
       → UPDATE Postgres row, set updated_at = NOW()
       → if title/description/tags/category changed:
           clear last_indexed_at (triggers re-embed on next index)
       → else (price/stock/image/url only):
           call update_documents() immediately (no re-embed, zero OpenAI cost)
           set last_indexed_at = NOW()
       → flush Redis cache for client

DELETE /api/v1/products/{id}
       → DELETE from Postgres
       → delete_document() from Meilisearch
       → flush Redis cache

POST   /api/v1/products/reindex
       → queue Celery job: re-index all stale products for client
       → returns job_id
```

Existing `POST /api/v1/products` (single product add) — updated to write Postgres first.
Existing `GET /api/v1/me/catalog` — product_count still from Meilisearch stats (accurate).

---

## Dashboard Products Page — TanStack Table

Main page shows two full-width collapsible bars:
- **"Update products"** — file upload UI (auto-detect mode + Advanced override)
- **"View products"** — opens a full-screen overlay (fixed div, `inset:2rem`, not a Dialog)

The overlay contains the table as primary UI. A catalog stats card (product count + last upload) appears below the page title.

### Table columns

```
COLUMN          EDITABLE?   HOW
─────────────────────────────────────────────────────────────────
thumbnail       no          40px image from image_url
title           yes         click → inline text input
category        yes         click → inline text input
tags            yes         click → inline text input
price           yes         click → inline number input
in_stock        yes         checkbox toggle (instant PUT, no Save needed)
description     yes         truncated "Lightweight running sh..." →
                            click → shadcn Popover with full textarea + Save
sync status     no          ✓ (last_indexed_at fresh) / ⚠ (stale)
actions         —           ··· menu → Delete
```

image_url and product_url: shown truncated (domain only) in a popover alongside description.

### Filter bar
Located between overlay header and table body:
- **Category input**: text field, debounced 300ms → `?category=<partial>` ILIKE match
- **In Stock segmented**: All stock / In stock / Out of stock → `?in_stock=true|false`
- **Sync segmented**: All sync / Stale only → `?stale_only=true`
- **"Clear filters"** link appears when any filter is active
- Empty state: "No products match the current filters." shown when filters active and 0 rows

### Interaction model
- View mode (default): read-only cells; clicking any truncated cell expands it in place (no tooltip)
- Edit mode: toggled via View/Edit segmented control in overlay header
- All editable fields in edit mode: click cell → edit → blur/Enter saves (PUT), Escape cancels
- description / image_url / product_url: click → Popover opens → edit → explicit Save button
- in_stock: checkbox, fires PUT immediately on toggle
- "+ Add" button below View/Edit toggle (edit mode only) → opens Add product Dialog
- Pagination: 50 rows/page, page controls in footer
- Optimistic updates with revert on error; fixed toast for feedback
- **ExpandSpan**: stateful component used in view mode for title, category, tags, price, description, external_id, image_url — click toggles `whitespace-normal break-words` (expanded) vs `truncate`

### Stale sync badge
- ✓ green: last_indexed_at is non-null and >= updated_at
- ⚠ amber: last_indexed_at < updated_at (edited but not yet re-indexed)
- — gray: last_indexed_at IS NULL (never indexed — shouldn't happen in practice)
- Clicking ⚠ badge triggers POST /api/v1/products/reindex for that product

---

## Alembic Migration

Migration ID: `b1c2d3e4f5a6` (to be generated)

```python
op.create_table(
    "products",
    sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
    sa.Column("client_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("clients.id"), nullable=False),
    sa.Column("external_id", sa.Text, nullable=True),
    sa.Column("title", sa.Text, nullable=False),
    sa.Column("description", sa.Text),
    sa.Column("price", sa.Float),
    sa.Column("category", sa.Text),
    sa.Column("tags", sa.Text),
    sa.Column("image_url", sa.Text),
    sa.Column("product_url", sa.Text),
    sa.Column("in_stock", sa.Boolean, server_default="true"),
    sa.Column("last_indexed_at", sa.DateTime, nullable=True),
    sa.Column("created_at", sa.DateTime, server_default=func.now()),
    sa.Column("updated_at", sa.DateTime, server_default=func.now(), onupdate=func.now()),
)
op.create_index("ix_products_client_id", "products", ["client_id"])
op.create_index("ix_products_external_id", "products", ["client_id", "external_id"])
op.create_index("ix_products_stale", "products", ["client_id", "last_indexed_at", "updated_at"])
```

---

## What This Unlocks

| Feature                          | After 6.8 |
|----------------------------------|-----------|
| Inline product editor            | ✅        |
| Delete individual product        | ✅        |
| Catalog survives Meilisearch wipe| ✅        |
| Re-index on demand               | ✅        |
| Plan downgrade + data retention  | ✅        |
| Shopify webhook sync             | ✅        |
| Analytics on product data        | ✅        |

---

## Files Changed

| File | Change |
|------|--------|
| `backend/db/models.py` | Add `Product` model |
| `alembic/versions/b1c2d3e4f5a6_add_products_table.py` | Migration |
| `backend/routers/ingest.py` | Bulk upsert to Postgres before queuing Celery |
| `backend/routers/products.py` | GET list, PUT update, DELETE, POST reindex |
| `backend/workers/tasks.py` | Read from Postgres instead of CSV; write last_indexed_at |
| `frontend/lib/api-client.ts` | getProducts(), updateProduct(), deleteProduct(), reindexProducts() |
| `frontend/app/dashboard/products/page.tsx` | Full rewrite: TanStack Table + upload in collapsible panel |
