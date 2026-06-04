import logging
from fastapi import Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from services.cache import get_redis

logger = logging.getLogger(__name__)

RATE_LIMIT = 1000  # requests
WINDOW_SECONDS = 60  # sliding window duration


class RateLimitMiddleware(BaseHTTPMiddleware):
    """
    Per-client sliding window rate limiter.

    Only applies to requests that have request.state.client_id set (auth
    middleware populates this). Requests without a client_id (e.g. /health,
    unauthenticated requests that will be rejected by auth) pass through
    untouched.

    Redis key: ratelimit:{client_id}
    Strategy: INCR + EXPIRE-on-first-increment (atomic via pipeline).
    Limit: 1 000 requests per 60 seconds.
    Breach: 429 JSON + Retry-After header.
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        client_id: str | None = getattr(request.state, "client_id", None)

        if client_id is None:
            # Auth middleware has not set client_id — pass through.
            return await call_next(request)

        redis = get_redis(db=3)
        key = f"ratelimit:{client_id}"

        try:
            # Atomic pipeline: INCR then set TTL only when the key is new.
            async with redis.pipeline(transaction=True) as pipe:
                pipe.incr(key)
                pipe.ttl(key)
                count, ttl = await pipe.execute()

            if ttl == -1:
                # Key exists but has no expiry — set it now (race-safe; worst
                # case the window drifts by a few ms on the very first request).
                await redis.expire(key, WINDOW_SECONDS)
                ttl = WINDOW_SECONDS

            if count > RATE_LIMIT:
                retry_after = max(ttl, 1)
                logger.warning(
                    "rate_limit_exceeded client_id=%s count=%d retry_after=%d",
                    client_id,
                    count,
                    retry_after,
                )
                return JSONResponse(
                    status_code=429,
                    content={
                        "error": "rate_limit_exceeded",
                        "message": (
                            "Rate limit exceeded. "
                            f"{RATE_LIMIT} requests per minute allowed."
                        ),
                        "retry_after": retry_after,
                    },
                    headers={"Retry-After": str(retry_after)},
                )

        except Exception:
            # Never block a request because the rate-limit counter failed.
            # Log and let the request through — availability > strict limiting.
            logger.exception(
                "rate_limit_redis_error client_id=%s — passing request through",
                client_id,
            )

        return await call_next(request)
