# Mobile API Integration

This note explains how ScubaSearch should be integrated into:
- iOS apps
- Android apps
- React Native apps
- Flutter apps
- custom web apps
- any frontend that wants native or custom UI instead of the built-in widget UI

Do not use this note for the standard embeddable website widget. For that, see:
- `notes/widget_installation.md`
- `notes/widget_headless_mode.md`

---

## The Core Idea

ScubaSearch does not need a separate search backend for mobile apps.

A mobile app or custom web app uses the same backend endpoints that the current JavaScript widget already uses:
- `POST /api/v1/search`
- `POST /api/v1/search/click`
- `POST /api/v1/search/settle`

So the product layers are:

- **Widget**
  - UI included
  - best for normal websites

- **Headless web integration**
  - no ScubaSearch UI
  - still uses `widget.js` for browser-side helper logic
  - best for custom browser UIs

- **Direct API integration**
  - no ScubaSearch UI
  - no `widget.js`
  - frontend calls backend endpoints directly
  - best for mobile apps and any non-browser client

The important point:

- **API** is the base layer
- **headless web integration** is a convenience layer built on top of the same API

So yes:
- the API can be used by mobile apps
- the API can be used by web apps too
- headless and API are related, but they are not the same thing

---

## API vs Headless

```
Client wants ScubaSearch in a custom surface
          │
          ▼
┌─────────────────────────────────────────────────────────────┐
│  What kind of client is it?                                 │
│                                                             │
│  A. Standard website wants ready-made search UI             │
│     → use JS widget                                         │
│                                                             │
│  B. Custom web app wants its own UI but still wants         │
│     browser helper wiring                                   │
│     → use headless web integration                          │
│                                                             │
│  C. Native app or non-browser client wants full control     │
│     → use direct API integration                            │
└─────────────────────────────────────────────────────────────┘
```

### What "headless" means in ScubaSearch right now

```
┌─────────────────────────────────────────────────────────────┐
│  widget.js in data-headless="true" mode                     │
│                                                             │
│  Does NOT render ScubaSearch dropdown UI                    │
│  But DOES still provide browser-side helpers                │
│                                                             │
│  window.ScubaSearch.engage()                                │
│  window.ScubaSearch.click(productId)                        │
│                                                             │
│  Under the hood it still calls:                             │
│  /api/v1/search                                              │
│  /api/v1/search/click                                        │
│  /api/v1/search/settle                                       │
└─────────────────────────────────────────────────────────────┘
```

### What "API integration" means

```
┌─────────────────────────────────────────────────────────────┐
│  The client app calls backend endpoints directly            │
│                                                             │
│  No widget.js                                               │
│  No browser globals                                         │
│  No ScubaSearch UI                                          │
│                                                             │
│  Client app is responsible for:                             │
│  - search bar                                               │
│  - loading state                                            │
│  - result card UI                                           │
│  - click handling                                           │
│  - session tracking                                         │
│                                                             │
│  ScubaSearch is responsible for:                            │
│  - auth                                                     │
│  - cache                                                    │
│  - embeddings                                               │
│  - ranking                                                  │
│  - result payloads                                          │
│  - click analytics                                          │
│  - settled search analytics                                 │
└─────────────────────────────────────────────────────────────┘
```

---

## The 3 Endpoints a Mobile or Custom App Uses

```
┌─────────────────────────────────────────────────────────────┐
│  Endpoint 1: POST /api/v1/search                            │
│  Purpose: get ranked results                                │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  Endpoint 2: POST /api/v1/search/click                      │
│  Purpose: record which result the viewer chose              │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  Endpoint 3: POST /api/v1/search/settle                     │
│  Purpose: turn a typing session into analytics              │
│  like clicked / searched / browsed / abandoned              │
└─────────────────────────────────────────────────────────────┘
```

---

## Full Runtime Flow — Detailed

This is the real app-side flow from first keystroke to settled analytics.

