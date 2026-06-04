# Ingest Pipeline Design Decisions

Technical notes on decisions made during ingest pipeline design. These capture the reasoning and rejected alternatives — not just what was built.

---

## Upload Formats Supported

Three formats accepted: CSV, JSON, NDJSON.

**JSON**: array of objects — `[{"title": "...", "category": "Thriller"}, {...}]`. Parsed with `json.load()`. If the top-level value is not a list, reject with 422.

**NDJSON** (newline-delimited JSON): one JSON object per line. Common export format from ETL pipelines, CMS exports, and backend jobs. Parsed line-by-line with `json.loads()` per line, skipping blank lines.

**CSV**: existing behavior — `csv.DictReader`, flexible column aliases.

All three formats go through the same `_normalize_product_dict()` function after parsing. This function applies the same `_COLUMN_ALIASES` mapping that the CSV parser uses. The current aliases are OTT/content-oriented, covering common variations like `genre`, `cast`, `release_year`, `watch_url`, `poster_url`, `type`, and `runtime`.

ID detection (`_file_has_id_column()`):
- CSV: checks header row for any alias mapping to `id`
- JSON/NDJSON: checks keys of first object in the payload

Same alias-aware detection across all three formats.

---

## Smart Auto-Detection (No Mode Selector)

The upload flow is fully automatic. The user uploads a file; the system decides what to do. No dropdown, no radio buttons, no mode selection.

Decision tree:

```
File uploaded
    ↓
product_count == 0?
    └── Yes → Replace mode. No questions asked.

    └── No → File has ID column?
                ├── No → Warning modal:
                │         "No ID column found. This will replace all X products. Continue?"
                │         [Cancel] [Replace anyway]
                │
                └── Yes → Is the file a full catalog or a partial file?
                            │
                            ├── Full file (has title, category, image_url, etc.)
                            │     → POST add_documents (upsert)
                            │     → Re-embeds every product in the file
                            │     → New IDs: added to index
                            │     → Existing IDs: fully overwritten (all fields)
                            │     → IDs not in file: untouched (no deletion)
                            │     → UI banner: "Smart sync" (blue)
                            │
                            └── Partial file (only id + a few columns, missing title/image)
                                  → PUT update_documents (partial update)
                                  → Zero OpenAI calls — _vectors untouched
                                  → Only fields present in file get changed
                                  → UI banner: "Partial update — only X fields will change" (blue)
```

### Why This Is Better Than Exposing Modes

The old design had three manual modes: Replace / Sync+Add / Update fields only. Store owners had to understand the difference between Meilisearch's `add_documents` and `update_documents` behavior to pick the right one. That is an internal implementation detail that belongs in the backend, not in the UI.

Auto-detection removes all cognitive load from the upload flow. The user just uploads their file. The system infers the correct behavior from the shape of the data.

An "Advanced" toggle is preserved for power users who need to override the auto-detected mode (e.g., they have a partial file but want a full replace). This panel is hidden by default.

---

## Why Two Backend Methods Matter

This is the core of why auto-detection is necessary and why getting it wrong silently breaks things.

**POST `add_documents` (Meilisearch)**:
- Full document replacement per matching ID
- If you send `{"id": "123", "year": 2025}` (no title, no image), Meilisearch stores exactly that — `title` and `image_url` fields are gone
- Used for: first upload, smart sync (full catalog re-upload), replacing all products

**PUT `update_documents` (Meilisearch)**:
- Partial update — only fields present in the payload get changed
- `_vectors` is not part of the document payload, so it is never touched
- Used for: partial file (id + a few fields to change)
- Zero OpenAI cost automatically — not an optimization we need to code, it falls out of the Meilisearch API behavior

If the system sends a partial file through `add_documents`, products get corrupted silently. Title, description, and image disappear. Search quality degrades immediately and the user has no idea why. Auto-routing prevents this class of bug entirely.

---

## Re-Embedding Decision

**Phase 6.7 decision: smart embed implemented in append mode (only changed products get re-embedded).**

`_run_append` now fetches existing `{id → _text_hash}` from Meilisearch before embedding. Each incoming product's text hash `SHA256(title+category+tags+description)` is compared against the stored hash:

- **ID not in index** → embed + `add_documents` (new product)
- **Hash changed** → re-embed + `add_documents` (text edited)
- **Hash same, metadata-only fields changed** (`actors` / `director` / `writer` / `content_type` / `year` / `language` / `duration_mins` / image / URL) → `update_documents` PUT (zero OpenAI cost, vectors untouched)
- **Nothing changed** → skip entirely (zero API calls, zero Meilisearch writes)

`_text_hash` is stored on every document that goes through `add_documents`. Old documents without `_text_hash` are treated as new (hash mismatch → re-embed on first run after deploy, after which they have hashes and get skipped correctly).

**Replace mode is unchanged** — still re-embeds everything. Replace builds a fresh index from scratch; there is no "existing" state to compare against.

**Tested results (710-product catalog):**
- 2 new products added to file → 2 embed calls
- 3 documents with changed metadata-only fields → 0 embed calls (PUT only)
- 707 products unchanged → 0 embed calls, 0 Meilisearch writes

### Partial File Exception (unchanged)

The explicit partial update mode (PUT `update_documents`) still has zero embedding cost automatically. `_vectors` is absent from the payload; Meilisearch preserves the existing vector untouched.

---

## Stale Vectors

Not a current concern under the chosen approach:

- **Full upload (POST)**: every product in the file gets fresh embeddings. `_vectors.default` is populated from the new embedding call and sent with the document. Meilisearch stores the new vector. No stale vectors possible.

