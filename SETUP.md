# Setup Guide

This guide walks through everything needed to run ScubaSearch locally and configure it for your own project.

---

## Prerequisites

Make sure you have these installed before starting:

| Tool | Version | Notes |
|---|---|---|
| Python | 3.11+ | Used for FastAPI backend and Celery |
| Node.js | 18+ | Used for Next.js frontend |
| Docker | Any recent version | Runs Meilisearch and Redis |
| PostgreSQL | 14+ | Can run locally or via Docker |

You will also need accounts for:
- **[Clerk](https://clerk.com)** — handles authentication (free tier available)
- **[OpenAI](https://platform.openai.com)** — generates search embeddings (`text-embedding-3-small`)

---

## Step 1 — Clone and copy environment files

```bash
git clone <your-repo-url>
cd scubasearch

# Copy the backend environment template
cp .env.example .env
```

Then open `.env` and fill in your values. See [Environment variables](#environment-variables) below for what each one means.

Also create the frontend environment file:

```bash
cp frontend/.env.local.example frontend/.env.local
```

Fill in the Clerk keys in `frontend/.env.local` (same keys from your Clerk dashboard).

---

## Step 2 — Set up Python virtual environment

```bash
python3 -m venv .venv
source .venv/bin/activate        # On Windows: .venv\Scripts\activate
pip install -r backend/requirements.txt
```

---

## Step 3 — Install frontend dependencies

```bash
cd frontend
npm install
cd ..
```

---

## Step 4 — Start PostgreSQL

ScubaSearch expects PostgreSQL on `localhost:5432`. You have two options:

**Option A — Use your local PostgreSQL install:**

```bash
# Create the database
createdb scubasearch
```

**Option B — Run PostgreSQL via Docker:**

Uncomment the `postgres` block in `docker-compose.yml` (it is commented out by default), then it will start automatically with `./start.sh`.

Set your `DATABASE_URL` in `.env` accordingly (see below).

---

## Step 5 — Run database migrations

```bash
source .venv/bin/activate
cd backend
alembic upgrade head
cd ..
```

This creates all tables. Run this once on first setup, and again whenever you pull new changes.

---

## Step 6 — Start everything

```bash
./start.sh
```

This single command starts all five services:

- **Meilisearch** + **Redis** via Docker
- **FastAPI** backend on port 8000 (with auto-reload)
- **Celery** worker for background embedding jobs (with auto-reload on file changes)
- **Next.js** frontend on port 3000

Press `Ctrl+C` to stop everything cleanly.

If something is already running on port 8000 or 3000, use:

```bash
./restart.sh
```

This kills any existing processes on those ports and restarts clean.

---

## Environment variables

### Backend — `.env`

```
# ── Meilisearch ────────────────────────────────────────────────────────────
MEILISEARCH_HOST=http://localhost:7700
MEILISEARCH_MASTER_KEY=local_dev_key
```

The master key can be anything for local development. In production, use a strong random string.

---

```
# ── OpenAI ─────────────────────────────────────────────────────────────────
OPENAI_API_KEY=sk-your-key
```

Required. Get this from [platform.openai.com/api-keys](https://platform.openai.com/api-keys). ScubaSearch uses `text-embedding-3-small` — roughly $0.02 per 1M tokens.

---

```
# ── PostgreSQL ─────────────────────────────────────────────────────────────
DATABASE_URL=postgresql+asyncpg://postgres:postgres@127.0.0.1:5432/scubasearch
```

Format: `postgresql+asyncpg://USER:PASSWORD@HOST:PORT/DATABASE`

Change `USER`, `PASSWORD`, and `DATABASE` to match your local setup.

---

```
# ── Redis ──────────────────────────────────────────────────────────────────
REDIS_URL=redis://localhost:6379
```

No changes needed for local development. Redis runs via Docker.

---

```
# ── Clerk ──────────────────────────────────────────────────────────────────
CLERK_SECRET_KEY=sk_test_your_key
CLERK_PUBLISHABLE_KEY=pk_test_your_key
CLERK_JWKS_URL=https://your-clerk-instance.clerk.accounts.dev/.well-known/jwks.json
```

Create a free application at [clerk.com](https://clerk.com). All three values come from **Clerk Dashboard → API Keys**.

The JWKS URL follows the pattern: `https://<your-instance>.clerk.accounts.dev/.well-known/jwks.json`

---

```
# ── Stripe (optional) ──────────────────────────────────────────────────────
STRIPE_SECRET_KEY=sk_test_your_key
STRIPE_WEBHOOK_SECRET=whsec_your_secret
```

Only needed if you are wiring up payments. Leave blank for local development — the billing system works without a live payment gateway.

---

```
# ── Encryption / Admin ─────────────────────────────────────────────────────
DB_ENCRYPTION_KEY=your-base64-fernet-key
ADMIN_CLERK_USER_IDS=user_abc123
```

`DB_ENCRYPTION_KEY` — generate a Fernet key with:

```python
from cryptography.fernet import Fernet
print(Fernet.generate_key().decode())
```

`ADMIN_CLERK_USER_IDS` — comma-separated list of Clerk user IDs that should have admin access. Find your user ID in the Clerk dashboard under **Users**.

---

```
# ── App ────────────────────────────────────────────────────────────────────
ENVIRONMENT=development
API_BASE_URL=http://localhost:8000
ALLOWED_ORIGINS=*
```

Leave these as-is for local development.

---

### Frontend — `frontend/.env.local`

```
NEXT_PUBLIC_API_URL=http://localhost:8000

NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_your_key
CLERK_SECRET_KEY=sk_test_your_key

NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_SIGN_IN_FORCE_REDIRECT_URL=/dashboard
NEXT_PUBLIC_CLERK_SIGN_UP_FORCE_REDIRECT_URL=/onboarding
NEXT_PUBLIC_CLERK_AFTER_SIGN_OUT_URL=/
```

The Clerk keys are the same ones from your Clerk dashboard. `NEXT_PUBLIC_API_URL` must point to where your backend is running.

---

## Using it for your own project

Once running, here is the typical workflow:

1. **Sign up** at `http://localhost:3000` — this creates your account and runs through the onboarding flow.

2. **Upload your content catalog** — go to Dashboard → Documents and upload a CSV or JSON file. Required field: `title`. Optional fields: `description`, `category`, `tags`, `actors`, `director`, `year`, `language`, `image_url`, `product_url`.

3. **Get your API key** — go to Dashboard → Settings → API Keys and create a key.

4. **Embed the widget** — copy the snippet from Dashboard → Settings → Widget and paste it before `</body>` on your site:

   ```html
   <script
     src="https://your-domain/widget.js"
     data-api-key="sk_live_your_key"
     data-api-base="http://localhost:8000"
   ></script>
   ```

5. **Try search** — go to Dashboard → Try Search to test queries against your catalog before going live.

### Pushing catalog updates

Beyond file upload, you can push content programmatically:

```bash
# Push a single document
curl -X POST http://localhost:8000/api/v1/push/document \
  -H "Authorization: Bearer sk_live_your_key" \
  -H "Content-Type: application/json" \
  -d '{"title": "Inception", "category": "Sci-Fi", "year": 2010}'

# Push in bulk
curl -X POST http://localhost:8000/api/v1/push/documents \
  -H "Authorization: Bearer sk_live_your_key" \
  -H "Content-Type: application/json" \
  -d '{"mode": "append", "documents": [...]}'
```

See the API docs at `http://localhost:8000/docs` for the full reference.

---

## Production deployment

ScubaSearch is designed to run on a single Linux VPS (all services on one machine):

- FastAPI + Celery managed by `systemd`
- Meilisearch + Redis via Docker Compose
- PostgreSQL installed directly on the server
- Next.js frontend deployed to Cloudflare Pages

In production:
- Set `ENVIRONMENT=production` in `.env`
- Set `ALLOWED_ORIGINS=https://your-domain.com`
- Use a strong random `MEILISEARCH_MASTER_KEY`
- Run `alembic upgrade head` as part of your deploy script
- The Celery `--pool=solo` flag is only for local dev — on Linux the default prefork pool works fine
