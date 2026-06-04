import json
import redis.asyncio as aioredis
from config import settings

# Architecture: three separate Redis DBs
#   DB 0 — Celery job queue (noeviction policy, never evict jobs)
#   DB 1 — Search result cache (TTL 3600s, safe to evict)
#   DB 2 — API key auth cache (TTL 300s, safe to evict)

_pools: dict[int, aioredis.Redis] = {}


def _get_pool(db: int) -> aioredis.Redis:
    if db not in _pools:
        _pools[db] = aioredis.from_url(settings.redis_url, db=db, decode_responses=True)
    return _pools[db]


def get_redis(db: int = 0) -> aioredis.Redis:
    """Return a Redis client for the given DB number (0/1/2)."""
    return _get_pool(db)


async def get_cached(key: str) -> list | None:
    r = get_redis(db=1)
    val = await r.get(key)
    if val:
        return json.loads(val)
    return None


async def set_cached(key: str, data: list, ttl: int = 3600) -> None:
    r = get_redis(db=1)
    await r.set(key, json.dumps(data), ex=ttl)
