# ScubaSearch — Keystroke Logging & Intent Extraction

## The Approach

Two separate phases:

1. **Frontend** — log every single keystroke raw, dead simple, no logic
2. **Backend** — extract meaningful intent states from the raw stream later

This gives you full flexibility — you can re-run extraction with improved logic on all historical data anytime. The raw stream never lies.

---

## Phase 1 — Frontend: Log Everything

No rules, no filtering, no logic. Just capture every input event and send on blur/submit.

```js
let keystrokes = [];

const input = document.getElementById('search-input');

input.addEventListener('input', () => {
  keystrokes.push({
    value:     input.value,
    timestamp: Date.now()
  });
});

function sendKeystrokes(submitted) {
  if (keystrokes.length === 0) return;
  fetch('/api/log-keystrokes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: getSessionId(),
      keystrokes,
      final_query: input.value.trim(),
      submitted
    }),
    keepalive: true // ensures request completes even if page closes
  });
}

// send on leave
input.addEventListener('blur', () => sendKeystrokes(false));

// send on submit
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendKeystrokes(true);
});

function getSessionId() {
  let id = sessionStorage.getItem('scuba_session_id');
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem('scuba_session_id', id);
  }
  return id;
}
```

### What gets sent

```json
{
  "session_id": "abc-123",
  "submitted": true,
  "final_query": "red sun",
  "keystrokes": [
    { "value": "r",                 "timestamp": 1000 },
    { "value": "re",                "timestamp": 1100 },
    { "value": "red",               "timestamp": 1200 },
    { "value": "red s",             "timestamp": 1300 },
    { "value": "red sh",            "timestamp": 1350 },
    { "value": "red sho",           "timestamp": 1400 },
    { "value": "red shoe",          "timestamp": 1500 },
    { "value": "red shoes",         "timestamp": 1600 },
    { "value": "red shoes r",       "timestamp": 2800 },
    { "value": "red shoes ru",      "timestamp": 2900 },
    { "value": "red shoes run",     "timestamp": 3000 },
    { "value": "red shoes runni",   "timestamp": 3100 },
    { "value": "red shoes runnin",  "timestamp": 3200 },
    { "value": "red shoes running", "timestamp": 3300 },
    { "value": "red shoe",          "timestamp": 5000 },
    { "value": "red",               "timestamp": 5200 },
    { "value": "red s",             "timestamp": 6000 },
    { "value": "red su",            "timestamp": 6100 },
    { "value": "red sun",           "timestamp": 6200 }
  ]
}
```

---

## Phase 2 — Backend: Extract Intent States

### The Problem With Simple Rules

`"red shoe"` appears **twice** in the stream with completely different meanings:

```
"red shoe" at timestamp 1500 → user is BUILDING towards "red shoes"   → not an intent
"red shoe" at timestamp 5000 → user is DELETING back from "red shoes running" → not an intent
```

Same string, different context. Word boundary rules alone can't distinguish them. You need **direction + pause detection**.

---

### Signal 1 — Pause Detection

If the user paused on a query for more than X milliseconds, it was intentional. They stopped to look at results.

```
"red shoe"          gap to next = 100ms  → building, skip
"red shoes"         gap to next = 1200ms → PAUSED ✅
"red shoes running" gap to next = 1700ms → PAUSED ✅
"red sun"           last entry           → session end ✅
```

```python
PAUSE_THRESHOLD = 800  # ms — tune this per client if needed

def extract_by_pause(keystrokes):
    intents = []
    for i, entry in enumerate(keystrokes):
        next_entry = keystrokes[i + 1] if i + 1 < len(keystrokes) else None
        gap = (next_entry['timestamp'] - entry['timestamp']) if next_entry else float('inf')
        if gap >= PAUSE_THRESHOLD:
            intents.append(entry['value'])
    return intents
```

---

### Signal 2 — Direction Detection

Track whether the user is **building** (adding chars) or **deleting** (removing chars). Capture the **peak** — the moment the user stops building and starts deleting. That peak is always a meaningful intent state.

