#!/bin/bash
# ScubaSearch — start all services for local development
# Usage: ./start.sh
# Stop: Ctrl+C (kills all processes)

set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
LOGS="$ROOT/.logs"
mkdir -p "$LOGS"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${GREEN}[start]${NC} $1"; }
warn() { echo -e "${YELLOW}[warn]${NC} $1"; }
err() { echo -e "${RED}[error]${NC} $1"; }

# Track child PIDs for clean shutdown
PIDS=()
cleanup() {
  echo ""
  log "Shutting down all services..."
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null
  log "Done."
  exit 0
}
trap cleanup SIGINT SIGTERM

# ── 1. Docker (Meilisearch + Redis) ────────────────────────────────────────
log "Checking Docker services..."
if ! docker info &>/dev/null; then
  err "Docker is not running. Start Docker Desktop first."
  exit 1
fi

RUNNING=$(docker compose -f "$ROOT/docker-compose.yml" ps --services --filter "status=running" 2>/dev/null | wc -l | tr -d ' ')
if [ "$RUNNING" -lt 2 ]; then
  log "Starting Meilisearch + Redis..."
  docker compose -f "$ROOT/docker-compose.yml" up -d
else
  log "Meilisearch + Redis already running ✓"
fi

# ── 2. PostgreSQL check ─────────────────────────────────────────────────────
if ! pg_isready -h 127.0.0.1 -p 5432 -q 2>/dev/null; then
  warn "PostgreSQL not responding on 127.0.0.1:5432 — is it running?"
fi

# ── 3. FastAPI backend ──────────────────────────────────────────────────────
log "Starting FastAPI backend → http://localhost:8000"
(
  cd "$ROOT/backend"
  source "$ROOT/.venv/bin/activate"
  uvicorn main:app --reload --host 0.0.0.0 --port 8000 2>&1 | \
    sed "s/^/$(echo -e "${BLUE}[api]${NC}") /"
) > "$LOGS/api.log" 2>&1 &
PIDS+=($!)
# Also tail to terminal
tail -f "$LOGS/api.log" &
PIDS+=($!)

sleep 1

# ── 4. Celery worker (auto-reloads on .py changes via watchmedo) ────────────
log "Starting Celery worker (auto-reload enabled)"
(
  cd "$ROOT/backend"
  source "$ROOT/.venv/bin/activate"
  PYTHONPATH="$ROOT/backend" watchmedo auto-restart \
    --directory="$ROOT/backend" \
    --pattern="*.py" \
    --recursive \
    -- celery -A workers.celery_app worker --pool=solo --loglevel=info 2>&1
) > "$LOGS/celery.log" 2>&1 &
PIDS+=($!)
tail -f "$LOGS/celery.log" &
PIDS+=($!)

# ── 5. Next.js frontend ─────────────────────────────────────────────────────
log "Starting Next.js dashboard → http://localhost:3000"
(
  cd "$ROOT/frontend"
  npm run dev 2>&1
) > "$LOGS/frontend.log" 2>&1 &
PIDS+=($!)
tail -f "$LOGS/frontend.log" &
PIDS+=($!)

# ── Summary ─────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  ScubaSearch — all services starting          ${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "  API        →  ${BLUE}http://localhost:8000${NC}"
echo -e "  API docs   →  ${BLUE}http://localhost:8000/docs${NC}"
echo -e "  Dashboard  →  ${BLUE}http://localhost:3000${NC}"
echo -e "  Meilisearch→  ${BLUE}http://localhost:7700${NC}"
echo -e "  Logs       →  ${YELLOW}.logs/${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "  Press ${RED}Ctrl+C${NC} to stop everything"
echo ""

# Wait forever (cleanup runs on Ctrl+C)
wait
