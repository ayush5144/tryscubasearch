# ScubaSearch API Integration Guide

**Who this is for:** Developers building a custom search UI — mobile app (iOS, Android, React Native, Flutter), custom web app, or any frontend that makes HTTP requests directly instead of using the JS widget.

You do not need the widget. You do not need any SDK. Three endpoints, a Bearer token, and you have a full search experience with analytics.

---

## How it works — the 30-second overview

```
User types           → debounce 100ms → POST /api/v1/search  → show results
User taps a result   → fire-and-forget → POST /api/v1/search/click
User leaves / pauses → fire-and-forget → POST /api/v1/search/settle
```

- `/search` is the only required endpoint.
- `/click` and `/settle` feed your analytics dashboard. Skipping them means your dashboard shows no data.
- All requests use the same API key. Get it from **Settings → API Keys** in the dashboard.

---

## Authentication

Add this header to every request:

```
Authorization: Bearer sk_live_your_key_here
```

---

## The endpoints

### `POST /api/v1/search`

**What it does:** Takes the user's query, runs hybrid keyword + AI search across your catalog, returns ranked results.

**Request body:**

```json
{
  "query": "crime thriller with a twist ending",
  "limit": 10,
  "semantic_ratio": 0.5
}
```

| Field | Type | Default | Notes |
|---|---|---|---|
| `query` | string | required | The user's search text |
| `limit` | number | 10 | Max results to return |
| `semantic_ratio` | 0.0 – 1.0 | 0.5 | `0` = keyword only, `1` = AI meaning only, `0.5` = balanced |

`semantic_ratio` explained:
- **0.0** - exact keyword match. Fast. Best for title lookups ("The Dark Knight").
- **1.0** - meaning-based. Finds "a film about revenge" even if none of those words appear. Best for mood/vibe searches.
- **0.5** - the sweet spot for most apps. Start here.

**Response:**

```json
{
  "results": [
    {
      "id": "cms_1001",
      "title": "Signal Ridge",
      "description": "A rescue crew chases a fading transmission across frozen cliffs.",
      "category": "Thriller",
      "tags": ["rescue", "mountain"],
      "actors": "Asha Bell, Rohan Seth",
      "director": "Tia Noor",
      "content_type": "movie",
      "year": 2026,
      "language": "English",
      "image_url": "https://cdn.example/signal-ridge.jpg",
      "product_url": "https://platform.example/titles/signal-ridge"
    }
  ],
  "total": 1,
  "cache_hit": false,
  "processing_time_ms": 87,
  "log_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
}
```

**Important:** Save `log_id` from the response. You need it to wire up click tracking and analytics.

Queries shorter than 2 characters return `{ "results": [], "total": 0 }` immediately — this is intentional.

---

### `POST /api/v1/search/click`

**What it does:** Records that the user tapped on a specific result. Shows up in your analytics as a click event.

**Request body:**

```json
{
  "product_id": "cms_1001",
  "search_log_id": "a1b2c3d4-e5f6-..."
}
```

`product_id` is the `id` from the result. `search_log_id` is the `log_id` from the `/search` response that showed this result.

**Call it fire-and-forget** — do not await before navigating. Always returns `{ "ok": true }`.

---

### `POST /api/v1/search/settle`

**What it does:** Settles one search session into analytics. This is what populates your "top queries", "zero results", and intent data in the dashboard.

**What is a session?** Everything from when the user opens search to when they leave or navigate away. During that time they might search for `"romcoms"` and keep refining until they end on `"romcoms to watch with my gf"`. ScubaSearch logs only the **final settled intent query** for that session, not every prefix or typing pause.

**Request body:**

```json
{
  "log_id": "a1b2c3d4-...",
  "session_id": "unique-per-session-uuid",
  "queries": [
    { "value": "ac",              "timestamp": 1746600000000 },
    { "value": "act",             "timestamp": 1746600000200 },
    { "value": "action thriller", "timestamp": 1746600001500 }
  ],
  "query_meta": {
    "action thriller": { "result_count": 12, "cache_hit": false, "response_ms": 94 }
  },
  "signal": "click",
  "engagement": true
}
```

