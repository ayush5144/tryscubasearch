# DNS & api.scubasearch.io — Why It Exists

## What it is

`api.scubasearch.io` is the public URL for the FastAPI backend.

## Why it is needed

The widget (widget.js) is embedded on a store owner's website and runs in their visitors' browsers. Those browsers make HTTP requests to the backend for every search. In production that backend must be reachable from the public internet — `localhost:8000` only works on your dev machine.

Every search request from every store visitor flows through this URL:

```
Store visitor browser → https://api.scubasearch.io → VPS (FastAPI :8000) → Meilisearch
```

Without this subdomain, the widget is non-functional outside of local development.

## What IP it points to

The A record must point to the **public IP of the VPS** running FastAPI + Meilisearch + Redis + Postgres. This is the Hostinger KVM VPS (or DigitalOcean equivalent) provisioned in Phase 7.

You do not have this IP yet — it is assigned when you create the VPS.

## When to do it

Phase 7 (Deploy). Steps in order:

1. Provision VPS → get public IP
2. Create A record: `api` → `<VPS_IP>` in Cloudflare DNS (Zone ID: `0bebb1276551fe13b2ce51a687bcd1bf`, account: `ayush5501@protonmail.com`)
3. SSH into VPS, install Nginx, point port 443 → FastAPI :8000
4. SSL is handled by Cloudflare (proxied: true) — no Let's Encrypt needed
5. Set `API_BASE_URL=https://api.scubasearch.io` in VPS .env
6. Set `NEXT_PUBLIC_API_URL=https://api.scubasearch.io` in Cloudflare Pages env vars

## The curl command (ready to run when VPS IP is known)

```bash
curl -s -X POST "https://api.cloudflare.com/client/v4/zones/<YOUR_ZONE_ID>/dns_records" \
  -H "X-Auth-Email: your@email.com" \
  -H "X-Auth-Key: <YOUR_CF_API_KEY>" \
  -H "Content-Type: application/json" \
  --data '{"type":"A","name":"api","content":"<VPS_IP>","proxied":true,"ttl":1}'
```
