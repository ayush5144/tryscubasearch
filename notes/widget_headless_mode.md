# Widget Headless Mode — `scubasearch:results` Event

## What it is

An optional JS event dispatched by the widget every time search results arrive. Store owners who want full control over how results look can listen to this event and render their own UI completely. Stores that don't listen to it see zero change — the default dropdown works as normal.

---

## How it works

The widget dispatches a `CustomEvent` on `window` after every search response:

```js
window.dispatchEvent(new CustomEvent('scubasearch:results', {
  detail: {
    query: "nike running shoes",   // what the user typed
    results: [                     // array of products (same as API response)
      {
        id: "prod_123",
        title: "Nike Air Pegasus 41",
        price: 12999,
        image_url: "https://...",
        product_url: "https://...",
        category: "Running",
        in_stock: true
      },
      // ...
    ],
    total: 8,         // number of results returned
    cache_hit: true,  // was this served from cache?
  }
}))
```

This fires on every search — cache hit or miss, results or no results. `results` is an empty array when there are no matches.

---

## Usage — basic example

```html
<!-- 1. Paste the script tag as normal — nothing changes here -->
<script
  src="https://cdn.scubasearch.io/widget.js"
  data-api-key="sk_live_..."
></script>

<!-- 2. Store's own search input — design completely untouched -->
<input type="search" class="zara-search-bar" placeholder="Search..." />

<!-- 3. Store's own results container — their HTML, their CSS -->
<div id="zara-results" style="display:none"></div>

<script>
  window.addEventListener('scubasearch:results', function(e) {
    var results = e.detail.results
    var query   = e.detail.query
    var container = document.getElementById('zara-results')

    if (!results.length) {
      container.style.display = 'none'
      return
    }

    // Render using their own card template — no constraints
    container.innerHTML = results.map(function(p) {
      return '<a href="' + p.product_url + '" class="zara-card">' +
               '<img src="' + p.image_url + '" />' +
               '<span class="zara-title">' + p.title + '</span>' +
               '<span class="zara-price">₹' + p.price + '</span>' +
             '</a>'
    }).join('')

    container.style.display = 'block'
  })
</script>
```

---

## `data-headless="true"` — suppress the default dropdown

By default the widget still renders its own dropdown alongside firing the event. If the store wants **only** their custom UI and not ours, they add `data-headless="true"` to the script tag:

```html
<script
  src="https://cdn.scubasearch.io/widget.js"
  data-api-key="sk_live_..."
  data-headless="true">
</script>
```

With `data-headless="true"`:
- The `scubasearch:results` event still fires on every search
- Our dropdown is never rendered or shown
- The store's event listener has full control
- The `.scs-wrapper` container element is never created — no DOM footprint
- All analytics (search logging, settle, click tracking) still work normally — the widget handles that invisibly

Without `data-headless` (default `false`):
- Both fire — our dropdown AND the event
- Store can listen to the event for side effects (e.g. update a results count badge) without replacing the dropdown

---

## What the store still gets for free

Even in headless mode, the widget handles everything invisible:
- Debounced search requests (100ms)
- API key auth
- Search logging to analytics
- Settle tracking (idle timer, visibilitychange)
- Session lifecycle (`sessionSettled` flag prevents duplicate settles after click/enter)
- Cache (store doesn't need to worry about duplicate calls)

The store only needs to handle rendering.

**SPA cleanup:** If your app re-injects the widget (e.g. React route changes), call `ScubaSearch.destroy()` before removing the script tag. This removes all event listeners (especially `visibilitychange`) to prevent zombie instances firing stale settle events.

---

## Click tracking in headless mode

In default mode the widget handles click tracking automatically. In headless mode, the store renders their own links so they need to fire click tracking manually if they want CTR in analytics.

**Engagement tracking** (for "browsed" intent classification) also requires manual action in headless mode: call `window.ScubaSearch.engage()` from hover handlers on your result cards. The widget no longer attaches page-level listeners in headless mode. If skipped, all sessions will be classified as `abandoned` rather than `browsed` in analytics.

**Preferred approach — use `window.ScubaSearch.click(productId)`:**

```js
// When a result is clicked in headless mode — one call handles everything:
window.ScubaSearch.click(result.id)
```

This sends `POST /api/v1/search/click` using the widget's stored API key and last log ID, then fires `sendSettle("click")` to mark the session as clicked in analytics. No manual fetch or log_id management needed.

**Manual fetch (fallback):**

```js
// Alternative if you need lower-level control:
fetch('https://api.scubasearch.io/api/v1/search/click', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer sk_live_...'
  },
  body: JSON.stringify({
    product_id: result.id,
    search_log_id: e.detail.log_id  // log_id is included in the event detail
  })
})
```

The `log_id` field is included in the event `detail` so the store can link clicks back to the originating search row.

---

## Implementation plan

**Status: Implemented (2026-03-24)**

**In `widget.js`:**

1. Read `data-headless` attribute → `HEADLESS` bool (`scriptEl.getAttribute("data-headless") === "true"`, default `false`)
2. In `renderResults()`: dispatch `scubasearch:results` CustomEvent with `{ query, results, total, cache_hit, log_id }` — fires in both headless and default mode
3. If `HEADLESS === true`: `dropdown = null`, `injectStyles()` skipped, all dropdown DOM references guarded with `if (!dropdown) return`; after results arrive: no page-level engagement listeners, just `scheduleSettle()` and return
4. `window.ScubaSearch.engage()` — exposed as global API inside `init()`; store calls it from their own result card hover handlers in headless mode; sets `sessionHadEngagement=true`; idempotent
5. `window.ScubaSearch.click(productId)` — exposed as global API inside `init()`; fires `POST /api/v1/search/click` using widget's API key + last log_id, then calls `sendSettle("click")`; one call replaces the manual fetch + settle pattern

**In Widget Settings page (`frontend/app/dashboard/settings/widget/page.tsx`):**
- Headless mode toggle with plain-English explanation
- Expandable code example showing the `scubasearch:results` event listener pattern, shown only when headless is ON
- Snippet adds `data-headless="true"` when enabled

---

## Who needs this

| Store type | Needs headless? |
|---|---|
| Small store, no existing search UI | No — default dropdown is fine |
| Store with custom card design (fonts, badges, layout) | Optional — CSS overrides may be enough |
| Enterprise store (Zara-level) with full custom search UI | Yes — headless + their own renderer |
| Headless storefront (React/Next.js) | Yes — can't use DOM-based dropdown anyway |
| Mobile app using WebView | Yes — native rendering preferred |

---

## Relationship to SDKs

This is the reason we don't need a JavaScript SDK before launch. A store owner building a React storefront can listen to `scubasearch:results` and render results into their React state — no npm package needed. The event is framework-agnostic.

```js
// React example
useEffect(() => {
  const handler = (e) => setResults(e.detail.results)
  window.addEventListener('scubasearch:results', handler)
  return () => window.removeEventListener('scubasearch:results', handler)
}, [])
```

A proper React SDK (`useScubaSearch` hook, etc.) is a post-launch nice-to-have once there's demand for it.
