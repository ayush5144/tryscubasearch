# ScubaSearch — Infrastructure Architecture Decisions

*March 2026 — based on pre-launch infra review*

---

## Decided Architecture

### VPS — Hostinger KVM2 (or equivalent)
- **Spec:** 2 vCPU, 8GB RAM, 100GB NVMe SSD
- **Cost:** ~$16/month
- **Region:** India (51ms latency to Indian users — acceptable)
- **OS:** Ubuntu 24.04 LTS
- **Runs:** Meilisearch + Redis + Postgres + FastAPI + Celery (all 5 processes on one server)

### Frontend — Vercel
- Next.js dashboard
- Free tier, auto-deploys from GitHub
- Cost: $0

### Total infra cost: ~$16/month
Break even: 1 customer on Starter ($29/month).

### Alternative: GCP launch with $300 free credits
New GCP accounts get $300 credits valid for 90 days. Equivalent VM in GCP Mumbai (asia-south1): e2-standard-2 (2 vCPU, 8GB) ~$49/month + 100GB SSD disk ~$17/month = ~$66/month after credits expire. Credits cover everything for 90 days (~$0 to launch). After 90 days, switch to Hostinger at $16/month. Viable if you want to launch immediately without paying anything upfront.

---

## Why Not Other Options

### Why not per-client VPS
One droplet per client = $6-16/month per client. At 100 clients that's $600-1600/month in servers vs $29/month revenue per client. Instant loss. Meilisearch multi-tenancy (one index per client, `products_{client_id}`) handles isolation correctly on a single server.

### Why not DigitalOcean
DO Bangalore (BLR1) max droplet is 4GB — insufficient. DO Mumbai (MUM1) equivalent is $56/month vs Hostinger's $16/month for same specs.

### Why not GCP
$300 free credits are useful for launch (90 days free), but after that ~$55-76/month (Compute Engine + separate SSD disk pricing). More expensive than Hostinger long-term. Cloud Run is viable for FastAPI but Celery workers need always-on instances anyway.

### Why not Railway/Render for the whole stack
Can't run Meilisearch reliably — needs persistent disk, restarts risk wiping indexes.

### Why not pgvector instead of Meilisearch
Would require building BM25 + hybrid ranking + typo tolerance + attribute weighting from scratch. Meilisearch is MIT licensed and self-hosted — it costs $0. The "Meilisearch cost" doesn't exist. pgvector gives you vector similarity search only; the gap in search quality for ecommerce would be visible to store owners.

### Why not remove Redis
Redis does three things that can't be cheaply replaced:
1. Search cache (DB1) — cache hit = <10ms, no OpenAI call. Without it every search costs ~800ms + embedding money.
2. Celery job queue (DB0) — the entire ingest pipeline. Not optional.
3. API key cache (DB2) — avoids Postgres hit on every search request.

Redis uses ~200MB RAM on the VPS. It's already included in the $16/month. Nothing to save.

---

## Process Layout on the VPS

Five systemd services on one server:

```
systemd service 1: meilisearch      (port 7700, data at /var/lib/meilisearch/)
systemd service 2: redis-server     (port 6379, AOF persistence enabled)
systemd service 3: postgresql       (port 5432)
systemd service 4: uvicorn          (FastAPI, port 8000)
systemd service 5: celery worker    (--concurrency=3, reads from Redis DB0)
```

FastAPI and Celery are processes only — they use ~200-300MB RAM combined and write nothing to disk during normal operation.

---

## Why FastAPI and Celery Are Separate Processes

FastAPI handles real-time HTTP requests (search, dashboard, webhooks) — needs millisecond response times.

Celery handles slow background jobs (embedding 1000 products, Shopify bulk sync, reindex) — takes seconds to minutes.

When a store owner uploads a CSV, FastAPI receives it, drops a job into Redis, and returns `{ job_id, status: "queued" }` in under a second. Celery picks it up and does the heavy lifting. If embedding ran inside FastAPI directly, the HTTP request would time out and the store owner would have no idea if it worked.

---

## Redis Persistence — Critical Config

Redis DB0 (Celery job queue) must survive restarts. Set in `/etc/redis/redis.conf`:

```
appendonly yes
```

This enables AOF (append-only file) — every write is logged to disk. On restart Redis replays the log and recovers the job queue. Without this, a Redis restart mid-ingest silently drops the job — store owner's products never get indexed, no error shown.

Cache DBs (1, 2, 3) are fine to lose on restart — they rebuild themselves from TTL-based traffic within minutes.

---

## RAM Budget (8GB VPS)

| Service | Estimated RAM |
|---|---|
| Meilisearch (with vectors) | ~2.5GB |
| Postgres | ~512MB |
| Redis | ~200MB |
| FastAPI (uvicorn) | ~150MB |
| Celery worker | ~150MB |
| OS + headroom | ~1GB |
| **Total** | **~4.5GB** |

3.5GB headroom. Comfortable to ~300-400 clients before needing a RAM upgrade.

---

## Scaling Path

| Clients | Action |
|---|---|
| 0-300 | Single $16/month Hostinger VPS, everything co-located |
| 300-600 | Upgrade VPS to 16GB RAM (~$32/month Hostinger) |
| 600+ | Second VPS, shard clients across two Meilisearch instances |

At $29/month Starter plan, 300 clients = $8,700/month revenue on $16/month infra. The infra cost is never the constraint.
