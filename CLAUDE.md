# ScubaSearch — Claude Code Instructions

## What This Project Is

ScubaSearch is a hybrid search SaaS for OTT and content platforms. Platform owners upload their content catalog, paste one JS snippet, and their site gets AI-powered search. $199-499/month. Built on Meilisearch + FastAPI + Next.js.

## Read These First

Before doing anything in a new session, read:
- `dev_scuba/2_scubasearch_architecture.md` — system design, flows, schema
- `dev_scuba/3_scubasearch_notes.md` — build phases, done-when criteria, current phase

Do not ask questions answered in those docs.

## Current State

Phase 0 ✅, Phase 1 ✅, Phase 2 ✅, Phase 3 ✅, Phase 4 ✅, Phase 5 ✅, Phase 6 ✅, Phase 6.5 ✅, Phase 6.6 ✅ (catalog management and generic sync methods), Phase 6.7 ✅ (smart embed), Phase 6.8 ✅ (Postgres products table + inline editor), Phase 6.9 ✅ (homepage redesign + brand system), Phase 8 ✅ removed (Shopify integration built then removed May 2026 — OTT pivot), Phase 9 ✅ removed (Scuba Assistant built then removed 27 Apr 2026), Phase 10 ✅ (admin dashboard /admin2026), Phase 11 ✅ (external database connect — PostgreSQL and MySQL/MariaDB DSNs, field mapping, Celery sync), Phase 12 ✅ (embed config — per-client field order Kanban, custom DB fields via _extra, _build_embed_text + _get_embed_config). Phase 7 (deploy) not started — needs domain before going live. OTT pivot complete (May 2026): actors/director/writer/content_type/year/language/duration fields added; Shopify removed. Only title/category/tags/description are embedded by default; cast/crew/type/year/language/duration remain BM25/filter/display metadata.

Phase 6 built gateway-agnostic billing (no live payment gateway yet). Gateway choice pending (Dodo Payments for global / Razorpay for India / Stripe Atlas). Wire-up is deferred — see CHECKLIST.md Phase 6 Deferred section.