```
Viewer types in the app or custom web search bar
          │
          ▼
┌─────────────────────────────────────────────────────────────┐
│  Client app UI                                              │
│                                                             │
│  1. Viewer types                                            │
│  2. App debounces input (recommended: 100-300ms)            │
│  3. App checks query length                                 │
│  4. If query length < 2, do not call ScubaSearch yet        │
│  5. If query length >= 2, prepare search request            │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  Client app sends HTTP request                              │
│                                                             │
│  POST /api/v1/search                                        │
│  Authorization: Bearer sk_live_...                          │
│  Content-Type: application/json                             │
│                                                             │
│  body:                                                      │
│  {                                                          │
│    "query": "dark thriller",                                │
│    "limit": 8,                                              │
│    "semantic_ratio": 0.5                                    │
│  }                                                          │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  FastAPI /search                                            │
│                                                             │
│  1. Reject query if length < 2                              │
│  2. Read API key from Authorization header                  │
│  3. Auth middleware resolves client_id                      │
│  4. Start response timer                                    │
│  5. Generate a log_id for this search attempt               │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  Redis cache check                                          │
│                                                             │
│  cache key includes:                                        │
│  - client_id                                                │
│  - query                                                    │
│  - limit                                                    │
│  - semantic_ratio                                           │
│                                                             │
│  If cache hit:                                              │
│  - return cached ranked results                             │
│  - skip embed call                                          │
│  - skip Meilisearch call                                    │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
                    cache miss path only
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  Billing/session enforcement                                │
│                                                             │
│  1. Reset monthly counters if needed                        │
│  2. Check session limit for this client                     │
│  3. If limit exceeded, return 402                           │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  Embedding step                                              │
│                                                             │
│  If semantic_ratio > 0:                                     │
│  - backend sends query text to OpenAI embeddings            │
│  - receives vector back                                     │
│                                                             │
│  If semantic_ratio == 0:                                    │
│  - no embed call                                             │
│  - lexical path only                                         │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  Meilisearch hybrid search                                  │
│                                                             │
│  backend calls Meilisearch with:                            │
│  - client-specific index                                    │
│  - query text                                               │
│  - vector (if any)                                          │
│  - limit                                                    │
│  - semantic_ratio                                           │
│                                                             │
│  Meilisearch returns ranked documents                       │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  FastAPI response back to client                            │
│                                                             │
│  response includes:                                         │
│  - results                                                  │
│  - total                                                    │
│  - cache_hit                                                │
│  - processing_time_ms                                       │
│  - log_id                                                   │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  Client app receives the response                           │
│                                                             │
│  1. store latest log_id in memory                           │
│  2. render result cards/list/grid                           │
│  3. keep product ids available for click tracking           │
│  4. optionally show loading time or handle empty state      │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
                 viewer either taps or leaves
```

---

## Flow A — User Searches and Results Return

This is the simplest search-only path.

```
User types "dark thriller"
          │
          ▼
┌─────────────────────────────────────────────────────────────┐
│  Client app creates request                                 │
│                                                             │
│  query = "dark thriller"                                    │
│  limit = 8                                                  │
│  semantic_ratio = 0.5                                       │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  POST /api/v1/search                                        │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  Backend checks:                                            │
│  - auth                                                     │
│  - cache                                                    │
│  - billing/session limit                                    │
│  - embeddings                                               │
│  - Meilisearch ranking                                      │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  Response                                                    │
│                                                             │
│  {                                                          │
│    results: [...],                                          │
│    total: 8,                                                │
│    cache_hit: false,                                        │
│    processing_time_ms: 182,                                 │
│    log_id: "uuid..."                                        │
│  }                                                          │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  Client app renders results                                 │
│                                                             │
│  - poster                                                   │
│  - title                                                    │
│  - metadata if desired                                      │
│  - tap target per result                                    │
│                                                             │
│  Client should keep log_id in memory for later analytics    │
└─────────────────────────────────────────────────────────────┘
```