| Field | Notes |
|---|---|
| `log_id` | `log_id` from the last `/search` call |
| `session_id` | UUID you generate when the user opens search — reuse it for all settle calls in that session |
| `queries` | The executed search queries from this session. The backend persists only the final one. |
| `query_meta` | For each query that got a real API response, include `result_count`, `cache_hit`, `response_ms` |
| `signal` | Why the session ended: `"idle"`, `"click"`, `"enter"`, `"visibilitychange"` |
| `engagement` | `true` if the user explicitly browsed results (hover / scroll / click), not just idle time |

**How `signal` maps to analytics tags:**

| `signal` | `engagement` | Dashboard tag |
|---|---|---|
| `"click"` | `true` | **clicked** |
| `"enter"` | `false` | **searched** |
| `"idle"` | `true` | **browsed** |
| `"idle"` | `false` | **abandoned** |
| `"visibilitychange"` | `true` | **browsed** |
| `"visibilitychange"` | `false` | **abandoned** |

**When to call it:**
- Web: `document.addEventListener('visibilitychange', ...)` when the tab hides
- Web: `window.addEventListener('beforeunload', ...)`
- iOS: `applicationWillResignActive`
- Android: `onPause()`
- Immediately after a click (pass `signal: "click"`)

Always returns `{ "settled": N }`. Fire-and-forget — never block UX on this response.

---

## Complete working example (JavaScript)

This is a fully wired search implementation with all three endpoints, AbortController for cancelling stale requests, session tracking, and analytics. Copy, paste, replace the config, done.

```javascript
/* ─── CONFIG ──────────────────────────────────────────────── */
const API_BASE = 'https://api.scubasearch.io';
const API_KEY  = 'sk_live_your_key_here';

/* ─── SESSION SETUP ───────────────────────────────────────── */
// Generate a unique ID for this search session.
// Reuse it across all /settle calls until the user closes search.
const SESSION_ID = crypto.randomUUID();

// Buffers that accumulate while the user types
let querySnapshots = [];  // every { value, timestamp } the user typed
let queryMeta      = {};  // { query: { result_count, cache_hit, response_ms } }
let lastLogId      = null; // log_id from the most recent /search response
let settleTimer    = null; // fires /settle after 3s of inactivity

/* ─── ABORT CONTROLLER ────────────────────────────────────── */
// Cancels the previous in-flight /search if the user keeps typing.
// Prevents stale responses from overwriting fresh results.
let _abortCtrl = null;

/* ─── INPUT WIRING ────────────────────────────────────────── */
const input = document.getElementById('searchInput');

input.addEventListener('input', () => {
  const query = input.value.trim();

  // Record every keystroke for the settle buffer
  if (query) querySnapshots.push({ value: query, timestamp: Date.now() });

  // 100ms debounce — matches the widget's built-in timing
  clearTimeout(window._debounce);
  window._debounce = setTimeout(() => {
    if (query.length >= 2) search(query);
    else clearResults();
  }, 100);
});

// Press Enter → fire immediately + settle the session
input.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    clearTimeout(window._debounce);
    const query = input.value.trim();
    if (query.length >= 2) {
      search(query);
      settle('enter'); // tells analytics the user committed to this query
    }
  }
});

/* ─── SEARCH ──────────────────────────────────────────────── */
async function search(query) {
  // Cancel any previous request that's still in flight
  if (_abortCtrl) _abortCtrl.abort();
  _abortCtrl = new AbortController();

  showLoading(); // shimmer, spinner, whatever your UI uses

  try {
    const t0  = Date.now();
    const res = await fetch(`${API_BASE}/api/v1/search`, {
      method: 'POST',
      signal: _abortCtrl.signal, // linked to the abort controller above
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        query,
        limit:          20,
        semantic_ratio: 0.5, // 0 = keyword only, 1 = AI only, 0.5 = balanced
      }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const ms   = Date.now() - t0;

    // Save the log_id — needed for /click and /settle
    lastLogId = data.log_id;

    // Save per-query metadata for the settle payload
    queryMeta[query] = {
      result_count: data.results.length,
      cache_hit:    data.cache_hit,
      response_ms:  data.processing_time_ms ?? ms,
    };

    renderResults(data.results);

    // Schedule an idle settle 3 seconds after the user stops typing
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => settle('idle'), 3000);

  } catch (err) {
    if (err.name === 'AbortError') return; // silently cancelled by next query
    showError(err.message);
  }
}

/* ─── CLICK TRACKING ──────────────────────────────────────── */
function onResultClick(productId) {
  // Fire-and-forget — do NOT await before navigating
  fetch(`${API_BASE}/api/v1/search/click`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      product_id:    productId,
      search_log_id: lastLogId, // links click back to the search that surfaced it
    }),
  }).catch(() => {}); // never block UX on analytics

  // Settle the session immediately with signal="click"
  settle('click');
}

/* ─── SETTLE (ANALYTICS) ──────────────────────────────────── */
// Settles the session into analytics.
// ScubaSearch records only the final settled intent query for the session.
async function settle(signal) {
  if (!querySnapshots.length) return;

  // After settling, clear the buffers so a fresh session starts next time
  const payload = {
    log_id:     lastLogId,
    session_id: SESSION_ID,
    queries:    querySnapshots,
    query_meta: queryMeta,
    signal,
    engagement: signal === 'click' || sessionHadEngagement, // → "browsed" vs "abandoned"
  };

  try {
    await fetch(`${API_BASE}/api/v1/search/settle`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (e) { /* non-fatal — analytics are best-effort */ }
}

// Settle when the user switches tabs or closes the page
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') settle('visibilitychange');
});

/* ─── UI HELPERS (implement these for your design) ────────── */
function showLoading()          { /* show shimmer or spinner */ }
function clearResults()         { /* empty the results container */ }
function renderResults(results) { /* render result cards from the array */ }
function showError(msg)         { /* display error state */ }
```