```
building: r → re → red → red s → ... → red shoes        ← PEAK, switches to building more
building: red shoes r → ... → red shoes running          ← PEAK, switches to deleting
deleting: red shoes running → red shoe → red
building: red s → red su → red sun                       ← session ends at peak
```

```python
def extract_by_direction(keystrokes):
    intents = []
    for i in range(1, len(keystrokes)):
        prev    = keystrokes[i - 1]['value']
        current = keystrokes[i]['value']
        next_   = keystrokes[i + 1]['value'] if i + 1 < len(keystrokes) else None

        was_building = len(current) > len(prev)
        now_deleting = len(next_) < len(current) if next_ else False
        session_end  = next_ is None

        # capture peak: was building, now switching direction or ending
        if was_building and (now_deleting or session_end):
            intents.append(current)

    return intents
```

---

### Combined Approach (Recommended)

Pause detection + direction detection together. This is what companies like Google use under the hood — capture a query when the user **paused** OR **switched direction**, whichever comes first.

```python
def extract_intents(keystrokes, pause_threshold=800):
    intents = []

    for i in range(len(keystrokes)):
        current = keystrokes[i]
        prev    = keystrokes[i - 1] if i > 0 else None
        next_   = keystrokes[i + 1] if i + 1 < len(keystrokes) else None

        gap          = (next_['timestamp'] - current['timestamp']) if next_ else float('inf')
        was_building = (len(current['value']) > len(prev['value'])) if prev else True
        now_deleting = (len(next_['value']) < len(current['value'])) if next_ else False
        long_pause   = gap >= pause_threshold
        session_end  = next_ is None

        if was_building and (long_pause or now_deleting or session_end):
            intents.append({
                'query':     current['value'],
                'timestamp': current['timestamp'],
                'reason':    'pause' if long_pause else 'session_end' if session_end else 'direction_change'
            })

    return intents
```

### Running on the example stream

```python
keystrokes = [
  { "value": "r",                 "timestamp": 1000 },
  { "value": "re",                "timestamp": 1100 },
  { "value": "red",               "timestamp": 1200 },
  { "value": "red s",             "timestamp": 1300 },
  { "value": "red sh",            "timestamp": 1350 },
  { "value": "red sho",           "timestamp": 1400 },
  { "value": "red shoe",          "timestamp": 1500 },
  { "value": "red shoes",         "timestamp": 1600 },
  { "value": "red shoes r",       "timestamp": 2800 },
  { "value": "red shoes ru",      "timestamp": 2900 },
  { "value": "red shoes run",     "timestamp": 3000 },
  { "value": "red shoes runni",   "timestamp": 3100 },
  { "value": "red shoes runnin",  "timestamp": 3200 },
  { "value": "red shoes running", "timestamp": 3300 },
  { "value": "red shoe",          "timestamp": 5000 },
  { "value": "red",               "timestamp": 5200 },
  { "value": "red s",             "timestamp": 6000 },
  { "value": "red su",            "timestamp": 6100 },
  { "value": "red sun",           "timestamp": 6200 }
]

result = extract_intents(keystrokes)
```

### Output

```json
[
  { "query": "red shoes",         "reason": "pause" },
  { "query": "red shoes running", "reason": "pause" },
  { "query": "red sun",           "reason": "session_end" }
]
```

`"red shoe"` never appears — correctly excluded both times.
`"red"` never appears — correctly excluded as a deletion step.

---

## FastAPI Backend

### Receive and store raw keystrokes

```python
from fastapi import FastAPI
from pydantic import BaseModel
from typing import List
from datetime import datetime
import json

app = FastAPI()

class Keystroke(BaseModel):
    value: str
    timestamp: int

class KeystrokeLog(BaseModel):
    session_id:  str
    keystrokes:  List[Keystroke]
    final_query: str
    submitted:   bool

@app.post("/api/log-keystrokes")
async def log_keystrokes(data: KeystrokeLog):
    entry = {
        **data.dict(),
        "logged_at": datetime.utcnow().isoformat()
    }
    with open("keystroke_logs.jsonl", "a") as f:
        f.write(json.dumps(entry) + "\n")
    return {"status": "ok"}
```

