#!/bin/bash
# ScubaSearch — kill everything and restart clean
# Usage: ./restart.sh

ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "Killing existing processes..."

# Kill by port
lsof -ti:8000 | xargs kill -9 2>/dev/null || true
lsof -ti:3000 | xargs kill -9 2>/dev/null || true

# Kill by name
pkill -f "uvicorn main:app" 2>/dev/null || true
pkill -f "celery.*workers.celery_app" 2>/dev/null || true
pkill -f "next dev" 2>/dev/null || true
pkill -f "next-server" 2>/dev/null || true

# Remove Next.js lock file so it doesn't complain
rm -f "$ROOT/frontend/.next/dev/lock"

sleep 1
echo "All processes stopped. Starting fresh..."
echo ""

exec "$ROOT/start.sh"
