# ScubaSearch — Search Intent Logging: Full Design

> **This doc is a design rationale record.** The "What We Have Today" and "The Gap" sections below describe the original problem. See "Current Shipped State" for what is actually running.

---

## Current Shipped State (Phase 6.5.1)

### Intent types (4, simplified in Phase 6.5)

| Type | Signal |
|---|---|
| `clicked` | user clicked a result |
| `searched` | Enter key — applied to **final intent query only** |
| `browsed` | engagement=true (hover or scroll during session) but not clicked/searched |
| `abandoned` | engagement=false, not clicked/searched |

Sub-tags (browsed:hover, browsed:scroll, browsed:idle) were **removed in Phase 6.5** — the distinction was not actionable and caused race conditions. Signal column still records raw trigger for internal debugging.

### How logging works now

- `/search` endpoint does **not** log anything — no fire-and-forget row per keystroke
- Widget collects per-query metadata in `queryMeta` dict: `{result_count, cache_hit, response_ms}` on every search response
- On settle, widget sends `{queries: [...sessionBuffer], query_meta: {query: {result_count,cache_hit,response_ms}}, signal, engagement}`
- Backend runs `extract_intents()` on the buffer, then `_compact_linear_refinements()` to drop prefix-build noise
- One `search_logs` row inserted per meaningful intent, with real metadata (no more `-1` ghost sentinels for metadata-backed rows)
- Existing browsed row for same `(session_id, query)` is **upgraded** on click/enter instead of being skipped by dedup

### Session lifecycle

- `_sessionId` rotates on `resetSession()` — post-settle continuation is a fresh session
- Idle timer: **5s** (raised from 3s in Phase 6.5.1 to reduce accidental splits)
- Settle returns actual `rows_written` count

### Linear refinement compaction

`_compact_linear_refinements()` drops intermediate prefix steps within a session:
```
"ad" → "adi" → "adidas"  →  keeps only "adidas"
"nike" → "adidas"         →  keeps both (non-linear reformulation, different concepts)
```

---

## Original Design Problem (Historical Rationale)

## What We Had Before

ScubaSearch originally had three intent types, derived from how a search session ends:

| Type | Signal |
|---|---|
| `clicked` | user clicked a result |
| `searched` | user pressed Enter |
| `browsed` | 3s idle timer fired (raised from 2s when hover/scroll signals added) |

**The critical limitation:** intent classification only applied to the **single final settled query**. Everything the user searched before the final query was permanently lost.

---

## The Gap — Intermediate Queries Are Invisible

Current flow:
```
user types: "red shoes running" → search fires, log row created (settled=false)
user deletes back to: "red shoes" → search fires, log row created (settled=false)
2s idle fires → ONLY "red shoes" gets settled=true
```

`"red shoes running"` — a real, meaningful query the user paused on and looked at results for — is gone. It never surfaces in top queries, never surfaces in analytics anywhere.

This means top queries analytics only reflect where users *ended up*, not what they meaningfully *searched during* a session. Users who refine heavily are underrepresented. The data is a biased sample.

---

## The Signals Problem — How "Browsed" Is Currently Detected

The 2s idle timer is the only signal. It has three real weaknesses:

1. **Tab switch / page leave** — user types `"red nike air max"`, sees results, switches to another tab to compare prices. The 2s timer never fires. That search never settles. Clear browsed intent, invisible to analytics.

2. **Fast refiners** — user types `"red shoes running"`, pauses 1.8s looking at results, then refines. Timer never fires. Intent lost.

3. **Mobile keyboard dismissal** — dismiss keyboard mid-session, timer may or may not fire depending on blur handling.

---

## Better Signals for Browsed Detection

### 1. Hover on result items
User moved cursor over a result item — they are reading it. Strongest possible browsed signal short of a click.

```js
resultItem.addEventListener('mouseenter', () => settleCurrentQuery('browsed:hover'));
```

### 2. Scroll inside results dropdown
User scrolling the results list is explicit "I am scanning these results" behaviour.

```js
resultsContainer.addEventListener('scroll', () => {
  clearTimeout(scrollSettleTimer);
  scrollSettleTimer = setTimeout(() => settleCurrentQuery('browsed:scroll'), 300);
});
```

### 3. visibilitychange (tab switch / page leave)
```js
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    settleCurrentQuery();
  }
});
```

Catches: tab switch, browser minimize, phone lock screen, navigation away.

### 4. beforeunload
```js
window.addEventListener('beforeunload', () => {
  settleCurrentQuery(); // keepalive: true already set on fetch
});
```

---

## Expanded Intent Types — 4 Types + Sub-tags

### The 4 Types

| Type | What it means | Signal |
|---|---|---|
| `clicked` | user clicked a result | click event |
| `searched` | user deliberately submitted | Enter key |
| `browsed` | user looked at results, showed engagement | idle / hover / scroll |
| `abandoned` | user got results, showed zero engagement, left | visibilitychange / blur with no prior hover/scroll |