- **Partial upload (PUT)**: `_vectors` is absent from the payload. Meilisearch's partial update semantics preserve the existing vector. Since the text fields that drive the embedding are not changing, the existing vector is still accurate.

Stale vectors only become a risk if we build the skip-embedding optimization described above and the hash comparison has a bug. Since we are not building that, stale vectors are not a risk.

---

## Mode Selector — Removed

Old design:
- Three radio buttons or a dropdown on the upload page: Replace / Sync+Add / Update fields only
- User had to select the correct mode before uploading

New design:
- No mode selector visible to the user
- System detects mode from: (a) whether products already exist, (b) whether the file has an ID column, (c) whether the file is a full or partial catalog
- Advanced toggle (collapsed by default) reveals three card-style buttons for manual override: Replace / Smart Sync / Update Fields Only

The advanced panel exists for cases where auto-detection gets it wrong or the user has a specific need (e.g., force-replace even with an ID column). It is not surfaced in the normal flow.

---

## Single Product Add Form ✅ Built

For store owners who need to add or update a single product without uploading a file.

**Backend**: `POST /api/v1/documents` (registered on `products_router` in `backend/routers/ingest.py`)
- Fields: `title` (required), `description`, `image_url`, `product_url`, `category`, `tags`, `actors`, `director`, `writer`, `content_type`, `year`, `language`, `duration_mins`
- `id` optional — if not provided, generates `prod_{uuid4().hex[:16]}` (not MD5 — more collision-safe)
- Embeds `title + description`, calls `ensure_index` (idempotent), calls `add_documents` with single doc, INSERTs into Postgres with `last_indexed_at=NOW()`
- Synchronous — no Celery job, no ingest_jobs row; responds with the stored id + title
- Plan limit enforced before embedding (same gate as CSV upload)
- Clerk JWT auth (same as ingest routes)

**Frontend**: Dialog popup opened from inside the products table overlay. In Edit mode, a "+ Add" button appears below the View/Edit toggle in the header. `handleAddProduct()` → `addProduct()` → refreshes catalog count → auto-closes on success.

---

## ID Column — When Required

| Scenario | ID column required? | Notes |
|---|---|---|
| First upload | No | Deterministic fallback identity generated from title + product_url + year + content_type + language |
| Smart sync (full re-upload) | Yes | Needed to match existing products for upsert |
| Partial update (fields only) | Yes | Needed to target which product to update |
| Replace all | No | Deletes entire index, starts fresh — IDs irrelevant |
| Single product add form | No | ID generated if missing |

**Fallback IDs are stronger than the old title-only hash, but real source IDs are still better.** The current fallback uses stable identity fields instead of title alone, which reduces accidental collisions and duplicate growth. But catalogs with any serious sync workflow should still include an explicit `id` column. That should stay clear in the upload UI and documentation.

---

## What "Partial File" Means (Detection Logic)

A file is considered partial if it meets both conditions:
1. Has an ID column (required — otherwise auto-detection routes to replace/warn)
2. Is missing at least one of these key columns: `title`, `description`, `image_url`, `product_url`

The logic is: if you have IDs but no titles and no images, you're probably sending a metadata patch, not a full catalog upload.

Detection runs client-side on the first line or first object of the file before the upload starts. This drives the pre-upload banner ("Partial update — only X fields will change") and the mode routing in the backend.

Edge cases:
- File has `id` + `title` but no `image_url` or `description` → detected as full (has title, so it's a meaningful product document, not just field patches)
- File has `id` + `year` only → detected as partial (missing title, description, image)
- The threshold is intentionally loose — false partial detection routes to PUT which is safe (won't corrupt data); false full detection routes to POST which could wipe missing fields (worse)

A stricter definition could check for title specifically. The current definition requires absence of title AND image AND description AND product_url. Revisit if false positives are reported.

---

## Product Count Tracking

Two new fields on `ingest_jobs`: `added_count` and `updated_count`.

**Replace mode**: `added_count` = total products in file. `updated_count` = 0. Everything was deleted and re-added, so technically everything is new.

**Append mode (POST add_documents)**: `added_count` = products in file whose IDs did not previously exist in the index. `updated_count` = products in file whose IDs already existed. Computed as: product_count_after - product_count_before = added_count; total_processed - added_count = updated_count.

**Update mode (PUT update_documents)**: `added_count` = 0 (no new products created). `updated_count` = total rows processed.

Both fields stored in `ingest_jobs` table (migration `a2b3c4d5e6f7`), returned in `GET /api/v1/ingest/jobs/{id}`, surfaced in the done-state UI as "X products added, Y updated".

---

## Append-to-Empty Guard

Edge case: user selects "append" mode (via advanced panel) but the index is empty. Appending to an empty index is semantically identical to replacing — the result is the same. But if the file has no ID column, append mode requires IDs (to enable future upserts).

Guard: if mode=append and product_count=0 and file has no ID column, auto-promote to replace mode. This prevents the user from building an index without IDs that they can never reliably update later.

---

## Decisions Deferred / Not Made

- **Native platform connectors beyond current sync methods**: webhook/push/pull flows exist today, but richer first-party CMS connectors could still improve setup speed and metadata quality later.

- **Multi-image support**: `image_url_2`, `image_url_3` columns. Currently only first image stored. Deferred.

- **Variant handling**: products with size/color variants (e.g., Shopify variant rows). CSV exports typically have one row per variant. Not handled — currently each variant row becomes a separate product. Deferred.

- **Skip-embedding optimization**: hash-based reuse of existing vectors. Rejected above. Not building pre-launch.

- **50MB file size limit**: deferred to Phase 6 cleanup. Currently no limit enforced.