### Extraction endpoint (run on demand or as a background job)

```python
@app.post("/api/extract-intents/{session_id}")
async def extract_session_intents(session_id: str, pause_threshold: int = 800):
    # fetch raw keystrokes for this session from DB
    keystrokes = await db.fetch_keystrokes(session_id)
    intents    = extract_intents(keystrokes, pause_threshold)
    
    # store extracted intents back to DB
    await db.save_intents(session_id, intents)
    
    return { "session_id": session_id, "intents": intents }
```

---

## Postgres Schema

```sql
-- raw keystroke storage
CREATE TABLE keystroke_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  TEXT NOT NULL,
  value       TEXT NOT NULL,
  timestamp   BIGINT NOT NULL,
  logged_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_keystrokes_session ON keystroke_logs(session_id);

-- extracted intent states (populated by backend job)
CREATE TABLE intent_states (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  TEXT NOT NULL,
  query       TEXT NOT NULL,
  reason      TEXT,             -- 'pause' | 'direction_change' | 'session_end'
  timestamp   BIGINT,
  order_index INT,              -- position in journey
  logged_at   TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Tuning the Pause Threshold

The `pause_threshold` is the only variable that matters. You can tune it per client or per use case:

| Threshold | Behaviour |
|---|---|
| 400ms | Very sensitive — catches quick glances at results |
| 800ms | Balanced — recommended default |
| 1200ms | Conservative — only captures deliberate pauses |

Since you store raw keystrokes, you can **re-run extraction with a different threshold anytime** on all historical data without re-collecting anything.

```python
# re-extract all sessions with a new threshold
for session in db.fetch_all_sessions():
    intents = extract_intents(session.keystrokes, pause_threshold=600)
    db.update_intents(session.id, intents)
```

---

## Why This Is Better Than Frontend Extraction

| | Frontend extraction | Keystroke log + backend extraction |
|---|---|---|
| Storage | Tiny (5-10 snapshots) | Heavier (every char) |
| Logic complexity | Baked into frontend | Backend job, rerunnable |
| Replayability | ❌ raw data gone | ✅ re-extract with new logic anytime |
| Threshold tuning | Requires frontend redeploy | Just re-run the job |
| Debugging | Hard — lost data | Easy — full audit trail |
| A/B testing extraction logic | ❌ impossible | ✅ run both on same data |

The raw stream is your source of truth. Snapshots are just a derived view of it.

--- 

will this be storage heavy?
Honestly, yes a little — but let's look at real numbers.

**One session estimate:**

A typical ecommerce search session — user types maybe 20-40 characters total:
```
20 keystrokes × avg 15 chars per entry = ~300 bytes per session
+ timestamps + session_id overhead = ~600 bytes total
```

So roughly **~1KB per session.**

---

**At scale:**

| Sessions/day | Storage/day | Storage/month |
|---|---|---|
| 1,000 | ~1 MB | ~30 MB |
| 10,000 | ~10 MB | ~300 MB |
| 100,000 | ~100 MB | ~3 GB |

For context — **3GB on Postgres costs basically nothing.** Your Hostinger VPS can handle this easily.

---

**But here's the smarter move:**

Don't store raw keystrokes forever. Two-phase storage:

```
Raw keystrokes → kept for 30 days (extraction window)
Extracted intents → kept forever (your actual analytics)
```

```sql
-- auto-delete raw keystrokes older than 30 days
DELETE FROM keystroke_logs
WHERE logged_at < NOW() - INTERVAL '30 days';
```

You run extraction as a background job daily, store the clean intents permanently, then purge the raw data. So long-term you're only storing the extracted snapshots — same as the frontend approach — but you get the full replayability benefit during the 30-day window.

**So the real answer** — slightly heavier short-term, same as frontend extraction long-term. Not a concern at your scale.

---
can we delete the  raw keystorkes immediatly?
Yes! That's actually the cleanest approach — extract intents **on the same request**, store only the extracted intents, never persist raw keystrokes at all.

```
Frontend sends raw keystrokes → FastAPI extracts intents immediately → stores only intents → raw keystrokes discarded
```

```python
@app.post("/api/log-keystrokes")
async def log_keystrokes(data: KeystrokeLog):
    
    # extract immediately, never touch DB with raw data
    intents = extract_intents(
        [k.dict() for k in data.keystrokes],
        pause_threshold=800
    )
    
    # only store the clean intents
    entry = {
        "session_id":  data.session_id,
        "final_query": data.final_query,
        "submitted":   data.submitted,
        "intents":     intents,
        "logged_at":   datetime.utcnow().isoformat()
    }
    with open("intent_logs.jsonl", "a") as f:
        f.write(json.dumps(entry) + "\n")
    
    return {"status": "ok"}
    # raw keystrokes never written anywhere, gone forever
