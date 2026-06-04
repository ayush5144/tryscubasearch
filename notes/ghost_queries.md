# Ghost Queries — Catching the Searches That Vanish

Queries that users actually searched for, paused on, looked at results for — but never appear in analytics because they refined away before the idle timer fired. This doc is the full design for catching them.

---

## The Problem

Current flow:
```
user types: "red shoes running" → search fires → log row (settled=false)
user deletes → types: "red sun"  → search fires → log row (settled=false)
3s idle fires                    → ONLY "red sun" gets settled=true
```

`"red shoes running"` is gone. Store owner never sees it. They're making inventory decisions on incomplete data.

---

## The Full Solution

Three components working together:

1. **Session buffer** — widget.js captures every meaningful query during a session
2. **Smart snapshot triggers** — space + gap + dedup decide what goes into the buffer
3. **Backend extraction** — extracts real intent states from the buffer on session end

---

## Component 1 — Snapshot Triggers

Two triggers decide when a query gets added to the session buffer:

### Trigger 1: Space pressed (immediate)
When the user presses space, the previous word just completed. No waiting.
```
user types "red shoes " → space pressed → snapshot "red shoes" instantly
```

### Trigger 2: Gap timer — 400ms
When the user stops typing for 400ms without pressing space. Catches:
- Final word of any query (no trailing space ever)
- Single-word searches ("sneakers")
- Mid-word pauses where user is looking at results

```
user types "red sun" → stops → 400ms passes → snapshot "red sun"
```

### Why 400ms and not 800ms?
Space already handles clean word completions. The 400ms gap is just the fallback for words without a trailing space. It doesn't need to be as conservative as the 800ms extraction threshold — by the time the backend sees the buffer, extraction does the heavy filtering.

### Trigger 3: Session end (always)
On idle / hover / visibilitychange / beforeunload — always snapshot the final query state before sending the buffer.

---

## Component 2 — Dedup

Before adding to buffer, check if this exact query already exists in the session buffer. If yes, skip.

```
"red shoe"  → added to buffer (first time, building toward "red shoes")
"red shoes" → added to buffer
"red shoes running" → added to buffer
"red shoe"  → ALREADY IN BUFFER → skip ✅  (deletion revisit)
"red"       → ALREADY IN BUFFER → skip ✅  (deletion revisit)
"red sun"   → added to buffer (new, never seen)
```

Dedup handles deletion revisits. Gap filter handles mid-typing noise. Both needed.

---

## Full Example

User session: types "red shoes running", refines to "red sun"

**Raw keystroke stream:**
```
"r"                  t=1000  → skip (incomplete, 100ms to next)
"re"                 t=1100  → skip
"red"                t=1200  → 400ms gap? no (400ms to next) → skip
"red s"              t=1300  → skip (incomplete word mid-type)
"red sh"             t=1350  → skip
"red sho"            t=1400  → skip
"red shoe"           t=1500  → space not pressed, 100ms to next → skip
"red shoes"          t=1600  → space pressed → SNAPSHOT ✅
"red shoes r"        t=2800  → skip
"red shoes ru"       t=2900  → skip
"red shoes run"      t=3000  → skip
"red shoes runni"    t=3100  → skip
"red shoes runnin"   t=3200  → skip
"red shoes running"  t=3300  → no space pressed, but 1700ms gap → SNAPSHOT ✅
"red shoe"           t=5000  → dedup hit → skip ✅
"red"                t=5200  → dedup hit → skip ✅
"red s"              t=6000  → skip
"red su"             t=6100  → skip
"red sun"            t=6200  → session end → SNAPSHOT ✅
```

**Session buffer sent to backend:**
```json
[
  { "value": "red shoes",         "timestamp": 1600 },
  { "value": "red shoes running", "timestamp": 3300 },
  { "value": "red sun",           "timestamp": 6200 }
]
```

**Backend extract_intents(buffer, threshold=800ms):**
```
"red shoes"          → gap to next = 1700ms → PAUSE ✅ → settled, browsed
"red shoes running"  → gap to next = 2900ms → PAUSE ✅ → settled, browsed
"red sun"            → session end           → ✅ → settled, browsed
```

Three rows inserted into search_logs as settled=true. All three surface in top queries. Nothing lost.

---

## Component 3 — Session Signals (Browsed vs Abandoned)

### Signals that close the session and send the buffer

| Signal | Type | Notes |
|---|---|---|
| 3s idle timer | browsed | raised from 2s — hover/scroll now catch fast browsers |
| Hover on result item | browsed | strongest signal — user is reading results |
| Scroll in results | browsed | user scanning the list |
| visibilitychange (hidden) | browsed or abandoned | depends on engagement flag |
| beforeunload | browsed or abandoned | page close |
| Enter key | searched | sends buffer + marks final query as searched |
| Click on result | clicked | sends buffer + marks that query as clicked |

### Abandoned vs Browsed detection

```
session ends (visibilitychange / blur / beforeunload)
  ↓
did hover or scroll fire at any point during this session?
  yes → browsed  (user engaged with results)
  no  → abandoned (user saw results and left immediately)
```

