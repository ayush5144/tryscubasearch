# Headless Widget Mode — Complete Setup Guide

## What is headless mode?

By default, ScubaSearch renders its own results dropdown below your search bar. Headless mode turns that off.

In headless mode:
- The widget runs invisibly — handles search requests, debouncing, caching, and all analytics
- Your dropdown is **never shown**
- Instead, the widget fires a JavaScript event called `scubasearch:results` after every search
- You listen to that event and render results exactly how you want — your own HTML, your own CSS, your own card design

**Who needs this:**
- Stores with a fully custom search UI design that doesn't match our dropdown
- React / Next.js / Vue storefronts where you want to put results into your app state
- Stores with highly branded product cards (custom fonts, badges, hover animations)
- Mobile WebView apps where native rendering is preferred

**Who doesn't need this:**
- Small stores where our default dropdown works fine
- Stores that just need minor visual tweaks — use `data-radius`, `data-theme`, `data-attached` first

---

## The event

Every time a search completes, the widget fires this event on `window`:

```js
window.dispatchEvent(new CustomEvent('scubasearch:results', {
  detail: {
    query: "nike running shoes",   // what the user typed
    results: [                     // array of products
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
    total: 8,          // number of results returned
    cache_hit: true,   // was this served from cache?
    log_id: "abc123"   // use this for click tracking (see below)
  }
}))
```

This fires on **every search** — whether there are results or not. When there are no matches, `results` is an empty array.

---

## Step 1 — Add `data-headless="true"` to your script tag

```html
<script
  src="https://cdn.scubasearch.io/widget.js"
  data-api-key="sk_live_..."
  data-headless="true"
></script>
```

That's all you need on the script tag. Same file, same URL — just one extra attribute.

**Without `data-headless`** (or `data-headless="false"`): the default dropdown still shows AND the event fires. Useful if you want to use the event for a side effect (like updating a results count badge) without replacing the dropdown.

---

## Step 2 — Listen to the event and render your results

You write the render function. Here's a complete example:

```html
<!-- Your search input — no changes needed here -->
<input type="search" class="my-search-bar" placeholder="Search..." />

<!-- Your own results container — your HTML, your CSS -->
<div id="my-results" style="display:none;"></div>

<script>
  window.addEventListener('scubasearch:results', function(e) {
    var results   = e.detail.results
    var query     = e.detail.query
    var container = document.getElementById('my-results')

    if (!results.length) {
      container.style.display = 'none'
      return
    }

    // Build your own card design — zero constraints
    container.innerHTML = results.map(function(p) {
      return (
        '<a href="' + p.product_url + '" class="my-product-card" ' +
            'data-product-id="' + p.id + '" ' +
            'data-log-id="' + e.detail.log_id + '">' +
          '<img src="' + p.image_url + '" alt="' + p.title + '" />' +
          '<div class="my-card-info">' +
            '<p class="my-card-title">' + p.title + '</p>' +
            '<p class="my-card-price">₹' + p.price + '</p>' +
          '</div>' +
        '</a>'
      )
    }).join('')

    container.style.display = 'block'
  })
</script>
```

---

## Step 3 — Signal engagement (hover / scroll)

The widget needs to know if the user actually looked at your results — this classifies the session as "browsed" instead of "abandoned" in analytics.

In default mode the widget handles this automatically (hover listeners on its own result elements). In headless mode, **you rendered the cards**, so you tell the widget when engagement happens.

Call this from your result card hover handler:

```js
card.addEventListener('mouseenter', function() {
  if (window.ScubaSearch) window.ScubaSearch.engage()
})
```

Or with delegation after rendering:

```js
var cards = document.querySelectorAll('.my-result-card')
cards.forEach(function(card) {
  card.addEventListener('mouseenter', function() {
    if (window.ScubaSearch) window.ScubaSearch.engage()
  })
})
```

`window.ScubaSearch.engage()` is exposed by the widget automatically — nothing extra to install or import. Calling it just flips the engagement flag for the current session. You can call it as many times as you want — it's idempotent.

If you skip this, sessions where the user hovers results will still be logged — they'll just show up as "abandoned" instead of "browsed" in your analytics.

---

## Step 4 — Click tracking (important for CTR analytics)

In default mode, the widget attaches click handlers to its own links automatically.

