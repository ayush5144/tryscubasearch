# Widget Installation — How It Works & What Store Owners Need to Do

## The one-line answer

Store owners keep their own search bar design. They just paste the script tag. ScubaSearch finds their existing `<input>` and powers the results that appear below it.

```html
<script
  src="https://cdn.scubasearch.io/widget.js"
  data-api-key="sk_live_..."
></script>
```

That's it. Their input's visual design is never touched.

---

## What the widget actually does

1. Finds their existing search input (`input[type="search"]` first, then any input with "search" in the placeholder)
2. Wraps it in a thin `<div class="scs-wrapper">` to enable absolute positioning of the dropdown
3. Listens for keystrokes — debounced 100ms — and fires search requests
4. Renders a results dropdown below their input using ScubaSearch's styling

Their input's CSS, fonts, colors, border, size — none of it changes. We attach to what they have.

---

## What CAN go wrong

### 1. Existing autocomplete conflicts (most common)
Shopify, WooCommerce, and most themes have a native live search dropdown baked in. When the user types, both dropdowns appear simultaneously — theirs stacked on top of ScubaSearch's. The fix is to disable their platform's native autocomplete.

| Platform | Fix |
|---|---|
| Custom HTML site | Nothing to do — paste and done |
| WooCommerce | Disable the live search plugin (1 min) |
| Shopify (Dawn/other themes) | Edit theme to remove predictive search section (~10 min, usually one file) |
| Custom React/Next.js storefront | Remove or disable their existing search suggestions component |

### 2. Wrapper div breaks layout (occasionally)
The widget inserts a `<div>` around the input. If the store's CSS targets `form > input` directly or the input has `flex: 1` inside a flex container, that extra div can break the layout. Fix is usually one line of CSS:

```css
/* If input loses its flex sizing: */
.scs-wrapper { flex: 1; }
```

### 3. Multiple search inputs
The widget attaches to the **first** matching input found. Many stores have two: one in the header nav, one in a mobile menu. The second one won't get the widget. This is a known limitation — multi-input support is a future feature.

### 4. CSP headers
Stores with strict Content Security Policy headers will silently block the widget's fetch calls. Store owner must add:
```
connect-src https://api.scubasearch.io
```
to their CSP. Without this, the widget appears to do nothing and nothing shows in our logs.

---

## The mental model

Think of ScubaSearch as an **engine swap**, not a UI replacement.

- Zara keeps their search bar — their design, their colors, their fonts
- ScubaSearch replaces what happens when you type into it
- The results dropdown is ours (customizable via data attributes)
- Their existing "search button" navigation still works for full results pages

Store owners who want our dropdown to match their store's design use `data-theme`, `data-radius`, `data-attached` attributes to tune it. They don't redesign anything.

---

## Installation checklist for store owners

- [ ] Paste script tag before `</body>`
- [ ] Confirm your search input has `type="search"` or "search" in the placeholder
- [ ] Disable your platform's existing live search / autocomplete
- [ ] Add `connect-src https://api.scubasearch.io` to CSP header (if applicable)
- [ ] Test: type 3+ characters → ScubaSearch results appear → click navigates to product