- `backend/` — FastAPI with search + ingest + dashboard + analytics endpoints
- `backend/middleware/` — `auth.py` (Bearer → Redis DB2 → Postgres → client_id; UNPROTECTED_PATHS = `{"/health", "/docs", "/openapi.json", "/api/v1/billing/webhook"}`; CLERK_AUTH_PREFIXES = `/api/v1/me`, `/api/v1/analytics`, `/api/v1/ingest`, `/api/v1/billing`, `/api/v1/documents`, `/api/v1/database`, `/api/v1/api-sync` — these bypass API key auth and use Clerk JWT instead), `rate_limit.py` (1000 req/min sliding window, Redis DB3), `clerk_auth.py` (Clerk JWT via PyJWKClient → clerk_user_id + clerk_email on request.state; requires `cryptography` pip package)
- `backend/routers/clients.py` — `POST/GET/PUT /api/v1/me` (auto-provision on first Clerk login; PUT accepts `UpdateMeRequest` with `store_name`, `store_url`, `store_description`, `embed_config` - partial update); `_resolve_clerk_email()` — two-layer real email: JWT `email` claim → Clerk REST API (`/v1/users/{id}` with CLERK_SECRET_KEY) → `@clerk.local` placeholder; heals existing placeholder emails on next login; `ApiKeyItem` includes `raw_key: str | None` — populated for active keys, NULL for revoked ones; `list_keys` returns raw_key from DB; `GET /api/v1/me/catalog` — returns `{product_count, active_source, active_source_label, active_file_format, last_job}` (product_count live from Meilisearch, last_job from ingest_jobs); `ClientProfile` response includes `embed_config: list[str]` and `available_embed_fields: list[str]`
- `backend/routers/analytics.py` — `GET /api/v1/analytics/summary|top-queries|zero-results|query-log` (all scoped to client; all plans get 30-day window + CTR; no plan-based 403 — all tiers get data; returns 403 only if account not provisioned yet; all queries filter `AND settled = true AND response_ms IS NOT NULL` — ghost rows excluded from all user-facing counts/queries); `top-queries`, `zero-results`, and `query-log` accept `?from_date=YYYY-MM-DD&to_date=YYYY-MM-DD&offset=N` (capped at plan window; offset for pagination / "Load all"); `query-log` returns individual settled events with derived `intent` field: `clicked` (clicked=true), `searched` (searched=true), `abandoned` (engagement=false, not clicked/searched), `browsed` (engagement=true, idle/hover/scroll settled), plus `signal` field (raw settle trigger stored in search_logs.signal); `result_count: int | None` — ghost inserts stored as `-1` in DB, mapped to `null` before return (frontend shows `-`); summary returns `clicked_count`, `searched_count`, `browsed_count`, `abandoned_count`, `total_sessions` (from billing counter alongside `total_searches` query count from search_logs); zero-result analysis filters `result_count=0 AND response_ms IS NOT NULL` (correctly excludes ghost rows); `search_logs` has `engagement`, `session_id`, `signal` columns (migrations d6e7f8a9b0c1, e7e9f9ab3035, f8a9b0c1d2e3); settle endpoint `log_id` update uses only-set-True logic — never overwrites clicked/engagement to False; **backend dedup on (session_id, query) — if already settled row exists for same (session_id, query), upgrade it instead of skipping when a terminal signal (click/enter) arrives** (click upgrades clicked=True, enter upgrades searched=True on final intent only — not all intents); ghost insert dedup — skips ghost insert if a real settled row (result_count >= 0) already exists for same (session_id, query); **no more pure ghost inserts — `query_meta` from widget provides real result_count/cache_hit/response_ms per intent query**; `_compact_linear_refinements()` — drops intermediate prefix-build intents (e.g. "ad" → "adi" → "adidas" keeps only "adidas"); non-linear reformulations preserved; **`searched=True` applied only to final intent query in enter flow, not all extracted intents**; settle response returns actual `rows_written` count not raw intent count; **/search endpoint no longer fire-and-forget logs on every keystroke** — search logging is intent-only via settle; `backend/services/intent.py` - `extract_intents(snapshots, threshold=800ms)` extracts meaningful pauses
- `backend/routers/billing.py` — `GET /api/v1/billing/status` (returns `BillingStatusResponse` with `sessions_used`/`sessions_limit`), `POST /api/v1/billing/webhook` (stub, idempotent), `POST /api/v1/billing/activate-test` (dev only; also sets `onboarding_complete = true` on the client row)
- ~~`backend/routers/shopify.py`~~ — **REMOVED** (May 2026 OTT pivot; Shopify not relevant for streaming platforms)
- `backend/services/billing.py` — gateway-agnostic: `activate_plan`, `cancel_plan`, `get_plan`, `get_limits`, `check_product_limit`, `check_session_limit` (single DB session — fetches subscription once, derives plan + limits from same row; `PLAN_LIMITS` uses `max_sessions` not `max_searches`), `increment_query_count` (called on every /search API call for internal tracking), `increment_session_count` (called from settle endpoint only when rows were actually written), `reset_counts_if_needed`, `ensure_subscription_row`; `subscriptions` table has `monthly_query_count` (renamed from `monthly_search_count`) and `monthly_session_count` (new); plan limits checked against `monthly_session_count`; uses naive datetimes (`datetime.utcnow()` / `_next_month_start()` returns naive) to avoid asyncpg offset-naive vs offset-aware mismatch; **search path order: cache check → plan limit check → embed → search** (cache hits skip the billing DB query entirely)
- `backend/routers/search.py` — `SearchRequest` has `semantic_ratio: float = 0.5`; cache key includes semantic_ratio (`cache_key(client_id, req.query, req.limit, req.semantic_ratio)`); hybrid_search call passes semantic_ratio
- `backend/services/embedding.py` — async httpx client (OpenAI `text-embedding-3-small`, 1536 dims); `cache_key()` signature: `(client_id, query, limit, semantic_ratio)` — all four included in SHA256 hash; different ratios never share cached results
- `backend/services/meilisearch.py` — `hybrid_search()` accepts `semantic_ratio: float = 0.5`; clamped to [0,1]; passed as Meilisearch `semanticRatio`; `ensure_index(client_id)` — enables vectorStore experimental feature, creates index with embedders+settings (1536 dims, userProvided), idempotent; `add_documents()` — waits for Meilisearch task completion (10s timeout) before returning
- `backend/routers/ingest.py` — `POST /api/v1/ingest/csv` (accepts .csv/.json/.ndjson, detects ext, routes to correct Celery mode; **bulk UPSERTs all parsed rows into Postgres `products` table before queuing Celery** (ON CONFLICT client_id+external_id DO UPDATE, sets last_indexed_at=NULL); records `ingest_jobs.file_format`; forces `replace` when switching DB → file source, when append hits an empty index, or when a file upload changes format across CSV/JSON/NDJSON; `GET /api/v1/ingest/jobs/{id}` returns `added_count`, `updated_count`, `skipped_count`)
- `backend/routers/push.py` — API-key authenticated sync routes for platform backends and CMSs: `POST /api/v1/push/document`, `POST /api/v1/push/documents`, and `POST /api/v1/push/webhook`; bulk routes support `replace`, `append`, and `update`
- `backend/routers/api_sync.py` — Clerk-auth pull-sync routes: preview remote JSON payloads, connect a source URL with field mapping, show sync status, trigger a manual sync, and disconnect the scheduled source
- `backend/routers/products.py` — Clerk JWT auth; `GET /api/v1/documents` (paginated from Postgres; filters: `?page&limit&q` title ILIKE, `?category` category ILIKE, `?stale_only=true` — dynamic WHERE builder; ordered updated_at DESC); `PUT /api/v1/documents/{id}` (partial update — semantic field changes clear last_indexed_at for re-embed; metadata-only changes call Meilisearch update_documents() immediately + set last_indexed_at=NOW(); always flushes Redis cache); `DELETE /api/v1/documents/{id}` (Postgres delete + Meilisearch delete + cache flush); `POST /api/v1/documents/reindex` (counts stale rows, queues `reindex_stale_products` Celery task if stale_count > 0)
- `backend/services/auth.py` — `hash_key()`, `generate_api_key()`
- ~~`backend/services/shopify.py`~~ — **REMOVED** (May 2026 OTT pivot)
- `backend/services/cache.py` — Redis DB1 for search cache, DB2 for auth cache, DB3 for rate limit, DB0 for Celery queue only
- `backend/config.py` — app settings including `openai_api_key`, `cf_account_id`, `cf_api_token`
- `backend/workers/` — Celery app + `process_ingest_job(job_id, client_id, file_path, mode, file_format)` task. Batch embedding via OpenAI `text-embedding-3-small` (1536 dims). **Primary data source is Postgres** — each run function calls `_fetch_products_from_db(client_id, mode)` first; falls back to parsing the uploaded file only if DB returns 0 rows. `replace` uses swap-indexes, `append` does smart sync, `update` does partial Meilisearch updates, and all three flush the per-client search cache when done. DB sync is authoritative for the active database source: it clears old Postgres and Meilisearch state before rebuilding, blocks ScubaSearch internal app tables as sources, and keeps DB ids under `dbsync_...`. API pull sync is authoritative for the active pull source too: `sync_external_api_source(client_id)` rebuilds from the remote JSON API and `sync_due_api_sources()` runs from Celery Beat every 5 minutes to trigger scheduled pulls. **Embed config:** `_get_embed_config(client_id)` reads `clients.embed_config`; `_build_embed_text(p, fields)` respects the configured field order and `_extra` columns.
- `frontend/` — Next.js 14 App Router dashboard (shadcn/ui + Clerk + Playwright)
- `frontend/app/layout.tsx` — root layout; loads Inter (`--font-inter`) as `font-sans` and Merriweather (`--font-display`) with weights 400/700/900; both registered as CSS variables via `next/font/google`; wraps in `ClerkProvider`
- `frontend/app/globals.css` — brand CSS variables in `:root`: `--brand-blue: #4338ca`, `--brand-blue-hover: #3730a3`, `--brand-teal: #47E6E1`; `--primary` token set to indigo oklch matching `#4338ca`; `--ring` matches primary; `scroll-behavior: smooth` on `html` element (enables anchor link smooth scroll)
- `frontend/app/page.tsx` — landing page for OTT/content platforms. Pricing: Growth is 1,000 titles / 10,000 sessions ($199/mo); Scale is 10,000 titles / 100,000 sessions ($499/mo). Pricing CTA buttons link to `/dashboard/billing` (Clerk middleware handles auth redirect).
- `frontend/components/NavBar.tsx` — `'use client'` component; fixed header `h-16 bg-white/80 backdrop-blur-md border-b border-slate-100`; logo uses `font-display font-bold text-[#242843]`; logo `onClick` smooth-scrolls to top when already on `/` (uses `window.scrollTo`); desktop nav (hidden md:flex): "Product" link to `#features` shown only when signed out, "Pricing" link always shown, "Dashboard" link when signed in; desktop auth: signed-in shows "Go to Dashboard" button, signed-out shows "Sign in" text link + "Get started" button (both `#4338ca`); mobile: `useState`-controlled (no Sheet component), hamburger opens floating popup card (`fixed inset-x-4 top-4 z-[70] rounded-2xl bg-white shadow-xl`), backdrop is `fixed inset-0 bg-black/20 backdrop-blur-sm` click-to-dismiss; mobile menu contains logo + X close, nav links with border-b separators, full-width CTA buttons; signed-in mobile shows "Sign out" button via `useClerk().signOut({ redirectUrl: '/' })`
- `frontend/lib/api-client.ts` — all API calls centralised here; uses Clerk `getToken()` for auth and trims/validates tokens before sending; `CatalogStats` includes `active_source`, `active_source_label`, `active_file_format`, and `last_job.file_format`; `IngestJobStatus` includes `added_count`, `updated_count`, `skipped_count`; `getCatalog()`, `getProducts()`, `updateProduct()`, `deleteProduct()`, `reindexProducts()`, `addProduct()`
- `frontend/app/dashboard/` — overview, documents (file upload + smart ingest + single-document add), sync (REST push, webhooks, scheduled pull setup), settings (API keys + widget snippet), analytics, testscuba (Try Search - API mode + Widget mode toggle)
- `frontend/app/dashboard/sync/page.tsx` — dashboard surface for generic sync methods; explains REST push, webhook sync, and auto-sync pull; shows live catalog state, sample payloads, cURL examples, field mapping, and pull connection status
- `frontend/app/onboarding/page.tsx` — 3-step onboarding wizard (store details → plan selection → checkout); step 1: store name + URL + description (calls `PUT /api/v1/me`); step 2: plan picker (growth/scale, labels use "sessions" not "searches"); step 3: checkout (calls `POST /api/v1/billing/activate-test` which sets `onboarding_complete=true`); redirects to `/dashboard` on completion; sign-up redirects here via `NEXT_PUBLIC_CLERK_SIGN_UP_FORCE_REDIRECT_URL=/onboarding`; sign-in redirects to `/dashboard` via `NEXT_PUBLIC_CLERK_SIGN_IN_FORCE_REDIRECT_URL=/dashboard`
- `frontend/app/how-billing-works/page.tsx` — public page explaining session vs query billing, session termination signals, plan limits table
- `frontend/app/dashboard/testscuba/page.tsx` — Try Search page; API mode uses headless widget instance (not pure API calls); Widget mode uses standard widget; both modes have semantic ratio slider with number input; shared `cleanupWidget()` function + single script ID prevents zombie widget instances on mode switch
- `frontend/app/dashboard/documents/page.tsx` — "Recommended CSV format" info box visible above the import panel (shows Required: title, Optional: id/description/category/actors/director/writer/tags/content_type/year/language/image_url/product_url). Main page shows two collapsible bars: "Update documents" (file upload) and "View documents" (opens full-screen overlay). **Full-screen overlay** (`position:fixed, inset:2rem`, plain div not shadcn Dialog) contains the TanStack Table with a 3-column header: left (title + search + stale reindex banner), center (View/Edit toggle + "+ Add" button below in edit mode; right (document count + × close). **Filter bar** between header and table: category text input (300ms debounce), stale-only segmented (All sync/Stale only), "Clear filters" link when any active. Table columns: thumbnail (40px), title/category/tags (`InlineCell` click-to-edit in edit mode; `ExpandSpan` click-to-expand in view mode — blur/Enter saves, Escape cancels, optimistic update with revert), description/image_url/product_url (Popover with full textarea + Save; in view mode `ExpandSpan` triggers expand-in-place), sync status badge (✓ green = fresh, ⚠ amber = stale), actions (··· DropdownMenu → Delete with AlertDialog confirm). `ExpandSpan` component: stateful span that toggles `whitespace-normal break-words` vs `truncate` on click — used in view mode for all truncatable cells. Pagination: 50/page. Search input 300ms debounce. Add document Dialog includes OTT metadata fields. Toast for mutation feedback.
- `frontend/app/dashboard/settings/widget/page.tsx` — Widget Settings page: wizard CTA ("Configure your widget in 30 seconds") opens step-by-step 7-question modal; manual config collapsible for advanced users; setup guides for normal + headless mode; CSP note included; layout picker (dropdown/grid), theme toggle, dropdown style (attached/floating visual picker), corner roundness slider+input (0-24px), max results input (custom 1-50), placeholder input, semantic ratio slider, headless mode toggle; live-updating snippet shows only non-default attributes; copy button; purely client-side - no backend, settings reset on page reload (acceptable: workflow is configure once → copy → paste).
- `frontend/app/dashboard/settings/embed-config/page.tsx` — Phase 12; drag-and-drop Kanban for embedding field order; Available fields are driven by the live catalog (`available_embed_fields`) plus database `source_columns`, and the right-hand list is scroll-capped. On Save: `PUT /api/v1/me` with `embed_config` + auto-triggers reindex.
- `frontend/app/dashboard/layout.tsx` — `'use client'`; **onboarding gate**: on mount, fetches `/api/v1/me` and checks `onboarding_complete`; if false, shows spinner and redirects to `/onboarding`; blocks dashboard render until confirmed. **Fixed header** (full-width `position:fixed z-40 h-14`): left portion (w-56) has frosted glass `bg-white/60 backdrop-blur-md border-r border-slate-100/60`; right portion solid white with UserButton; logo uses `font-display font-bold text-[#242843]`. **Fixed sidebar** (`position:fixed top-14 h-[calc(100vh-3.5rem)] w-56 border-r border-slate-100 bg-white z-30 overflow-y-auto`). Main content wrapper: `min-h-screen bg-white text-[#242843]`, offset with `pl-56 pt-14`. Nav items: Overview, Documents, Try Search, Analytics, Sync Methods, Settings, Widget Settings (sub), Embed Config (sub), Database, Billing. Widget Settings and Embed Config sub-nav (`sub: true`) only render when `pathname.startsWith('/dashboard/settings')` - hidden on all other pages; sub-items use `pl-8` indent and smaller icon. `isActive` uses exact match (`pathname === item.href`). Active style: `bg-[#4338ca]/8 text-[#4338ca]`. `useEffect` on mount calls `ensureMe(token)` to auto-provision client account on first login.
- `frontend/app/sign-in/[[...sign-in]]/page.tsx` — teal gradient background matching homepage (top-center radial + bottom-left accent); `font-display` logo link back to `/`; Clerk `<SignIn>` with `routing="path" path="/sign-in"`; appearance API styled to brand: `colorPrimary: '#4338ca'`, `colorText: '#242843'`, card has `shadow-none border border-slate-200 rounded-2xl`; `internal: 'hidden'` on elements to hide Clerk branding; redirects to `/dashboard` via `NEXT_PUBLIC_CLERK_SIGN_IN_FORCE_REDIRECT_URL`
- `frontend/app/sign-up/[[...sign-up]]/page.tsx` — same structure as sign-in; bottom-right accent (mirrored from sign-in's bottom-left); `<SignUp routing="path" path="/sign-up">`; identical appearance config; `internal: 'hidden'`; redirects to `/onboarding` via `NEXT_PUBLIC_CLERK_SIGN_UP_FORCE_REDIRECT_URL`
- `frontend/middleware.ts` — Clerk middleware protecting all `/dashboard/*` routes
- `widget/src/widget.js` — embeddable content search widget (vanilla JS, zero deps, dark/light theme); renders title and poster only in result cards; does not show `content_type` or `year`; reads `data-layout`, `data-semantic-ratio`, `data-attached`, `data-radius`, `data-headless`, and `data-api-base`; dispatches `scubasearch:results` events in both normal and headless modes; exposes `window.ScubaSearch.engage()`, `.click(productId)`, and `.destroy()` for headless integrations.
- `widget/test.html` — minimal dev test page: centered search bar only, no hardcoded products; `src/widget.js` loaded with serve.py placeholder injection (`sk_live_SERVE_PY_INJECTS_THIS` / `SERVE_PY_INJECTS_THIS`)
- `widget/headlesstest.html` — headless mode dev test page; click tracking uses `ScubaSearch.click(productId)` global API (not raw fetch)
- `widget/serve.py` — dev HTTP server; injects API key + base URL from .env/.test_keys.env; `cd widget && python3 serve.py`
- `alembic/` — all tables applied: 5 core tables + `clerk_user_id` on clients + performance indexes + OTT fields on products (migration `e1f2a3b4c5d6`) + onboarding columns on clients (`store_description TEXT`, `onboarding_complete BOOLEAN`, migration `b2c3d4e5f6a7`) + dual billing counters (`monthly_query_count` + `monthly_session_count` on subscriptions, migration `c3d4e5f6a7b8`) + `api_sync_connections` for scheduled pull sources (migration `h7i8j9k0l1m2`)
- `docker-compose.yml` — Meilisearch + Redis running locally (local Postgres used instead of Docker)
- `.mcp.json` — Playwright, shadcn, postgres, and meilisearch MCPs configured at project level (context7 is user-level only)
- Documents are indexed into `products_{client_uuid}` indexes with app-side OpenAI `text-embedding-3-small` 1536-d vectors; search logs are written through the settle flow

Check the phase checklist in `3_scubasearch_notes.md` at session start to confirm current phase.

## How to Work on This Project

- Complete one phase fully before starting the next
- Use MCP tools (postgres, meilisearch) to verify work against live services — not just by reading code
- Apply `.claude/skills/api-standards.md` to every endpoint written
- Apply `.claude/skills/search-quality.md` to every search-related task
- Apply `.claude/skills/testing.md` before marking any phase done
- When blocked, report what failed and what was expected — do not silently move on

## Decisions That Are Locked

Do not revisit these:

| Decision | Choice |
|---|---|
| Search engine | Meilisearch Community Edition |
| Backend | Python + FastAPI |
| Database | PostgreSQL on VPS |
| Cache / Queue | Redis on VPS |
| Embeddings | OpenAI `text-embedding-3-small` (1536 dims) |
| Frontend | Next.js on Cloudflare Pages |
| Auth | Clerk |
| Payments | Gateway-agnostic billing is built; provider wiring is still pending |
| Hosting | Hostinger KVM VPS India + Cloudflare Pages |

## Critical Architecture Decisions

These affect how code is written. Get these wrong and the product breaks.

**Embeddings — app-side only (OpenAI):**
The app generates all vectors via OpenAI `text-embedding-3-small` — FastAPI embeds search queries, Celery embeds documents during ingest. Meilisearch does NOT call any external API. Each index must have `embedders.default` set to `{"source": "userProvided", "dimensions": 1536}` and the `vectorStore` experimental feature enabled. Vectors are passed as `_vectors.default` in documents and in the `vector` search param. Never configure an external embedder in Meilisearch.

**Meilisearch Python SDK is synchronous:**
Wrap all Meilisearch SDK calls with `asyncio.get_event_loop().run_in_executor(None, fn)`. Calling the SDK directly in an async FastAPI handler blocks the event loop.

**Celery on Python 3.14 — use `--pool=solo` locally:**
Python 3.14's forking model causes SIGSEGV in billiard workers. Local dev command: `celery -A workers.celery_app worker --pool=solo --loglevel=info`. On the Linux VPS, the default `--concurrency=3` prefork worker works fine.

**Celery does not auto-reload — use watchmedo locally:**
Unlike uvicorn (`--reload`), Celery reads code once at startup and holds it in memory. File changes are invisible until restart. `start.sh` wraps Celery with `watchmedo auto-restart --directory=backend/ --pattern="*.py" --recursive` so any `.py` save triggers an automatic restart. Requires `watchdog` pip package. In production on the VPS this is not needed — systemd restarts the worker on deploy. See `notes/celery_and_cache_design.md` for full explanation.

**Redis memory policy:**
DB 0 (Celery queue) must have `maxmemory-policy noeviction`. Set this in Redis config on both local and production. Never let Redis silently drop job queue messages.

**Per-client rate limiting:**
Every search request must check a Redis sliding window counter keyed on `client_id`. 1,000 req/min limit. Return 429 with `Retry-After` on breach. Enforced in Phase 3.

**Billing webhook idempotency:**
Before processing any payment-provider webhook, check if `gateway_sub_id` already exists in `subscriptions` table. If yes, return 200 without reprocessing.

**Database migrations:**
Use Alembic for all schema changes. Never run raw SQL on production. `alembic upgrade head` runs on every deploy.

**Widget CSP:**
Widget installation docs must include the CSP header line: `connect-src https://api.scubasearch.io`. Document this prominently — stores with strict CSP will silently block the widget otherwise.

---

## Folder Structure

```
scubasearch/
├── backend/          ← FastAPI app
├── frontend/         ← Next.js dashboard
├── widget/           ← Embeddable JS widget
├── notes/            ← Internal technical notes (meilisearch_working.md, etc.)
├── dev_scuba/        ← Planning docs (do not modify during build)
├── alembic/          ← DB migration files
├── alembic.ini       ← Alembic config
├── docker-compose.yml
├── CLAUDE.md
└── .env
```

## Environment

Local development uses docker-compose. All four services run locally:
- Meilisearch: localhost:7700
- Redis: localhost:6379
- PostgreSQL: localhost:5432

Production: Hostinger KVM VPS India (Meilisearch + Redis + Postgres + FastAPI + Celery, all 5 on one server, $16/month, Ubuntu 24.04) + Cloudflare Pages (Next.js). sign-in/sign-up pages use `export const runtime = 'edge'` (required by Cloudflare Pages for dynamic routes). All services communicate over localhost = zero internal latency. Deploy via SSH git pull + systemctl restart.

## Security Rules

- Never log raw API keys
- Never expose internal errors to API responses
- `client_id` always comes from the API key server-side — never from request body
- Widget endpoints (`/search`, `/search/click`, `/search/settle`) allow all CORS origins — all other endpoints allow `scubasearch.io` only
- Meilisearch master key lives in environment variables on the VPS only — never in code
- `api_keys.raw_key` is currently stored as plaintext in Postgres — acceptable pre-launch, must be replaced with Fernet encryption before first paying customer (see `notes/api_key_security.md`)
