# Current Batching and Large Upload Behavior

Status: current behavior
Updated: 2026-05-04

This note explains the batching and indexing behavior exactly as it works in the code today.

It is intentionally written in plain language.

---

## Short version

Two different batch sizes are involved during indexing:

1. **Embedding batch size**
   - `_EMBED_BATCH = 100`
   - this controls how many documents are sent to the embeddings API in one call

2. **Meilisearch write batch cap**
   - `_MEILI_BATCH_DOCS = 200`
   - this caps how many documents we want to send to Meilisearch in one indexing call
   - there is also a byte safety cap:
     - `_MEILI_MAX_BATCH_BYTES = 10 MB`
     - `_MEILI_BYTES_PER_DOC = 15,000`

Important nuance:

- in the main embed-heavy flows, the worker already loops in batches of `100`
- so Meilisearch usually receives those same `100` documents at a time
- that means the `200`-document Meilisearch cap is mostly a **safety guard**, not the normal active batch size

So the real practical behavior today is:

- **OpenAI / Azure-style embedding step:** usually `100` documents at a time
- **Meilisearch indexing step:** also usually `100` documents at a time in those same flows

---

## Where this happens in the code

Batch constants live in:

- `backend/workers/tasks.py`

The helper flow is:

1. fetch rows
2. build embed text
3. embed documents in batches of `100`
4. build Meilisearch documents
5. send them through `_push_to_meili()` or `_update_in_meili()`
6. those helpers can split again if needed

The helper functions are:

- `_meili_safe_chunks(docs)`
- `_push_to_meili(meili, index_name, docs)`
- `_update_in_meili(meili, index_name, docs)`

---

## What happens on a normal file upload

### Step 1

The user uploads a CSV, JSON, or NDJSON file to FastAPI.

At this stage:

- the file upload itself is still one request
- the new batching does **not** split the browser upload into smaller HTTP requests

### Step 2

FastAPI parses the file and writes the normalized rows into Postgres first.

Postgres remains the source of truth.

### Step 3

Celery starts the ingest job and reads rows back from Postgres.

### Step 4

The worker processes the documents in embed batches:

- `0..99`
- `100..199`
- `200..299`
- and so on

For each of those batches:

1. build embedding text
2. call the embeddings API with up to `100` documents
3. build Meilisearch documents
4. push those documents to Meilisearch
5. wait for the Meilisearch task to finish
6. mark those rows indexed in Postgres

So for a normal embed-heavy upload, the actual rhythm today is:

- embed `100`
- index those `100`
- wait
- repeat

---

## Example: 7,000 products

If a user uploads a catalog with `7,000` products, and it goes through a full embed flow such as:

- replace
- append with new or changed text
- DB sync
- API pull sync

then the practical behavior is:

- about `70` embedding API calls
- about `70` Meilisearch pushes
- each wave is usually around `100` documents

This is because:

- `_EMBED_BATCH = 100`
- the Meilisearch helper receives those `100` docs
- the Meilisearch helper checks whether it needs to split further
- with `100` docs, it usually does **not** need to split further

---

## Example: 120 MB upload

This is the important distinction.

### What is protected now

The worker-side indexing path is safer than before:

- we no longer rely on one big Meilisearch write
- Meilisearch writes are funneled through chunk helpers
- task waits are longer and safer

So the **Postgres -> Meilisearch** part is more resilient.

### What is not fully protected yet

The **browser -> FastAPI upload** is still one large file upload.

That means a `120 MB` file can still stress:

- request size handling
- file parsing memory
- time spent parsing before the worker starts

So the current batching improvements do **not** fully solve huge upload-request handling by themselves.

They mainly harden the **indexing stage after the data is already inside the app**.

That is why these changes are best described as:

- **indexing hardening**
- not full **upload transport hardening**

---

## What happens when a database is connected

Yes, in the current DB sync flow we still effectively process about `100` documents at a time in the embed-heavy stage.

Why:

- DB sync reads rows from the external database
- then loops over those rows in `_EMBED_BATCH` windows
- each loop embeds up to `100` documents
- then pushes those Meilisearch documents through `_push_to_meili()`

So for database sync:

- **yes**, it still works in `100`-document waves in practice
- the `200`-document Meilisearch cap is still there as a safety guard

The same is true for API pull sync.

---

## What changed compared with earlier behavior

Before these changes:

- the worker already processed many flows in batches of `100`
- Meilisearch writes happened directly at several call sites
- some sync paths used shorter Meilisearch wait timeouts such as `30s`

After these changes:

- Meilisearch writes are centralized through helper functions
- those helpers can split into smaller sub-batches if needed
- Meilisearch waits are standardized to `120s` in these worker flows
- batch-sizing rules now live in one place instead of being scattered

So this is a real improvement, but it is not a total redesign of ingestion.

The best way to describe it is:

- **more robust indexing behavior**
- **safer Meilisearch write handling**
- **not yet a complete large-upload transport solution**

---

## Final plain-language answer

If a user uploads a large file or connects a database:

- the app still writes data to Postgres first
- the worker still embeds about `100` documents at a time
- the worker still usually sends about `100` documents at a time to Meilisearch in those embed-heavy flows
- the `200`-document Meilisearch cap exists as a guard, but it usually does not become the active limit in those flows

So if you are asking:

> Do we still send 100 documents at a time?

For the main current embed-heavy flows:

- **yes, effectively we do**

And if you are asking:

> Is the new code still useful then?

Also yes:

- it centralizes the Meilisearch write behavior
- gives us safer task waits
- gives us a guardrail if internal batch sizes grow later
- makes the indexing stage more stable than before

---

## What we discussed and agreed on

### 1. What is already true today

- the main embed-heavy worker flows were already running in batches of `100` earlier
- after the recent changes, they still effectively run in batches of `100` in practice
- the new Meilisearch caps are real guardrails, but they do not usually change the active batch size in those flows

So the recent work should be described as:

- indexing hardening
- not a full redesign of upload handling

### 2. What is still not fully solved

The unsolved part is the **initial large upload request path**.

For a very large CSV or JSON upload:

1. the whole file still reaches FastAPI first
2. FastAPI still has to read and parse it
3. the rows still need to be written into Postgres
4. only after that does worker-side batching help

So the current system is stronger at:

- Postgres -> worker -> Meilisearch

than it is at:

- browser -> FastAPI large-file transport

### 3. What a large upload means in practice

Example:

- `50 MB` CSV
- `50,000` documents

The likely behavior today is:

- upload accepted as one request
- file parsed by FastAPI
- rows written to Postgres
- worker runs roughly `500` embed batches
- worker runs roughly `500` indexing waves

So the concern is more about:

- long job duration
- heavier upload and parse cost
- more embedding calls

than about one huge Meilisearch indexing call.

### 4. What we do and do not need right now

We do **not** necessarily need to build full giant-upload transport hardening immediately.

What matters right now:

- the worker indexing path is safer than before
- we should be honest that giant upload handling is not fully hardened yet
- larger catalogs are often better served by:
  - database sync
  - auto-sync pull
  - REST push

### 5. Current recommendation

Near-term product posture:

- keep the current worker batching
- keep Postgres-first ingestion
- use DB sync / pull sync / REST push for larger catalogs
- do not overstate dashboard file-upload robustness for very large uploads

### 6. If we choose to improve this later

The next sensible upload-side improvements would be:

1. app-side upload size guardrails
2. clearer product messaging for very large catalogs
3. optional stronger large-file handling later, such as streaming or staged upload improvements

For now, the main system truth is:

- large catalogs are handled more safely **after ingestion starts**
- giant upload requests are **not yet** fully optimized at the transport boundary