---

## Flow B — User Taps a Result

This is the click path.

```
Viewer sees results and taps one
          │
          ▼
┌─────────────────────────────────────────────────────────────┐
│  Client app already has:                                    │
│  - product_id from the selected result                      │
│  - latest log_id from /search                               │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  Client app sends:                                          │
│                                                             │
│  POST /api/v1/search/click                                  │
│                                                             │
│  {                                                          │
│    "product_id": "csv_101",                                 │
│    "search_log_id": "uuid-from-search"                      │
│  }                                                          │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  FastAPI /search/click                                      │
│                                                             │
│  1. validates payload                                       │
│  2. if search_log_id exists, schedules click log update     │
│  3. marks the originating search row as clicked + settled   │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  Client app continues navigation                            │
│                                                             │
│  Examples:                                                  │
│  - open movie/show details                                  │
│  - open player screen                                       │
│  - open external content URL                                │
└─────────────────────────────────────────────────────────────┘
```

### Practical rule

Call `/search/click` immediately before navigation if possible.

If navigation is very fast, fire it asynchronously and do not block UX.

---

## Flow C — User Stops, Searches, or Leaves

This is the settle path.

`settle` is the part that turns raw typing into useful analytics.

```
Viewer typed a series of queries during one search session
          │
          ▼
┌─────────────────────────────────────────────────────────────┐
│  Client app tracks a local session                          │
│                                                             │
│  Example snapshots:                                         │
│  - "da"                                                     │
│  - "dark"                                                   │
│  - "dark thriller"                                          │
│                                                             │
│  App also tracks:                                           │
│  - result_count for final query                             │
│  - cache_hit if needed                                      │
│  - response_ms if needed                                    │
│  - whether viewer engaged with results                      │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  Session ends via one of these signals                      │
│                                                             │
│  - idle                                                     │
│  - enter                                                    │
│  - click                                                    │
│  - visibilitychange / screen lost focus                     │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  Client app sends:                                          │
│                                                             │
│  POST /api/v1/search/settle                                 │
│                                                             │
│  {                                                          │
│    "log_id": "uuid-from-search",                            │
│    "session_id": "sess_abc123",                             │
│    "queries": [ ...snapshots... ],                          │
│    "query_meta": { ... },                                   │
│    "signal": "enter",                                       │
│    "engagement": true                                       │
│  }                                                          │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  FastAPI /search/settle                                     │
│                                                             │
│  1. validates log_id if present                             │
│  2. extracts meaningful intent queries                      │
│  3. removes typing noise and duplicates                     │
│  4. upserts settled analytics rows                          │
│  5. upgrades the final row if needed                        │
│  6. writes clicked/searched/browsed/abandoned intent data   │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  Analytics becomes useful in dashboard                      │
│                                                             │
│  Platform owner can now see:                                │
│  - top queries                                               │
│  - zero-result queries                                       │
│  - clicked vs searched vs browsed vs abandoned              │
│  - recent activity                                           │
└─────────────────────────────────────────────────────────────┘
```

---

## Actual Request Shapes

### 1. Search request

```http
POST /api/v1/search
Authorization: Bearer sk_live_...
Content-Type: application/json
```

```json
{
  "query": "dark thriller",
  "limit": 8,
  "semantic_ratio": 0.5
}
```

### 2. Search response

```json
{
  "results": [
    {
      "id": "csv_101",
      "title": "Night Signal",
      "description": "A radio host uncovers a conspiracy after a midnight call.",
      "category": "Thriller",
      "image_url": "https://cdn.example.com/night-signal.jpg",
      "product_url": "https://example.com/watch/night-signal"
    }
  ],
  "total": 1,
  "cache_hit": false,
  "processing_time_ms": 182,
  "log_id": "0f2c1c9e-1111-2222-3333-444444444444"
}
```

### 3. Click request