That's the entire integration. The UI helpers at the bottom are the only things you need to implement yourself.

---

## Language examples

### Python

```python
import httpx

API_BASE = "https://api.scubasearch.io"
API_KEY  = "sk_live_your_key"

def search(query: str, limit: int = 20, semantic_ratio: float = 0.5):
    resp = httpx.post(
        f"{API_BASE}/api/v1/search",
        headers={"Authorization": f"Bearer {API_KEY}"},
        json={"query": query, "limit": limit, "semantic_ratio": semantic_ratio},
        timeout=10,
    )
    resp.raise_for_status()
    return resp.json()  # { results, total, cache_hit, processing_time_ms, log_id }
```

### Swift (iOS)

```swift
struct SearchResult: Decodable {
    let id: String?
    let title: String
    let description: String?
    let imageUrl: String?
    let productUrl: String?
    let contentType: String?
    let year: Int?
    // add other fields as needed
    enum CodingKeys: String, CodingKey {
        case id, title, description, year
        case imageUrl    = "image_url"
        case productUrl  = "product_url"
        case contentType = "content_type"
    }
}

struct SearchResponse: Decodable {
    let results: [SearchResult]
    let total: Int
    let cacheHit: Bool
    let processingTimeMs: Int
    let logId: String?
    enum CodingKeys: String, CodingKey {
        case results, total
        case cacheHit        = "cache_hit"
        case processingTimeMs = "processing_time_ms"
        case logId           = "log_id"
    }
}

func search(query: String) async throws -> SearchResponse {
    var req = URLRequest(url: URL(string: "https://api.scubasearch.io/api/v1/search")!)
    req.httpMethod = "POST"
    req.setValue("Bearer sk_live_your_key", forHTTPHeaderField: "Authorization")
    req.setValue("application/json",         forHTTPHeaderField: "Content-Type")
    req.httpBody = try JSONSerialization.data(withJSONObject: [
        "query": query, "limit": 20, "semantic_ratio": 0.5
    ])
    let (data, _) = try await URLSession.shared.data(for: req)
    return try JSONDecoder().decode(SearchResponse.self, from: data)
}
```

### Kotlin (Android)

```kotlin
data class SearchResult(
    val id: String?,
    val title: String,
    val description: String?,
    @Json(name = "image_url")   val imageUrl: String?,
    @Json(name = "product_url") val productUrl: String?,
    @Json(name = "content_type") val contentType: String?,
    val year: Int?,
)

data class SearchResponse(
    val results: List<SearchResult>,
    val total: Int,
    @Json(name = "cache_hit")          val cacheHit: Boolean,
    @Json(name = "processing_time_ms") val processingTimeMs: Int,
    @Json(name = "log_id")             val logId: String?,
)

// Using Retrofit + Moshi (or swap for OkHttp + Gson as preferred)
interface ScubaSearchApi {
    @POST("api/v1/search")
    @Headers("Content-Type: application/json")
    suspend fun search(
        @Header("Authorization") auth: String = "Bearer sk_live_your_key",
        @Body body: Map<String, Any>,
    ): SearchResponse
}

// Usage
val results = api.search(body = mapOf(
    "query"          to "action thriller",
    "limit"          to 20,
    "semantic_ratio" to 0.5,
))
```