`abandoned` is genuinely different from `browsed` and actionable for store owners:
- `browsed` = they looked, didn't click — result quality issue
- `abandoned` = they didn't even engage — probably zero results or completely wrong results

### Sub-tags on Browsed

`browsed` gets a sub-tag recording which signal triggered it:

| Sub-tag | Signal |
|---|---|
| `browsed:idle` | 2s idle timer fired |
| `browsed:hover` | cursor entered a result item |
| `browsed:scroll` | user scrolled the results list |

**Update (shipped):** Sub-tags ARE surfaced in the store owner dashboard as intent badge variants in the Recent Activity table. `browsed` rows show the specific sub-type badge: Hover (purple), Scroll (indigo), Idle (slate), Tab Switch (sky). `abandoned` rows always show plain gray regardless of signal. This was shipped because store owners find signal-level granularity useful — "they hovered" vs "they tabbed away" tells a different story about result quality.

### Detection Logic for abandoned vs browsed

```
session ends (visibilitychange / blur / beforeunload)
  ↓
did any hover or scroll event fire during this session?
  yes → browsed (they engaged with results)
  no  → abandoned (they saw results and left immediately)
```

### sessionSettled flag (duplicate settle prevention)

After a terminal signal fires (`click`, `enter`, or `visibilitychange`), the widget sets `sessionSettled = true`. This prevents any subsequent signals from firing settle for the same session — e.g. `visibilitychange` after a click, or `idle` after Enter. Typing again resets the flag and starts a fresh session.

### Ghost row exclusion from analytics

All user-facing analytics queries filter `response_ms IS NOT NULL` to exclude ghost rows (intent snapshots with `result_count=-1` and no search response). This prevents ghost rows from inflating total_searches, skewing intent breakdown counts, and distorting CTR calculations.

---

## Query Snapshot Buffering

### The Problem It Solves

Single-query settle captures only where the user ended up. Query snapshot buffering captures every meaningful query the user looked at during the entire session.

### How It Works

Every time the widget fires a `/search` request (already happening on every input change for live results), push the current query + timestamp into a session buffer in memory:

```js
// in widget.js
let sessionBuffer = [];

function onSearch(query) {
  fetch('/search', { body: { q: query } })         // live results — unchanged
  sessionBuffer.push({ value: query, timestamp: Date.now() })  // NEW — just this line
}
```

Session buffer at the end of a user's session:
```js
[
  { value: "red",               timestamp: 1200 },
  { value: "red shoes",         timestamp: 1600 },  // ← 1200ms gap after this
  { value: "red shoes running", timestamp: 3300 },  // ← 1700ms gap after this
  { value: "red shoe",          timestamp: 5000 },
  { value: "red",               timestamp: 5200 },
  { value: "red sun",           timestamp: 6200 },  // ← session end
]
```

On session end, send the full buffer instead of a single query:
```
POST /search/settle { queries: [ ...sessionBuffer ], signal: "idle" }
```

### Backend Extraction

Backend runs `extract_intents()` (pause + direction detection — see `scubasearch_keystroke_extraction.md`) on the array:

```
"red shoes"          → extracted (1200ms pause)   → browsed:idle
"red shoes running"  → extracted (1700ms pause)   → browsed:idle
"red sun"            → extracted (session end)    → browsed:idle
```

Three settled rows inserted into `search_logs` instead of one. `"red shoes running"` now surfaces in top queries.

### What Changes

**widget.js:**
- Add `sessionBuffer = []` initialised on widget init
- Push `{ value, timestamp }` on every search fire
- Send `sessionBuffer` array on session end instead of single query string
- Reset buffer after sending

**backend — settle endpoint:**
- Accept `queries: list` instead of `query: str`
- Run `extract_intents()` on the list
- Insert one `search_logs` row per extracted intent

**No new table.** Three schema changes shipped: `engagement BOOLEAN DEFAULT FALSE` (migration d6e7f8a9b0c1), `session_id TEXT NULL` (migration e7e9f9ab3035), `signal TEXT NULL` (migration f8a9b0c1d2e3).

### What Stays the Same
- `/search` fires exactly as it does now on every keystroke — live results completely unchanged
- No per-character data — only queries that actually fired a search get buffered
- Existing `clicked` and `searched` intent paths unchanged

---

## Per-Character Keystroke Logging vs Query Snapshot Buffering

Per-character logging (every single character with timestamp) was considered and rejected:

| | Per-character | Query snapshots |
|---|---|---|
| Payload size | Large (19+ entries for "red sun") | Small (6 entries — one per debounced search) |
| Extraction output | Identical | Identical |
| Privacy | Every partial character stored | Only queries that actually fired |
| Complexity | Higher | Low |
| Value add | None over snapshots | — |

The extraction algorithm (pause + direction detection) produces the same output at query-snapshot granularity as at character granularity. Character-level data is noise for this use case.

---

## What Analytics Companies Use