In headless mode, **you render the links**, so you need to fire click tracking yourself. The widget exposes `window.ScubaSearch.click(productId)` — one call that handles everything: fires `POST /api/v1/search/click` using the widget's stored API key and the current session's log_id, then marks the session as clicked in analytics.

```js
// Attach this to your product cards after rendering
document.getElementById('my-results').addEventListener('click', function(e) {
  var card = e.target.closest('[data-product-id]')
  if (!card) return

  var productId = card.getAttribute('data-product-id')

  // One call — widget handles the API request and settle signal
  if (window.ScubaSearch) window.ScubaSearch.click(productId)
})
```

**Important:** `ScubaSearch.click()` also settles the session — no more duplicate events will fire after a click (e.g., on tab switch). This is handled automatically.

If you skip click tracking, CTR won't appear in analytics — but everything else (search volume, zero results, settle intent) still works fine.

---

## React / Next.js example

```jsx
import { useEffect, useState } from 'react'

function SearchResults() {
  const [results, setResults] = useState([])
  const [logId, setLogId]     = useState(null)

  useEffect(() => {
    function handler(e) {
      setResults(e.detail.results)
      setLogId(e.detail.log_id)
    }
    window.addEventListener('scubasearch:results', handler)
    return () => window.removeEventListener('scubasearch:results', handler)
  }, [])

  function trackClick(productId) {
    // Preferred: widget handles the API call and settle signal
    if (window.ScubaSearch) window.ScubaSearch.click(productId)
  }

  if (!results.length) return null

  return (
    <div className="my-results-container">
      {results.map(product => (
        <a
          key={product.id}
          href={product.product_url}
          onClick={() => trackClick(product.id)}
          className="my-product-card"
        >
          <img src={product.image_url} alt={product.title} />
          <p>{product.title}</p>
          <p>₹{product.price}</p>
        </a>
      ))}
    </div>
  )
}
```

---

## What still works automatically in headless mode

You don't need to implement any of this yourself:

| Feature | Handled by |
|---|---|
| Debounced search (100ms) | Widget |
| API key auth | Widget |
| Search result caching | Widget |
| Search logging to analytics | Widget |
| Settle tracking (idle, enter, tab close) | Widget |
| Session termination after click/enter | Widget |
| Session ID scoping | Widget |
| Stale request cancellation | Widget |
| **Engagement signals** | **You** (`ScubaSearch.engage()` on hover) |
| **Click tracking** | **You** (`ScubaSearch.click(productId)`) |
| **Cleanup (SPAs only)** | **You** (`ScubaSearch.destroy()` before re-inject) |

---

## What the store owner keeps

- Their search input — untouched, same design
- Their card design — their HTML, their CSS, their fonts, their layout
- Their navigation — clicking a result goes to their product page as normal

They only give up: our default dropdown appearance.

---

## Session lifecycle

A session starts when the user types their first character and ends when one of these happens:

| Signal | What triggers it |
|---|---|
| `click` | User clicks a product (via `ScubaSearch.click()` or widget's own link) |
| `enter` | User presses Enter in the search bar |
| `idle` | No typing for 3 seconds |
| `visibilitychange` | User switches tabs or hides the page |

After a terminal signal (`click`, `enter`, or `visibilitychange`), the session is **settled** — no more events fire. Typing again starts a fresh session. This prevents duplicate abandoned rows after a click.

---

## Cleanup for SPAs

If your app re-injects the widget (e.g., React route changes), call `ScubaSearch.destroy()` before removing the script tag. This removes all event listeners (especially `visibilitychange`) to prevent zombie instances:

```js
// Before re-injecting
if (window.ScubaSearch && window.ScubaSearch.destroy) {
  window.ScubaSearch.destroy()
}
// Then remove the old script tag and inject a new one
```

On static stores (load once, never re-inject), you don't need this.

---

## No SDK required

You don't need to install any npm package. The event is plain browser JavaScript — works in vanilla JS, React, Vue, Svelte, anything. The widget.js file is the only thing you embed.

A proper React SDK (`useScubaSearch` hook) is a future nice-to-have once there's demand.

---

## Full script tag reference

```html
<script
  src="https://cdn.scubasearch.io/widget.js"
  data-api-key="sk_live_..."
  data-headless="true"

  <!-- these still work in headless mode -->
  data-max-results="10"
  data-placeholder="Search products..."
  data-semantic-ratio="0.7"
></script>
```

`data-layout`, `data-theme`, `data-attached`, `data-radius` are ignored in headless mode since no dropdown is rendered.