```http
POST /api/v1/search/click
Authorization: Bearer sk_live_...
Content-Type: application/json
```

```json
{
  "product_id": "csv_101",
  "search_log_id": "0f2c1c9e-1111-2222-3333-444444444444"
}
```

### 4. Settle request

```http
POST /api/v1/search/settle
Authorization: Bearer sk_live_...
Content-Type: application/json
```

```json
{
  "log_id": "0f2c1c9e-1111-2222-3333-444444444444",
  "session_id": "sess_abc123",
  "queries": [
    { "value": "da", "timestamp": 1710000000000 },
    { "value": "dark", "timestamp": 1710000000400 },
    { "value": "dark thriller", "timestamp": 1710000001200 }
  ],
  "query_meta": {
    "dark thriller": {
      "result_count": 8,
      "cache_hit": false,
      "response_ms": 182
    }
  },
  "signal": "enter",
  "engagement": true
}
```

---

## What the Client App Must Store in Memory

```
┌─────────────────────────────────────────────────────────────┐
│  The app should keep these values during a search session   │
│                                                             │
│  1. latest log_id                                           │
│     - returned by /search                                   │
│     - reused by /click and /settle                          │
│                                                             │
│  2. session_id                                              │
│     - one logical typing/search session                     │
│                                                             │
│  3. query snapshots                                         │
│     - typed values over time                                │
│                                                             │
│  4. query_meta                                              │
│     - result_count                                          │
│     - cache_hit                                             │
│     - response_ms                                           │
│                                                             │
│  5. engagement flag                                         │
│     - did the viewer meaningfully interact with results?    │
└─────────────────────────────────────────────────────────────┘
```

---

## Recommended Client Behavior

```
┌─────────────────────────────────────────────────────────────┐
│  Search behavior                                            │
│  - debounce requests by 100-300ms                           │
│  - do not call /search below 2 chars                        │
│  - cancel stale in-flight requests when possible            │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  Click behavior                                             │
│  - call /search/click before navigation if possible         │
│  - do not block app UX waiting for click analytics          │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  Settle behavior                                            │
│  - call /search/settle when user pauses                     │
│  - call /search/settle on explicit submit                   │
│  - call /search/settle when user taps a result              │
│  - call /search/settle when search screen loses focus       │
└─────────────────────────────────────────────────────────────┘
```

---

## Minimal Service Layer the App Needs

The app does not need a full SDK yet.

It only needs a small service wrapper with 3 operations:

```
┌─────────────────────────────────────────────────────────────┐
│  1. search(query)                                           │
│  - calls /search                                            │
│  - stores latest log_id                                     │
│  - returns results to UI                                    │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  2. trackClick(productId)                                   │
│  - calls /search/click                                      │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  3. settleSession(signal, engagement, queries, queryMeta)   │
│  - calls /search/settle                                     │
└─────────────────────────────────────────────────────────────┘
```

This is why ScubaSearch can support mobile apps today without first shipping a dedicated iOS or Android SDK.

---

## What This Means for the Product

Right now the clean product story is:

```
┌─────────────────────────────────────────────────────────────┐
│  Websites                                                   │
│  → use the JavaScript widget                                │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  Custom web apps                                            │
│  → use headless web integration or direct API              │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  Native mobile apps                                         │
│  → use direct API integration                               │
└─────────────────────────────────────────────────────────────┘
```

If demand grows later, thin platform SDKs can be added on top of the same backend contract.

---

## Current Gaps

The backend already supports this integration pattern.

What is still missing is presentation, not architecture:

```
┌─────────────────────────────────────────────────────────────┐
│  Missing today                                              │
│                                                             │
│  - public-facing mobile/API integration guide               │
│  - Swift sample snippet                                     │
│  - Kotlin sample snippet                                    │
│  - maybe a dashboard-facing "mobile integration" page later │
└─────────────────────────────────────────────────────────────┘
```