### curl (testing)

```bash
# Basic search
curl -X POST "https://api.scubasearch.io/api/v1/search" \
  -H "Authorization: Bearer sk_live_your_key" \
  -H "Content-Type: application/json" \
  -d '{"query": "thriller", "limit": 5}'

# Local dev
curl -X POST "http://localhost:8000/api/v1/search" \
  -H "Authorization: Bearer sk_live_your_key" \
  -H "Content-Type: application/json" \
  -d '{"query": "thriller", "limit": 5}'
```

---

## Result fields

Every result has the fields you included when you uploaded your catalog. Only `title` is guaranteed.

| Field | Type | Description |
|---|---|---|
| `id` | string | Your catalog's ID for this title |
| `title` | string | Title name (always present) |
| `description` | string | Synopsis |
| `category` | string | Genre (e.g. "Thriller") |
| `tags` | string or array | Tags — can come back as an array or comma-separated string depending on upload method |
| `actors` | string | Cast, comma-separated |
| `director` | string | Director name |
| `writer` | string | Writer name |
| `content_type` | string | `"movie"`, `"series"`, `"episode"`, etc. |
| `year` | number | Release year |
| `language` | string | Primary language |
| `image_url` | string | Poster/thumbnail URL |
| `product_url` | string | Deep link on your platform |
| `duration_mins` | number | Runtime in minutes |

---

## Error handling

| Status | Meaning | What to do |
|---|---|---|
| 200 empty results | No matches, or catalog not uploaded yet | Show "no results" state |
| 401 / 403 | Wrong or revoked API key | Check Settings → API Keys |
| 402 | Monthly session limit reached | Show upgrade prompt |
| 429 | Rate limit (1000 req/min) | Back off and retry after `Retry-After` |
| 500 | Server error | Retry once; if persists, check status page |

---

## Common mistakes

**Not saving `log_id`** — if you skip this, click tracking and settle have no search to link back to. Your analytics will be empty.

**Awaiting `/click` before navigating** — the click endpoint just writes a log row. Fire it and navigate immediately.

**Calling `/search` on every keystroke without debounce** — burns through your rate limit and creates noisy analytics. Always debounce at 100ms.

**Treating `tags` as always a string** — tags can come back as an array or comma-separated string depending on how the catalog was uploaded. Normalise defensively:

```javascript
function normaliseTags(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  return raw.split(',').map(t => t.trim()).filter(Boolean);
}
```

**Hardcoding the API key in a mobile binary** — it can be extracted from the APK/IPA. Proxy the search request through your own backend instead.

---

## Current limitations

1. **No filter params** — you can't filter by `category`, `year`, or `content_type` at query time. Filter returned results client-side for now.
2. **No field projection** — every result returns all fields. You can't request only `title` + `image_url`.
3. **No sorting** — results are always ranked by relevance. No sort by year or alphabetical.
4. **No autocomplete endpoint** — there is no typeahead/suggest API. Use the full `/search` endpoint with short queries.

These are all on the roadmap.

---

## Integration checklist

- [ ] API key in config (not hardcoded in mobile binary)
- [ ] `SESSION_ID` generated when user opens search
- [ ] Search input debounced at 100ms
- [ ] `AbortController` cancels previous in-flight request on each new search
- [ ] `log_id` saved from each `/search` response
- [ ] `/click` fired on result tap (fire-and-forget, no await)
- [ ] `querySnapshots` buffer populated on every input event
- [ ] `queryMeta` populated after each `/search` response
- [ ] `/settle` called on tab hide / app background / after click
- [ ] Empty results state handled
- [ ] 402 session-limit error handled with upgrade prompt
- [ ] 429 rate-limit handled with backoff

---

## Live example

`widget/testapi.html` — a Netflix-style demo page with the full integration wired: poster grid, hover overlays, detail modal, AI weight slider, and all three endpoints connected with session tracking. Open it via `python3 serve.py` in the `widget/` directory.
