# Multi-Format Sync

Status: implemented
Date: 2026-05-05

## What was added

Two sync methods now accept CSV, JSON, and NDJSON — not just JSON.

### 1. `POST /api/v1/push/file` — new endpoint in `routers/push.py`

API-key authenticated file upload. Accepts `.csv`, `.json`, and `.ndjson` files via multipart form data.

```
POST /api/v1/push/file?mode=replace
Authorization: Bearer sk_live_...
Content-Type: multipart/form-data

file=@catalog.csv   (or .json / .ndjson)
```

`mode` is a **query parameter** (not a form field) — pass it in the URL: `?mode=replace`, `?mode=append`, `?mode=update`. Default is `append`.

- Format detected from file extension (`.csv`, `.json`, `.ndjson`)
- Saves file to `UPLOAD_DIR`, parses with existing `_parse_uploaded_file_sync`, upserts to Postgres, queues `process_ingest_job` Celery task
- Same source-switching logic as `_queue_bulk_json_ingest` (DB and API pull connections force replace)
- Same billing checks as rest of push router
- Returns `BulkPushResponse` — poll `/api/v1/ingest/jobs/:id` for status
- `trigger` in `ingest_jobs` = `rest_api_push`, `file_format` = `csv` / `json` / `ndjson`

This is the programmatic equivalent of the browser upload at `/api/v1/ingest/csv` (Clerk JWT), but uses API key auth — suitable for scripts, CI pipelines, and backend integrations.

### 2. Auto-sync pull — CSV and NDJSON remote URLs

`services/api_sync.py` now supports remote endpoints that return CSV or NDJSON.

Format is detected from the `Content-Type` response header first, then falls back to the URL file extension:

| Content-Type                          | or URL ending | Format |
|---------------------------------------|---------------|--------|
| `text/csv`, `application/csv`         | `.csv`        | CSV    |
| `application/ndjson`, `*ndjson*`      | `.ndjson`     | NDJSON |
| anything else                         | —             | JSON   |

New helpers:
- `_detect_format(url, content_type) -> str`
- `_parse_csv_text(text) -> list[dict]` — uses `csv.DictReader`
- `_parse_ndjson_text(text) -> list[dict]` — line-by-line `json.loads`, skips malformed lines
- `fetch_remote_source(url, headers) -> (data, format)` — replaces `fetch_remote_json` for new callers

For CSV and NDJSON remote sources, `items_path` is ignored (both formats are already flat lists). `fetch_remote_json` is kept unchanged for backwards compatibility.

Field mapping works identically across all three formats — the `get(field)` function maps ScubaSearch field names to column/key names in the source, which produces flat dicts for all three formats.

**Use cases:**
- Google Sheets published as CSV (`File → Share → Publish to web → CSV`)
- Internal data export pipelines that produce NDJSON
- Any HTTP endpoint returning `Content-Type: text/csv`

## Format freedom — no cross-format restrictions

Uploading in a different format from the previous upload does **not** force a replace. Format is a parsing detail — after normalisation, a CSV row, a JSON object, and an NDJSON line produce identical product dicts. You can freely mix:

- replace with CSV → append with NDJSON → update with JSON → all valid
- The catalog accumulates correctly as long as IDs match

This was a deliberate change from the original behaviour, which forced replace on any format change. That rule was a conservative early guard that predated multi-format support. It is now removed.

## The one thing that still forces replace: source switching

If the client is currently sourced from a **database connection** (`/api/v1/database`) or an **API pull sync** (`/api/v1/api-sync`), any push (file, JSON, webhook) forces `mode=replace`, regardless of what mode was requested.

Why: these are different catalog ownership models. A DB-sourced catalog is owned by the connected Postgres/MySQL table. A push overrides that ownership — it is inherently a full handover, not a partial update on top of a foreign catalog. Forcing replace ensures:

1. The old source's docs are wiped before the new push takes over.
2. The client row is updated to mark the source as `csv` (file-based), replacing `database` or `api_pull`.
3. There is never a state where half the catalog came from the DB and half from a push.

This is enforced in `_queue_bulk_json_ingest` (JSON push), `push_file` (file upload), and `upload_csv` (browser upload) — all three check `has_database_connection` and `has_api_sync_connection` before proceeding.

## What webhook sync does NOT support

Webhook sync (`POST /api/v1/push/webhook`) remains JSON-only. Webhooks are event notifications — they carry small, real-time payloads for single publish or metadata events. Sending CSV over a webhook does not match the pattern and was intentionally not added.

## Files changed

| File | Change |
|------|--------|
| `backend/routers/push.py` | Added `POST /api/v1/push/file` |
| `backend/services/api_sync.py` | Added format detection + CSV/NDJSON parsing; updated `preview_remote_source` and `fetch_products_from_api` |
| `frontend/app/dashboard/sync/_components/CsvUploadSection.tsx` | Added API upload curl examples |

## Tests run

```
# Format detection + parsing
format detection: csv/ndjson/json from content-type and URL extension ✓
csv parsing: csv.DictReader, 2 rows ✓
ndjson parsing: 2 rows, bad line skipped ✓
push/file route registered: /api/v1/push/file ✓

# Cross-format sequence
Step 1 — replace with CSV (3 titles):
  job 5c84f154 → done, file_format=csv, 3 added ✓
  postgres: csv_xfmt_001 Signal Ridge, csv_xfmt_002 Blue Horizon, csv_xfmt_003 Dark Circuit

Step 2 — append with NDJSON (2 new titles, no wipe):
  job 27512514 → done, file_format=ndjson, 2 added ✓
  postgres: 5 total — all 3 CSV titles plus 2 new NDJSON titles ✓

Step 3 — update with JSON (patch description on 2 titles):
  job 7d0e6337 → done, file_format=json, 2 updated ✓
  csv_xfmt_001 Signal Ridge: description updated ✓
  csv_xfmt_004 Storm Protocol: description updated ✓
  other 3 docs untouched, total still 5 ✓

TypeScript: tsc --noEmit 0 errors ✓
```

Note: `mode` must be passed as a URL query parameter (`?mode=replace`), not as a form field.
The `-F "mode=replace"` curl pattern silently falls back to the default `append`.
