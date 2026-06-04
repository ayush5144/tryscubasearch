# Meilisearch — Document Operations & Catalog Sync
*ScubaSearch internal notes — March 2026*

---

## The 3 Document Operations Meilisearch Provides

Meilisearch has distinct endpoints for different update patterns. Using the wrong one costs money (unnecessary embeddings) or breaks catalogs (ghost products).

| Operation | SDK call | HTTP | Behaviour | Re-embed? |
|---|---|---|---|---|
| Add or replace | `index.add_documents(docs)` | POST | Full upsert — if id exists, entire document **replaced** including `_vectors` | Yes — always |
| Partial update | `index.update_documents(docs)` | PUT | Only fields you send change. All other fields, including `_vectors`, are **preserved** | No |
| Delete all | `index.delete_all_documents()` | DELETE | Wipes all docs, keeps index + settings | — |
| Swap indexes | `client.swap_indexes([...])` | POST `/indexes/swap-indexes` | Atomically swaps two indexes. Instant. Zero downtime. | — |

The key distinction: **add_documents** = replace the whole document, **update_documents** = patch only what you send.

---

## The Ghost Product Problem

When a store owner re-uploads a CSV to update prices, there's a ghost product risk:

```
Store has: prod_001 "Nike Air Max" ₹5999
Re-upload: prod_001 "Nike Air Max" ₹6499   → WORKS, price updated

But if they renamed:
Old:       prod_001 "Nike Air Max" ₹5999
Re-upload: prod_001 "Nike Air Force 1" ₹6499  → also works (id stable)

And if NO id column (MD5 hash fallback):
Old:       hash("Nike Air Max") = "abc123"  ₹5999
Re-upload: "Nike Air Force 1" → hash = "xyz789" → NEW document added
           "Nike Air Max" stays in index → ghost product ❌
```

The MD5 hash fallback is safe for price/description updates as long as title doesn't change. It breaks on renames. The only complete fix for ghost products is the **swap-indexes pattern**.

---

## The Swap-Indexes Pattern — Zero-Downtime Full Replacement

This is Meilisearch's official recommended approach for full catalog replacement. It's what we use for "Replace catalog" mode.

```
Current state:
  products_{client_id}         ← live, shoppers searching this
  (doesn't exist yet)          ← pending

Step 1: Create pending index with same settings
  products_{client_id}         ← still live, shoppers still searching
  products_{client_id}_pending ← building, empty

Step 2: Embed + push all documents into pending (takes minutes for large catalogs)
  products_{client_id}         ← still live throughout this entire time
  products_{client_id}_pending ← filling up with new data

Step 3: swap-indexes([products_{client_id}, products_{client_id}_pending])
  products_{client_id}         ← instantly contains new data ✅
  products_{client_id}_pending ← now contains old data

Step 4: Delete products_{client_id}_pending
  products_{client_id}         ← new data, live
  (gone)
```

The swap is **atomic and instant**. Shoppers never see an empty index. No ghost products because the new index is built from scratch.

Compare to the naive approach:
```
❌ Naive: DELETE all docs → re-index
  During re-indexing: index is empty → shoppers get zero results
  Could be 10-30 minutes for a large catalog
```

---

## The 3 Upload Modes ScubaSearch Implements

### Mode 1: `replace` (default) — Full catalog sync

**When:** First upload, complete catalog refresh, any time you want to wipe and start fresh.

**Flow:**
```python
# 1. Parse CSV → embed all products
# 2. _ensure_index(pending_index)
# 3. index_pending.add_documents(docs_with_vectors)  # all products, full embed
# 4. client.swap_indexes([{client_index, pending_index}])
# 5. delete pending_index
# 6. flush Redis cache for client
```

**Id column:** Optional — MD5 hash fallback works since we're rebuilding from scratch anyway.

**Cost:** Full OpenAI embed for every product. Same as today.

---

### Mode 2: `append` — Add or update specific products

**When:** Adding new arrivals, updating a subset of products (with full product data).

**Flow:**
```python
# 1. Parse CSV → embed only the rows in this file
# 2. index.add_documents(docs_with_vectors)  # upsert into live index
# 3. flush Redis cache
```

**Id column:** **Required.** Without a stable id, adding 3 new products creates 3 new entries with no way to deduplicate on next append. Return 400 if no id column.

**Cost:** Embeddings only for the products in this CSV (not the whole catalog).

**No ghost products:** Only affects the ids in this CSV. Existing products not in this file are untouched.

---

### Mode 3: `update` — Partial field update (price, stock, etc.)

**When:** Daily price sync, inventory updates — you know which ids changed, you only have the changed fields.

**Flow:**
```python
# 1. Parse CSV — only id + changed fields (price, in_stock, etc.)
# 2. NO embedding — _vectors not in the payload
# 3. index.update_documents(partial_docs)  # PUT endpoint, patches only sent fields
# 4. flush Redis cache
```

**Id column:** **Required.** You must know which document to patch.

**Cost:** Zero — no OpenAI calls. A price CSV with 10,000 rows costs $0 and completes in seconds.

**Key constraint:** `_vectors` are preserved because they're not in the payload. The product's semantic meaning doesn't change when the price changes.

---

## CSV Shape per Mode

**Replace / Append:**
```csv
id,title,description,price,tags,category,image_url,product_url,in_stock
prod_001,Nike Air Max,...
```
Full product data. Embeddings are generated from title + category + tags + description.

**Update:**
```csv
id,price,in_stock
prod_001,6499,true
prod_002,3299,false
```
Only id + fields to change. No title needed. No embedding. Can even be just `id,price`.

---

## Implementation in tasks.py

```python
@celery_app.task(...)
def process_ingest_job(self, job_id, client_id, csv_path, mode="replace"):
    if mode == "replace":
        _run_replace(job_id, client_id, csv_path)
    elif mode == "append":
        _run_append(job_id, client_id, csv_path)
    elif mode == "update":
        _run_update(job_id, client_id, csv_path)
```

**Replace** uses `_ensure_index(pending)` → `add_documents` → `swap_indexes` → delete pending.

**Append** validates id column present → `add_documents` on live index.

**Update** validates id column present → `update_documents` (partial PUT) on live index. No embedding step.

---

## Swap Indexes — Python SDK

```python
# The Python SDK method:
task = meili.swap_indexes([{"indexes": [index_a_uid, index_b_uid]}])
meili.wait_for_task(task.task_uid)
```

The swap swaps: documents, settings, and task history. Both indexes must exist before swapping.

---

## What This Means for Store Owners

| Scenario | Mode to use | Time | Cost |
|---|---|---|---|
| First upload | replace | Minutes (embedding) | Full catalog |
| Monthly catalog refresh | replace | Minutes | Full catalog |
| Adding 5 new products | append | Seconds | 5 products only |
| Daily price sync from ERP | update | Seconds | $0 |
| Inventory in/out of stock | update | Seconds | $0 |
| Renamed 50 products | replace | Minutes | Full catalog |

---

## Ghost Products — Final Summary

| Scenario | Ghost products? | Fix |
|---|---|---|
| replace mode, any CSV | Never | Swap builds fresh |
| append mode, has id column | Never | Only upserts provided ids |
| append mode, no id column | Possible if title changes | Require id column in append mode |
| update mode | Never | Partial update, doesn't touch other docs |

The only ghost product scenario that can still happen: someone uses append mode without an id column and a product title changes. We prevent this by rejecting append/update mode CSVs that have no id column.