```

---

**The only tradeoff** — you lose the ability to re-run extraction with a different threshold later. But honestly at your stage that's fine. You can always:

1. Ship with `pause_threshold=800`
2. If you later want to tune it, just collect fresh data with the new threshold

Zero storage overhead, zero privacy concerns with raw keystrokes, same clean intents as output. This is probably the right call for ScubaSearch.

---

## How This Applies to ScubaSearch's Current Architecture

### The Gap in the Current Settle Logic

ScubaSearch currently has intent classification — settled queries are tagged as `clicked`, `searched` (Enter), or `browsed` (idle). But this only applies to the **single final query** when the session ends.

Current flow (pre-Phase 6.4):
```
user types: "red shoes running" → search fires, log row created (settled=false)
user deletes: "red shoes"       → search fires, log row created (settled=false)
3s idle fires                   → ONLY "red shoes" gets settled=true
```
*(Idle timer was 2s originally, raised to 3s in Phase 6.4 when hover/scroll signals were added. Idle is now the fallback for users who stare at results without cursor movement.)*

`"red shoes running"` — a real, meaningful intent the user paused on and looked at results for — is permanently lost. Never surfaces in top queries. Never surfaces in analytics anywhere.

This means top queries analytics are a biased sample: they only reflect where users *ended up*, not what they meaningfully *searched during* a session. Users who refine heavily are underrepresented.

---

### The Fix — Query Snapshots, Not Full Keystroke Logging

Full keystroke logging (every character) is unnecessary. The widget already fires a `/search` request on every input change. Those requests already have timestamps. The fix is to **buffer the query at each search fire** into a session array, then send the full array on session end instead of a single string.

This is query-snapshot buffering — same extraction algorithm, coarser granularity, far simpler to implement.

**Current settle payload:**
```json
{ "query": "red shoes" }
```

**New settle payload:**
```json
{
  "queries": [
    { "value": "red shoes running", "timestamp": 3300 },
    { "value": "red shoe",          "timestamp": 5000 },
    { "value": "red shoes",         "timestamp": 7200 }
  ]
}
```

Backend runs `extract_intents()` on the array → extracts `"red shoes running"` (pause) and `"red shoes"` (session end) → marks both as `settled=true` in `search_logs`.

---

### What Changes

**widget.js:**
- Add a session query buffer (array) initialised on widget init
- On every search fire, push `{ value: currentQuery, timestamp: Date.now() }` to the buffer
- On session end (idle timer / Enter / click), POST the buffer instead of a single query string

**backend — settle endpoint:**
- Accept `queries: list` instead of `query: str`
- Run `extract_intents()` on the list
- Insert one settled `search_logs` row per extracted intent (not just one)

**No new table. No schema change. No keystroke storage.**

---

### What This Gives You

- `"red shoes running"` now surfaces in top queries if the user paused on it — even if they refined away before settling
- Analytics reflect actual search intent across the session, not just the final resting query
- Direction detection handles the `"red shoe"` ambiguity — building vs deleting correctly excluded
- Same `clicked` / `searched` / `browsed` intent classification still applies to each extracted query

---

### Timing

This is roughly a day of work — widget.js buffer + backend extraction on settle. The gap is real and affects analytics quality, which is a key product differentiator. Worth doing before Phase 7 ship if analytics are part of the pitch. If shipping first, it doesn't break anything — just underreports meaningful intermediate queries until fixed.