Track with a simple boolean flag `sessionHadEngagement = false`, set to `true` on first hover/scroll.

---

## Intent Types — Final Set

| Type | Signal | Store owner meaning |
|---|---|---|
| `clicked` | result clicked | found what they wanted |
| `searched` | Enter pressed | deliberate submission |
| `browsed` | idle/hover/scroll confirmed engagement | looked at results, didn't click |
| `abandoned` | left with zero engagement | probably wrong results or zero results |

### Signal sub-types (stored in DB, shown in dashboard as sub-type badges)

| Signal | Dashboard badge |
|---|---|
| `idle` | Idle (slate) |
| `hover` | Hover (purple) |
| `scroll` | Scroll (indigo) |
| `visibilitychange` | Tab Switch (sky blue) |
| `enter` | Searched (blue) |
| `click` | Clicked (green) |

The `signal` field is stored on every settled `search_logs` row (migration `f8a9b0c1d2e3`). The analytics dashboard uses it to show specific sub-type badges **only when `intent=browsed`**. `abandoned` always shows plain gray "Abandoned" regardless of signal — signal sub-types do not apply to abandoned rows. `browsed` with no signal (old rows) also shows plain gray "Browsed".

---

## Idle Timer

| Before (no hover/scroll) | After (hover/scroll added) |
|---|---|
| 2s | 3s |

Raised because hover/scroll now catch genuine browsers. The 3s idle is the fallback for users who stare at results without any cursor or scroll movement.

---

## Backend — What Changes

### Settle endpoint
Accepts `queries` array instead of single `query` string, plus `session_id`:

```python
class SettleRequest(BaseModel):
    log_id: str | None = None      # UUID of final/click row
    session_id: str | None = None  # page-load-scoped ID — links all rows from one page load
    queries: list[QuerySnapshot]   # was: query: str
    signal: str                    # "idle" | "hover" | "scroll" | "enter" | "click" | "visibilitychange"
    engagement: bool               # was hover/scroll seen this session?

class QuerySnapshot(BaseModel):
    value: str
    timestamp: int
```

### extract_intents()
```python
PAUSE_THRESHOLD = 800  # ms

def extract_intents(snapshots: list[dict]) -> list[str]:
    intents = []
    for i, entry in enumerate(snapshots):
        next_ = snapshots[i + 1] if i + 1 < len(snapshots) else None
        gap = (next_['timestamp'] - entry['timestamp']) if next_ else float('inf')
        if gap >= PAUSE_THRESHOLD:
            intents.append(entry['value'])
    return intents
```

Direction detection (building/deleting) is already handled client-side by the dedup — by the time the buffer reaches the backend, deletion revisits are already stripped. So backend extraction only needs pause detection.

### Multiple inserts
For each extracted intent, insert one settled row into search_logs. The final query's intent type (clicked/searched/abandoned/browsed) applies to the last entry. All preceding extracted intents are tagged `browsed`.

**Ghost insert `result_count`:** Ghost rows (queries refined away before the idle timer — no matching unsettled row found) are inserted with `result_count = -1` (sentinel). This distinguishes them from real zero-result searches (`result_count = 0`). The analytics API maps `-1 → null` before returning to the frontend. The dashboard shows `—` for ghost queries instead of `0`, so store owners don't mistake "unknown result count" for "search returned nothing".

**Ghost row exclusion from analytics:** ALL user-facing analytics queries now filter `response_ms IS NOT NULL` in addition to `settled = true`. This excludes ghost rows from total_searches, intent breakdown (clicked/searched/browsed/abandoned counts), CTR calculations, query-log, and top-queries. Zero-result analysis uses `result_count = 0 AND response_ms IS NOT NULL` which also excludes them. Without this filter, ghost rows inflated search volume and skewed intent/CTR metrics.

### Analytics — add abandoned
```python
intent = (
    "clicked"   if row.clicked   else
    "searched"  if row.searched  else
    "abandoned" if not row.engagement else
    "browsed"
)
```

---

## What Is Frontend vs Backend

| Change | Where |
|---|---|
| Session buffer | widget.js |
| Space trigger | widget.js |
| `SEARCH_DEBOUNCE_MS=200` (live results) | widget.js |
| `SNAPSHOT_DEBOUNCE_MS=400` (independent snapshot timer) | widget.js |
| Dedup logic | widget.js |
| visibilitychange listener | widget.js |
| Hover on results listener (+ `sessionStarted` guard) | widget.js |
| Scroll in results listener (+ `sessionStarted` guard) | widget.js |
| Abandoned engagement flag | widget.js |
| Raise idle timer 2s → 3s | widget.js |
| `session_id` page-load-scoped JS variable (not sessionStorage) | widget.js |
| Send buffer array on settle | widget.js |
| Settle endpoint accepts array + session_id | backend |
| Backend dedup on (session_id, query) — skip if already settled | backend/routers/search.py |
| extract_intents() function | backend/services/intent.py |
| Multiple settled row inserts | backend |
| Ghost inserts use `result_count=-1` (sentinel, not 0) | backend/routers/search.py |
| `abandoned` intent type | backend analytics.py |
| `result_count: int \| None` in query-log (−1 maps to null) | backend analytics.py |
| `engagement` column on search_logs | backend (migration d6e7f8a9b0c1) |
| `session_id` column on search_logs | backend (migration e7e9f9ab3035) |
| `signal` column on search_logs | backend (migration f8a9b0c1d2e3) |
| Signal sub-type badges in analytics dashboard | frontend analytics/page.tsx |
| Recent Activity section moved to top of analytics page | frontend analytics/page.tsx |
| Ghost queries show `—` result count (not `0`) | frontend analytics/page.tsx |

