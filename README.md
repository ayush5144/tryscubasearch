# ScubaSearch

**Website: [scubasearch.io](https://scubasearch.io/)**

AI-powered hybrid search for OTT and streaming platforms. Platform owners upload their content catalog, paste one JavaScript snippet, and their site gets semantic + keyword search instantly.

Built on **Meilisearch + FastAPI + Next.js**.

---

## What it does

- **Hybrid search** — BM25 keyword matching runs alongside vector semantic search on every query. "mind-bending thriller with a twist ending" surfaces the right titles even when no words match.
- **One script tag** — paste a single line of JavaScript on your platform. No framework, no rebuild required.
- **Typo tolerance** — "christofer nolan", "leonrado dicaprio" — all handled automatically.
- **Search-as-you-type** — cached responses return in under 5ms.
- **Analytics dashboard** — zero-result queries, top searches, click-through rates, and session signals.
- **Catalog management** — upload via CSV/JSON, push via REST API, or connect an external database.
- **Embeddable widget** — drop-in vanilla JS widget with dark/light theme, or use headless mode.

---

## Tech stack

| Layer | Technology |
|---|---|
| Search engine | Meilisearch (self-hosted) |
| Backend | Python 3.12 + FastAPI + Celery |
| Database | PostgreSQL |
| Cache / Queue | Redis |
| Embeddings | OpenAI `text-embedding-3-small` |
| Frontend | Next.js 14 (App Router) |
| Auth | Clerk |
| Widget | Vanilla JS (zero dependencies) |

---

## Quick start

```bash
# 1. Copy and fill in your environment variables
cp .env.example .env

# 2. Set up Python virtualenv and install dependencies
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt

# 3. Install frontend dependencies
cd frontend && npm install && cd ..

# 4. Run database migrations
source .venv/bin/activate && cd backend && alembic upgrade head && cd ..

# 5. Start everything
./start.sh
```

`start.sh` launches Meilisearch, Redis (via Docker), FastAPI, Celery, and Next.js in one command. See [SETUP.md](SETUP.md) for detailed instructions and environment variable reference.

---

## Project structure

```
scubasearch/
├── backend/          FastAPI app (search, ingest, analytics, billing, auth)
│   ├── routers/      API route handlers
│   ├── services/     Business logic (search, embedding, billing, cache)
│   ├── workers/      Celery tasks (background embedding + indexing)
│   ├── db/           SQLAlchemy models
│   └── middleware/   Auth, rate limiting, Clerk JWT
├── frontend/         Next.js dashboard (shadcn/ui + Clerk)
│   └── app/          App Router pages (dashboard, onboarding, landing)
├── widget/           Embeddable JS search widget (zero deps)
├── alembic/          Database migrations
├── notes/            Technical reference docs
├── scripts/          Utility scripts (TMDB loader, benchmarks)
├── docker-compose.yml  Meilisearch + Redis
├── .env.example      Environment variable template
├── start.sh          Start all services for local dev
└── restart.sh        Kill all services and restart clean
```

---

## Services

Once running, the following are available locally:

| Service | URL |
|---|---|
| Dashboard | http://localhost:3000 |
| API | http://localhost:8000 |
| API docs (Swagger) | http://localhost:8000/docs |
| Meilisearch | http://localhost:7700 |

---

## Detailed setup

See **[SETUP.md](SETUP.md)** for step-by-step instructions including prerequisites, environment variable explanations, and how to configure it for your own project.
