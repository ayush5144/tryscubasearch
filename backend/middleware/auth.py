"""
API key authentication middleware.

Flow:
1. Extract Bearer token from Authorization header.
2. Hash key immediately — raw key is never logged or stored.
3. Check Redis DB 2 cache (apikey:{hash}, TTL 5 min).
4. On miss: query Postgres api_keys join clients.
5. Set request.state.client_id as string UUID.
6. Unprotected routes (/health, /docs, /openapi.json) bypass auth entirely.

Security rules enforced:
- client_id is always derived server-side from the API key — never from the request body.
- Raw keys are never logged.
- Internal errors never leak to API responses.
"""

import logging

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from db.postgres import AsyncSessionLocal, get_client_by_key_hash
from services.auth import hash_key
from services.cache import get_redis

logger = logging.getLogger(__name__)

# Routes that skip API-key auth entirely.
# Exact paths and prefix-based bypass sets are checked separately below.
UNPROTECTED_PATHS = {
    "/health",
    "/docs",
    "/openapi.json",
    "/api/v1/billing/webhook",
}

# Dashboard routes authenticate via Clerk JWT (require_clerk_user dependency)
# rather than a widget API key.  The API key middleware must not intercept them.
CLERK_AUTH_PREFIXES = (
    "/api/v1/api-sync",
    "/api/v1/me",
    "/api/v1/analytics",
    "/api/v1/ingest",
    "/api/v1/billing",
    "/api/v1/documents",
    "/api/v1/admin",
    "/api/v1/database",
)

# Redis DB 2 is the API key lookup cache (TTL 5 min).
# We use key prefix "apikey:" and store the client UUID as a plain string.
API_KEY_CACHE_TTL = 300  # seconds


class APIKeyMiddleware(BaseHTTPMiddleware):
    """
    Authenticate every protected request via a Bearer API key.

    Sets ``request.state.client_id`` (str UUID) on success.
    Returns 401 JSON on missing, malformed, or invalid keys.
    """

    async def dispatch(self, request: Request, call_next):
        # Always allow unprotected routes through.
        if request.url.path in UNPROTECTED_PATHS:
            return await call_next(request)

        # Dashboard routes use Clerk JWT auth at the route level — skip here.
        if request.url.path.startswith(CLERK_AUTH_PREFIXES):
            return await call_next(request)

        # Let CORS preflight requests pass — the CORSMiddleware handles them.
        if request.method == "OPTIONS":
            return await call_next(request)

        # --- Extract Bearer token ---
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return self._unauthorized(
                "Valid API key required. Pass as Authorization: Bearer <key>"
            )

        raw_key = auth_header[len("Bearer ") :]
        if not raw_key:
            return self._unauthorized(
                "Valid API key required. Pass as Authorization: Bearer <key>"
            )

        # --- Hash immediately — never log raw key ---
        key_hash = hash_key(raw_key)

        # --- Redis cache check (DB 2) ---
        client_id: str | None = None
        redis = get_redis(db=2)
        cache_redis_key = f"apikey:{key_hash}"

        try:
            cached = await redis.get(cache_redis_key)
            if cached:
                client_id = cached
        except Exception:
            logger.exception("auth_redis_error — falling through to Postgres")

        # --- Postgres lookup on cache miss ---
        if client_id is None:
            try:
                async with AsyncSessionLocal() as session:
                    client = await get_client_by_key_hash(session, key_hash)

                if client is None:
                    return self._unauthorized(
                        "API key not found or revoked. Generate a new key from your dashboard."
                    )

                client_id = str(client.id)

                # Populate cache for future requests.
                try:
                    await redis.set(cache_redis_key, client_id, ex=API_KEY_CACHE_TTL)
                except Exception:
                    logger.exception(
                        "auth_cache_write_error client_id=%s — continuing without cache",
                        client_id,
                    )

            except Exception:
                logger.exception("auth_postgres_error — returning 401")
                return self._unauthorized(
                    "Authentication service unavailable. Please retry."
                )

        # --- Attach to request state ---
        request.state.client_id = client_id
        return await call_next(request)

    @staticmethod
    def _unauthorized(message: str) -> JSONResponse:
        return JSONResponse(
            status_code=401,
            content={
                "error": "unauthorized",
                "message": message,
            },
            headers={"Access-Control-Allow-Origin": "*"},
        )
