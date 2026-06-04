# Widget vs Raw API — Tracking Capability Comparison

When a store uses `widget.js`, they get full intent tracking out of the box.
When they build a custom integration (mobile app, headless frontend, API-direct), they only get the basics — unless they implement the settle contract themselves.

---

## What each client gets

| Feature | widget.js | Try Search — Widget mode | Try Search — API mode | Raw API user |
|---|---|---|---|---|
| `POST /api/v1/search` — core search results | ✅ | ✅ | ✅ | ✅ |
| Idle settle (fires after user stops typing) | ✅ 3s timer | ✅ 3s timer | ✅ 2s timer | ❌ must build |
| Enter key settle (`searched=true`) | ✅ | ✅ | ✅ | ❌ must build |
| Click settle (`clicked=true`) | ✅ | ✅ | ✅ | ❌ must build |
| **`session_id`** — groups session rows together | ✅ | ✅ | ❌ not sent | ❌ must build |
| **`queries` array** — full session snapshot buffer | ✅ | ✅ | ❌ not sent | ❌ must build |
| **`engagement` flag** — hover/scroll detection | ✅ | ✅ | ❌ always false | ❌ must build |
| **Ghost query logging** | ✅ | ✅ | ❌ | ❌ must build |

---

## What each field means

### `session_id`
A random ID generated once when the page loads. All settle calls from that visit include the same ID.

**Without it:** every search row is isolated. You can't tell "user typed 3 things before clicking" from "3 different users each searched once." Session grouping in analytics is broken — Recent Activity shows disconnected rows with no narrative.

**With it:** you can reconstruct a full search session. "User opened widget → typed 'nik' → 'nike' → 'nike running' → clicked Air Pegasus." That's a story. Without session_id it's just three rows.

---

### `queries` array (session buffer)
As the user types, the widget snapshots every meaningful pause (word boundary + 400ms gap) into an in-memory buffer. On settle, the entire buffer is sent as an array of `{ value, timestamp }` objects.

```
User types:  n → ni → nik → nike → nike r → nike run → nike running shoes
Snapshots:  ["nike", "nike run", "nike running shoes"]
```

The backend's `extract_intents()` function then finds queries the user actually paused on (≥800ms gap) and logs each as a separate `search_logs` row.

**Without it:** you only ever see the final query. "nike running shoes" gets logged. The fact that the user explored "nike" and "nike run" first is invisible. You miss the refinement journey entirely.

**With it:** ghost queries surface. "nike" gets logged even if it was never submitted. You see what users explore, not just what they commit to. This is the data that tells you "users start broad and refine" vs "users know exactly what they want."

---

### `engagement` flag
Set to `true` if the user hovered over any result item or scrolled the dropdown during the session. Sent as part of the settle payload.

**Without it:** every session that doesn't end in a click shows as **Abandoned** — even if the user spent 10 seconds reading results. You can't distinguish "opened widget, got garbage results, left" from "opened widget, browsed 8 results, considered buying, closed."

**With it:** the **Browsed vs Abandoned** split becomes meaningful:
- `engagement=true` → user looked at results → **Browsed** (amber)
- `engagement=false` → user didn't interact with results → **Abandoned** (gray)

This is the single most actionable signal for diagnosing search quality. High abandoned rate = results are irrelevant. High browsed rate = results look right but something stops conversion.

---

### Ghost queries
A ghost query is a query that was snapshotted in the session buffer but was never directly searched (the user refined away before the idle timer fired). The backend inserts it as a `search_logs` row with `result_count=-1` (unknown — no actual search was made for it).

**Frontend shows:** `—` in the results column of Recent Activity.

**Why it matters:** shows the search exploration path, not just the destination. A user who typed "nik" → "nike" → "nike air" → clicked on "nike air max" generated three ghost queries and one clicked query. Without ghosts, you only see the click.

---

## The settle contract (for raw API users)

Anyone can implement full tracking by calling the settle endpoint manually:

```js
// 1. Generate session_id once on page load
const sessionId = Math.random().toString(36).slice(2)

// 2. Track snapshots as user types (word-boundary pauses)
const buffer = []
// ... snapshot logic ...

// 3. On idle / enter / click — call settle
fetch('/api/v1/search/settle', {
  method: 'POST',
  headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    log_id:     lastLogId,               // UUID from the search response
    session_id: sessionId,               // page-load ID
    queries:    buffer,                  // [{ value: "nike", timestamp: 1234567890 }]
    signal:     signal,                  // idle | enter | click | scroll | visibilitychange
    clicked:    signal === 'click',      // → "clicked" intent in analytics
    searched:   signal === 'enter',      // → "searched" intent in analytics
    engagement: signal === 'click' || signal === 'scroll', // → "browsed" vs "abandoned"
  })
})
// Signal → analytics tag:
// click              → clicked
// enter              → searched
// idle               → abandoned  (engagement=false — idle alone is NOT browsing)
// visibilitychange   → abandoned
// scroll             → browsed    (requires adding a scroll listener)
```

The widget is a pre-built implementation of this contract. Any client that implements it gets the same analytics fidelity.

---

## Try Search gap

Try Search (`/dashboard/testscuba`) has two modes selectable via a toggle:

**API mode** (default) — calls the API directly. Sends basic settle calls (idle, enter, click) but omits `session_id`, `queries` array, and `engagement`. Clicked and Searched intents log correctly; everything else shows as Abandoned. No ghost queries, no session grouping.

**Widget mode** — injects the real `widget.js` script tag dynamically (`data-api-base` points to local/dev API). Full fidelity: session_id, queries buffer, engagement, ghost queries all work exactly as on a real store. Script is cleaned up on mode switch or unmount.

This means you can now test full analytics fidelity from the dashboard by switching to Widget mode. API mode remains available for quick raw-API testing.
