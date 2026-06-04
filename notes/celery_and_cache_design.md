# Celery Auto-Reload & Redis Cache Key Design

## Celery Does Not Auto-Reload

FastAPI (uvicorn `--reload`) watches `.py` files and restarts on every save.
Celery does not. It reads code once at startup and holds it in memory.

**What breaks:** you fix a bug in `workers/tasks.py`, FastAPI picks it up
immediately, but Celery is still running the old version. Uploads appear to
work but use the broken code. This caused `_parse_price` to return `0.0` for
all `"Rs. 18,699.00"` prices even after the fix was on disk.

**Local dev fix:** `start.sh` wraps Celery with `watchmedo auto-restart`:
```
watchmedo auto-restart --directory=backend/ --pattern="*.py" --recursive \
  -- celery -A workers.celery_app worker --pool=solo --loglevel=info
```
Any `.py` save in `backend/` kills and restarts the worker automatically.
Requires `watchdog` pip package (in `requirements.txt`).

**Production (DO App Platform):** not an issue. Every `git push` redeploys
the Celery worker component fresh from the new image. No watchmedo needed.

---

## Redis Cache Key Format

Cache keys for search results follow this format:

```
search:{client_id}:{SHA256(query + ":" + limit)}
```

**Example** — Client A (`uuid-aaa`) searches "nike" with limit=10:
```
search:uuid-aaa:7d3a9f2b1c...  (64-char hash of "nike:10")
```

**Why client_id is a plaintext prefix (not inside the hash):**

The ingest pipeline flushes all cached results after a successful upload:
```python
pattern = f"search:{client_id}:*"
cursor, keys = r.scan(cursor, match=pattern)
```
Redis SCAN can only match on plaintext patterns. If client_id were inside
the SHA256 hash, the pattern would never match and cache entries would
persist forever — serving stale prices/stock from before the upload.

**Why the query+limit is hashed:**
- Queries can be arbitrarily long — hashing keeps key length predictable
- Avoids any special characters in the query breaking Redis key parsing
- SHA256 always produces exactly 64 characters

**Why limit is part of the hash (not the prefix):**
Two requests for the same query but different `data-max-results` values
must get different cache entries — otherwise limit=8 results get served
to a widget configured for limit=20. Including limit in the hash ensures
independent entries per (query, limit) combination per client.

**Never change the key format** without also updating `_flush_cache` in
`workers/tasks.py`. The SCAN pattern `search:{client_id}:*` is tightly
coupled to the prefix structure.

---

## Price Parsing — Rs. Format Fallback

The `_parse_price` function uses `re.sub(r"[^\d.]", "", raw)` to strip
currency symbols. This keeps ALL dots, including the dot in `"Rs."`:

```
"Rs. 18,699.00"
  → strip non-digit non-dot → ".18699.00"   ← two dots!
  → float(".18699.00")      → ValueError
  → returns 0.0
```

**Fix:** after stripping, collapse multiple dots to one by splitting on `.`
and rejoining — keeping only the last segment as the decimal:

```python
parts = cleaned.split(".")           # ["", "18699", "00"]
cleaned = "".join(parts[:-1]) + "." + parts[-1]  # "18699.00"
float("18699.00")  # → 18699.0 ✓
```

**Other formats handled correctly:**
| Input | After strip | After collapse | Result |
|---|---|---|---|
| `"Rs. 18,699.00"` | `".18699.00"` | `"18699.00"` | `18699.0` ✓ |
| `"₹1,299"` | `"1299"` | `"1299"` | `1299.0` ✓ |
| `"$49.99"` | `"49.99"` | `"49.99"` | `49.99` ✓ |
| `""` / missing | `""` | `""` | `0.0` (safe fallback) |

**EU format (`€1.299,00`) is NOT handled** — EU uses `.` as thousands
separator and `,` as decimal. After stripping: `"1.29900"` → `1.29` (wrong).
Not in current data. Needs locale detection to fix properly.

**Return type is `float`** (changed from `int`) so decimal prices like
`$49.99` are preserved. Meilisearch stores and filters on floats correctly.
Price filtering (`price < 5000`) works identically with floats.