| Company | Approach |
|---|---|
| **Algolia** | Logs every debounced search server-side. Browsed = search with results + no click. Uses `queryID` to link search → click → conversion. No keystroke buffering. |
| **Google Search Console** | Impression + click model. Result shown = impression, clicked = click. CTR is the browsed signal. No keystroke data. |
| **Mixpanel / Amplitude** | `Search Performed` event on submit or settle. No per-keystroke data. |
| **Hotjar / FullStory** | DO capture full keystroke streams — but for session replay / UX debugging, not search analytics. Privacy-invasive, GDPR-heavy. |
| **Elasticsearch** | Logs every search, derives browsed from "searched + results rendered + no click follow-up". |

ScubaSearch's approach with query snapshot buffering + hover/scroll signals + abandoned type is **more sophisticated than Algolia's default** and on par with what large search teams build custom.

---

## Idle Timer — 2s or Different?

The idle timer's role changes once hover/scroll signals are added:

- **Without hover/scroll (current):** 2s is correct. It's the only signal, needs to be long enough to not fire mid-typing.
- **With hover/scroll added:** Idle timer becomes a *fallback* — only fires for users who stare at results without any cursor/scroll movement. In this case **raise to 3s** to reduce false positives, since the genuine engagement signals already cover quick browsers.

The 800ms pause threshold in `extract_intents()` is separate — it's used for identifying intermediate intent states from the snapshot buffer on the backend. Do not conflate with the idle settle timer.

| Scenario | Recommended timer |
|---|---|
| Idle only (current, no other signals) | 2s |
| Idle + hover + scroll (new approach) | 3s |
| Pause threshold in extraction algorithm | 800ms |

---

## Is This Expensive?

**Storage:** `intent` is already TEXT. `"browsed:hover"` vs `"browsed"` = 6 extra bytes. Negligible. Multiple intents per session = 2-3 rows instead of 1. Still negligible.

**Network:** Same settle payload shape, slightly larger body (array instead of string). Negligible.

**Widget complexity:** A few JS flags to track which signal fired. One buffer array. Low cost.

**Backend:** `extract_intents()` runs on an array of 5-20 items. Pure Python, no DB calls, microseconds. Zero cost.

Not expensive at any dimension.

---

## Full Recommendation

| Decision | Recommendation |
|---|---|
| Query snapshot buffering | ✅ Yes — biggest impact, fixes the core gap |
| Hover on result items signal | ✅ Yes — best browsed evidence |
| `visibilitychange` signal | ✅ Yes — catches tab switch miss |
| Scroll in results signal | ✅ Yes — strong secondary signal |
| `abandoned` intent type | ✅ Yes — actionable for store owners |
| `browsed:idle/hover/scroll` sub-tags | ✅ Stored in `signal` column (migration f8a9b0c1d2e3), shown as badges |
| Idle timer | ✅ Raised to 3s |
| Per-character keystroke logging | ❌ No — query snapshots give same output |
| Surface sub-tags in dashboard | ✅ Shipped — Hover (purple), Scroll (indigo), Idle (slate), Tab Switch (sky) |

---

## Implementation Scope

Roughly 1-2 days:

1. **widget.js** — session buffer, send array on settle, hover/scroll/visibilitychange listeners, abandoned detection flag
2. **backend settle endpoint** — accept queries array, run extract_intents(), insert multiple rows
3. **extract_intents() function** — from `scubasearch_keystroke_extraction.md`, adapted to query-snapshot granularity
4. **analytics intent derivation** — add `abandoned` to the CASE expression in `analytics.py`

Three schema migrations added (see above). Backward compatible otherwise.

---

## Duplicate Settle Prevention

### Widget-side guards
Both `mouseenter` (hover on result item) and the scroll handler check `sessionStarted` before doing anything:
```js
a.addEventListener("mouseenter", function () {
  if (!sessionStarted) return;  // session already closed — skip
  ...
});
dropdown.addEventListener("scroll", function () {
  if (!sessionStarted) return;  // same
  ...
});
```
Once the first settle fires (`sendSettle` sets `sessionStarted=false`), all other result items' hover handlers and subsequent scroll events are no-ops for that session.

### Backend-side dedup
Defense in depth: before inserting any settled row, check if `(session_id, query)` already settled for this client:
```python
if req.session_id:
    already = await session.execute(
        select(SL.id)
        .where(SL.client_id==..., SL.query==intent_query,
               SL.session_id==req.session_id, SL.settled==True)
        .limit(1)
    )
    if already.fetchone():
        continue
```
This catches duplicates the widget might still produce (e.g. idle firing after hover for same session — different signal but same query).

### Ghost query result_count sentinel
Ghost inserts use `result_count = -1`, not `0`. The analytics API maps `-1 → null`. The dashboard shows `—`. This matters because:
- `result_count = 0` = real signal: search returned nothing → store owner should stock these products
- `result_count = -1` = ghost: query was captured as intent but we have no result data
Conflating them produces a false zero-result count and misleads store owners. Zero-result analysis already filters `result_count = 0 AND response_ms IS NOT NULL` which correctly excludes -1.
