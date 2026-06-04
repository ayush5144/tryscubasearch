# Meilisearch — How It Works
*ScubaSearch internal notes — March 2026*

---

## What Meilisearch actually is

Think of it as a specialized database that's built for one thing: **finding documents by text and meaning, extremely fast.**

A normal database (Postgres) can search text with `LIKE '%running shoes%'` — but it's slow, doesn't handle typos, doesn't understand meaning, and has no concept of relevance. Meilisearch solves all of that.

---

## How it stores data

You send it JSON documents. It stores them and builds an **inverted index** — think of it like the index at the back of a textbook. Every word in every document gets mapped to every document it appears in. When you search, it looks up the word in the index (instant) rather than scanning every document (slow).

Your documents look like:
```json
{ "id": "123", "title": "Nike Air Max", "category": "Running", "price": 4999, "tags": ["nike","running"] }
```

You have 4 indexes: `products_testclient`, `products_testclient2`, `products_testclient3`, and `products_00000000-...-0001` (real UUID client with the 229 sneakers).

---

## How it finds results — two engines running simultaneously

### Engine 1: BM25 (keyword matching)

When someone searches "running shoes", Meilisearch finds all documents containing "running" and "shoes". It then scores them with a formula called BM25 that considers:
- How often the word appears in that document
- How rare the word is across all documents (rare = more signal)
- Document length (short documents score relatively higher)

"Nike Air Max running shoe" scores higher than "This is a comfortable running shoe perfect for everyday running" because the term density is better, not because the first one mentions running more times.

### Engine 2: Vector/semantic search

Before a document goes into Meilisearch, your Celery worker calls OpenAI's `text-embedding-3-small` and gets back 1,536 numbers — a vector. That vector is a point in 1,536-dimensional space that represents the *meaning* of the document. Similar meanings end up near each other in that space.

When someone searches "comfortable footwear for long walks", your FastAPI backend calls OpenAI to get the vector for that query, then passes it to Meilisearch, which finds documents whose vectors are mathematically close to it. "orthopedic walking shoe" comes back even though none of those words matched.

Your live index has this configured correctly:
```
embedders: { default: userProvided, dimensions: 1536 }
```
`userProvided` means Meilisearch does NOT call OpenAI — your app generates all vectors and passes them in. This is the right approach.

### Hybrid search: both at once

You set `semanticRatio: 0.5` — meaning the final score is 50% from BM25 keyword score + 50% from vector similarity score. Results get merged and re-ranked. This is why "niky" finds Nike (BM25 handles the typo) AND "comfortable footwear" finds athletic shoes (semantic handles the meaning mismatch).

---

## Ranking rules — how ties are broken

After candidates are found, Meilisearch applies rules in order to decide who ranks first. Your live config:

```
words → typo → proximity → attribute → sort → exactness
```

- **words**: documents matching more of your search terms rank higher
- **typo**: documents with fewer typo corrections rank higher (exact match beats 1-typo match)
- **proximity**: documents where your search terms appear near each other rank higher ("running shoes" in sequence > "running... shoes" 50 words apart)
- **attribute**: matches in `title` rank higher than matches in `description` (based on your `searchableAttributes` order)
- **sort**: applies any explicit sort you pass (e.g., sort by price)
- **exactness**: exact word matches beat prefix matches

---

## Typo tolerance

Your live config:
```
oneTypo: 3 chars minimum, twoTypos: 7 chars minimum
```

This means:
- "niky" (4 chars, 1 edit from "nike") → finds Nike ✅
- "adidass" (7 chars, 1 edit from "adidas") → finds Adidas ✅
- "ru" → no typo correction (too short)

We fixed this from the default (which was 5 chars for one typo, missing short brand names entirely).

---

## Settings explained

### synonyms
Teach Meilisearch that different words mean the same thing. "sneakers" = "trainers" = "kicks" = "athletic shoes". Without this, searching "trainers" won't find a product titled "running sneakers" even though they're the same thing. You add synonym pairs and Meilisearch treats them as interchangeable at search time. Useful for ecommerce where customers use regional/slang terms your catalog doesn't.

### stopWords
Words to completely ignore during indexing and search. "the", "a", "is", "for", "of". Searching "shoes for running" right now indexes "for" as a word — wastes space and adds noise. Adding stop words makes indexes smaller and searches slightly faster/cleaner. Low priority but worth setting for prod.

### searchCutoffMs
A hard timeout on any single search query. If Meilisearch takes longer than this (in milliseconds), it returns whatever results it has so far rather than hanging. Without it, a pathologically slow query (huge index, complex filter) could block a search worker indefinitely. For prod, something like `150ms` is a safe ceiling — cached searches return in 2ms, cold searches in 20-30ms, so 150ms gives plenty of headroom before cutting off.

---

## What your live settings look like right now

Running Meilisearch v1.12.8. Main production index settings:

| Setting | Value | Status |
|---|---|---|
| searchableAttributes | title, tags, category, description | ✅ correct order |
| filterableAttributes | category, in_stock, price, tags | ✅ |
| sortableAttributes | price | ✅ |
| embedder | userProvided, 1536 dims | ✅ correct |
| typoTolerance | oneTypo≥3, twoTypos≥7 | ✅ fixed |
| synonyms | none | ⚠️ worth adding later |
| stopWords | none | fine for now |
| searchCutoffMs | none | ⚠️ set for prod (recommended: 150ms) |

---

## The one thing most people misunderstand about Meilisearch

It's not a database. You don't query it for business logic. You don't do `WHERE client_id = X AND plan = 'active'`. That's Postgres's job.

Meilisearch's only job is: **given a text query + optional filters, return the most relevant documents, fast.** Everything else — auth, billing, rate limiting, analytics — lives in your FastAPI/Postgres layer. The two systems talk only at search time and ingest time.

That separation is exactly how your architecture is built, and it's correct.

---

## How ScubaSearch uses Meilisearch

```
Shopper types query
        │
        ▼
FastAPI embeds query via OpenAI → 1536-dim vector
        │
        ▼
Meilisearch hybrid search:
  BM25 (keyword) + vector (semantic) simultaneously
  semanticRatio: 0.5
  index: products_{client_id}
        │
        ▼
Results ranked by combined score
FastAPI boosts in-stock items, slices top 8
        │
        ▼
Cached in Redis (1hr TTL, key = SHA256(client_id + query))
        │
        ▼
Returned to widget → rendered as dropdown
```

On cache hit: ~2ms. On cache miss: ~150-300ms (OpenAI embed + Meilisearch search).

---

## One index per client

Every store owner gets their own isolated Meilisearch index: `products_{client_uuid}`. Store A's products never appear in Store B's search results. The index is created when a client first uploads a CSV. Isolation is enforced by deriving `client_id` from the API key server-side — it cannot be faked.