Mostly widget.js. Small backend surface area.

---

## Schema Changes

```sql
ALTER TABLE search_logs ADD COLUMN engagement BOOLEAN DEFAULT FALSE;  -- migration d6e7f8a9b0c1
ALTER TABLE search_logs ADD COLUMN session_id TEXT;                   -- migration e7e9f9ab3035
ALTER TABLE search_logs ADD COLUMN signal TEXT;                       -- migration f8a9b0c1d2e3
```

`engagement = true` if hover or scroll fired during the session before settle. Used to distinguish `abandoned` from `browsed`.
`session_id` links all settled rows from one browser tab session — enables "expand session queries" grouping in analytics.
`signal` stores the settle trigger (idle/hover/scroll/enter/click/visibilitychange) — used to show sub-type badges in Recent Activity.

---

## Bug Fixes (Post-Phase 6.4)

### Session ID Refresh Bug
`getSessionId()` originally read from `sessionStorage`. Browsers persist `sessionStorage` across page refreshes (only cleared on tab close), causing post-refresh searches to be grouped with pre-refresh abandoned rows in analytics.

**Fix:** `_sessionId` is now a module-level JS variable generated once per widget init (page load). Refreshing the page generates a new ID. Multiple settle calls within one page load still share it via the variable.

### Clicked Rows Showing as Abandoned
**Root cause:** Three settle signals could fire for the same session in sequence:
1. `mouseenter` → `sendSettle("hover")` → resets `sessionHadEngagement=false`, `sessionBuffer=[]`, `sessionStarted=false`
2. Click fires → `fetch(CLICK_URL)` marks `clicked=True`
3. Navigation or tab-switch → `visibilitychange` fires → `sendSettle("visibilitychange")` with `engagement=false` → **overwrote** `clicked=True` and `engagement=True` back to `False`

**Widget fix:** `sendSettle` now clears `settleTimer` and `scrollSettleTimer` so idle/scroll timers can't fire a second settle for the same session. `visibilitychange` handler checks `sessionStarted` — if session was already closed by hover/idle, it skips.

**Backend fix:** Settle endpoint's `log_id` row update only ever sets `clicked`, `searched`, `engagement` to `True` — never overwrites them to `False`. A late visibilitychange settle with `engagement=false` leaves a previously-set `engagement=True` untouched.

---

### Bug 39 — Duplicate Settled Rows per Session (hover/scroll/idle all fire)

**Symptom:** Searching "owww" produced 68 settled rows in search_logs with the same session_id. Top queries and Recent Activity showed the same query repeated dozens of times per session.

**Root cause — widget:** Three separate code paths could each call `sendSettle()` for the same session:
1. **Hover** — each result item has a `mouseenter` listener that calls `sendSettle("hover")`. First hover fires, resets `sessionStarted=false`, `sessionBuffer=[]`. Second mouseenter on a different result item calls `snapshotQuery()` (which re-adds to now-empty buffer) then `sendSettle()` again → new ghost insert. With 10+ results in the dropdown, 10+ settle requests fire in milliseconds.
2. **Scroll** — same pattern: after scroll settle, user scrolls again → buffer refilled → another settle.
3. **Idle** — after idle settle, user types same query again → `sessionStarted=true` → `doSearch()` fires → `scheduleSettle()` → idle fires again after 3s → duplicate for same (session_id, query).

**Widget fix:** Added `if (!sessionStarted) return;` guard to both `mouseenter` and `scroll` handlers — mirrors the existing guard on the `visibilitychange` handler. Once the first settle closes the session (`sessionStarted=false`), all subsequent event handlers for that session are no-ops.

**Backend fix (defense in depth):** Before inserting any settled row, check if a row with the same `(session_id, query)` already exists as `settled=true` for this client. If yes, `continue` — skip the insert entirely. This catches any remaining duplicates regardless of widget behavior (e.g. idle firing after hover for the same session).

**Ghost insert sentinel:** Ghost inserts previously used `result_count=0`, making them indistinguishable from real zero-result searches. Changed to `result_count=-1` (sentinel). The analytics API maps `-1 → null`. The dashboard shows `—` for these rows. Zero-result analysis (`result_count = 0 AND response_ms IS NOT NULL`) already excluded them. Store owners now see an honest `—` instead of a misleading `0` — a ghost "red shoes" refined away before idle has unknown results, not zero results.

**Why result_count=-1 matters:** A query with 0 results is actionable (stock these products). A ghost query with unknown results is a different signal (intent captured, result quality unknown). Conflating them produces a false zero-result count and misleads store owners about catalog gaps.
