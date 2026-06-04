import asyncio
import logging
import time
import uuid
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import text as sa_text

from services.embedding import embed, cache_key
from services.cache import get_cached, set_cached
from services.meilisearch import hybrid_search
from services.billing import (
    check_session_limit,
    increment_query_count,
    increment_session_count,
    reset_counts_if_needed,
)
from services.intent import extract_intents
from db.postgres import AsyncSessionLocal

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/search", tags=["search"])


class SearchRequest(BaseModel):
    query: str
    limit: int = 10
    semantic_ratio: float = 0.5


class ClickRequest(BaseModel):
    product_id: str
    search_log_id: str | None = (
        None  # optional: links click back to the originating search
    )


class QuerySnapshot(BaseModel):
    value: str
    timestamp: int


class QueryMeta(BaseModel):
    result_count: int | None = None
    cache_hit: bool | None = None
    response_ms: int | None = None


class SettleRequest(BaseModel):
    log_id: str | None = None  # UUID of the final/click row — optional
    session_id: str | None = None  # widget sessionStorage ID — groups session rows
    queries: list[QuerySnapshot] = []  # executed search queries for this session
    query_meta: dict[str, QueryMeta] = {}
    signal: str = "idle"  # "idle"|"enter"|"click"|"visibilitychange"
    engagement: bool = False  # true if result hover / scroll / click happened during session
async def _log_click(search_log_id: str) -> None:
    """Fire-and-forget: mark the originating search log row as clicked and settled."""
    try:
        from sqlalchemy import update
        from db.models import SearchLog as SL

        async with AsyncSessionLocal() as session:
            await session.execute(
                update(SL)
                .where(SL.id == uuid.UUID(search_log_id))
                .values(clicked=True, settled=True)
            )
            await session.commit()
    except Exception:
        logger.exception("click_log_write_error search_log_id=%s", search_log_id)


@router.post("")
async def search(req: SearchRequest, request: Request):
    if not req.query or len(req.query.strip()) < 2:
        return {"results": [], "cache_hit": False, "total": 0, "processing_time_ms": 0}

    # client_id is always derived from the API key by auth middleware — never
    # trusted from the request body (security boundary for multi-tenancy).
    client_id: str = request.state.client_id

    # Bug 1 fix: timer starts immediately after extracting client_id so
    # processing_time_ms reflects true end-to-end latency.
    t0 = time.monotonic()
    log_id = uuid.uuid4()

    # Plan enforcement — reset window first (idempotent, fire-and-forget).
    asyncio.create_task(reset_counts_if_needed(client_id))

    # Bug 2 fix: check cache BEFORE plan limit check.  Cache hits skip the
    # (relatively expensive) DB round-trip in check_session_limit.
    key = cache_key(client_id, req.query, req.limit, req.semantic_ratio)
    cached = await get_cached(key)
    t_cache = time.monotonic()

    if cached is not None:
        elapsed_ms = int((time.monotonic() - t0) * 1000)
        # Count cached hits against the monthly quota too (fire-and-forget)
        asyncio.create_task(increment_query_count(client_id))
        logger.debug(
            "search_timing client=%s cache_hit=true cache=%dms total=%dms",
            client_id,
            int((t_cache - t0) * 1000),
            elapsed_ms,
        )
        return {
            "results": cached,
            "total": len(cached),
            "cache_hit": True,
            "processing_time_ms": elapsed_ms,
            "log_id": str(log_id),
        }

    # Cache miss — enforce plan limit before doing expensive work.
    # Bug 3 fix: check_session_limit now uses a single DB query internally.
    ok, used, limit = await check_session_limit(client_id)
    t_billing = time.monotonic()
    if not ok:
        from services.billing import get_usage

        usage = await get_usage(client_id)
        raise HTTPException(
            status_code=402,
            detail={
                "error": "session_limit_exceeded",
                "message": "Monthly session limit reached. Upgrade to continue.",
                "used": used,
                "limit": limit,
                "reset_at": usage.get("reset_at"),
            },
        )

    vector = await embed(req.query) if req.semantic_ratio > 0 else None
    t_embed = time.monotonic()

    results = await hybrid_search(
        client_id, req.query, vector, req.limit, req.semantic_ratio
    )
    t_search = time.monotonic()

    # Bug 4 fix: fire-and-forget the cache write — no need to block the
    # response on a Redis SET.
    asyncio.create_task(set_cached(key, results))

    elapsed_ms = int((t_search - t0) * 1000)
    asyncio.create_task(increment_query_count(client_id))

    logger.debug(
        "search_timing client=%s cache=%dms billing=%dms embed=%dms meili=%dms total=%dms",
        client_id,
        int((t_cache - t0) * 1000),
        int((t_billing - t_cache) * 1000),
        int((t_embed - t_billing) * 1000),
        int((t_search - t_embed) * 1000),
        int((t_search - t0) * 1000),
    )

    return {
        "results": results,
        "total": len(results),
        "cache_hit": False,
        "processing_time_ms": elapsed_ms,
        "log_id": str(log_id),
    }


@router.post("/click")
async def click(req: ClickRequest, request: Request):
    if req.search_log_id:
        asyncio.create_task(_log_click(req.search_log_id))
    return {"ok": True}


@router.post("/settle")
async def settle(req: SettleRequest, request: Request):
    """Settle search intent signals from the widget session buffer.

    Accepts an array of executed search snapshots captured during a session.
    Only the final meaningful query for that session is persisted in
    analytics. No intermediate prefixes, pauses, or typing fragments are
    logged.

    Also updates the final/click row identified by log_id when provided.

    Called as fire-and-forget from the widget — always returns 200 so the
    widget never retries and generates noise.
    """
    client_id: str = request.state.client_id

    # --- Validate log_id if provided ---
    log_uuid: uuid.UUID | None = None
    if req.log_id is not None:
        try:
            log_uuid = uuid.UUID(req.log_id)
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail={
                    "error": "invalid_log_id",
                    "message": "log_id must be a valid UUID.",
                },
            )

    # --- Extract the final settled intent query for this session ---
    intent_queries = extract_intents([s.dict() for s in req.queries])
    final_query = req.queries[-1].value if req.queries else None

    settled_count = 0

    try:
        from sqlalchemy import update, select
        from db.models import SearchLog as SL

        rows_written = 0  # Track whether any rows were actually inserted/updated

        async with AsyncSessionLocal() as session:
            # --- Upsert the single settled intent row for this session ---
            for intent_query in intent_queries:
                # Only persist the final executed query. If metadata is
                # missing for some reason, still allow the final query through
                # as a ghost row rather than backfilling intermediate text.
                if req.query_meta and intent_query not in req.query_meta:
                    if final_query != intent_query:
                        continue

                meta = req.query_meta.get(intent_query)
                meta_result_count = (
                    meta.result_count if meta and meta.result_count is not None else -1
                )
                meta_cache_hit = (
                    bool(meta.cache_hit)
                    if meta and meta.cache_hit is not None
                    else False
                )
                meta_response_ms = (
                    meta.response_ms if meta and meta.response_ms is not None else None
                )

                is_click_signal = req.signal == "click"
                is_enter_signal = req.signal == "enter"
                is_final_intent = final_query == intent_query

                # Dedup: skip if this (session_id, query) is already settled.
                # Guards against duplicate settles from the same session (e.g.
                # idle fires, user types same query again, idle fires again).
                if req.session_id:
                    already = await session.execute(
                        select(SL.id)
                        .where(
                            SL.client_id == uuid.UUID(client_id),
                            SL.query == intent_query,
                            SL.session_id == req.session_id,
                            SL.settled == True,  # noqa: E712
                        )
                        .limit(1)
                    )
                    already_row = already.fetchone()
                    if already_row:
                        # If a later terminal action arrives (click/enter),
                        # upgrade the existing settled row instead of skipping.
                        upgrade_vals: dict = {}
                        if is_click_signal and is_final_intent:
                            upgrade_vals["clicked"] = True
                            upgrade_vals["signal"] = "click"
                        if is_enter_signal and is_final_intent:
                            upgrade_vals["searched"] = True
                            upgrade_vals["signal"] = "enter"
                        if req.engagement:
                            upgrade_vals["engagement"] = True
                        if meta_result_count >= 0:
                            upgrade_vals["result_count"] = meta_result_count
                        if meta and meta.cache_hit is not None:
                            upgrade_vals["cache_hit"] = meta_cache_hit
                        if meta_response_ms is not None:
                            upgrade_vals["response_ms"] = meta_response_ms

                        if upgrade_vals:
                            await session.execute(
                                update(SL)
                                .where(SL.id == already_row.id)
                                .values(**upgrade_vals)
                            )
                            rows_written += 1
                        continue  # already recorded for this session

                # Look for an unsettled row from this client in the last 10
                # minutes that matches the intent query.
                existing = await session.execute(
                    select(SL.id)
                    .where(
                        SL.client_id == uuid.UUID(client_id),
                        SL.query == intent_query,
                        SL.settled == False,  # noqa: E712
                        sa_text(
                            "search_logs.created_at >= NOW() - INTERVAL '10 minutes'"
                        ),
                    )
                    .limit(1)
                )
                existing_row = existing.fetchone()

                if existing_row:
                    # Mark the existing unsettled row as settled.
                    # Propagate clicked/searched flags from the signal so
                    # all intent queries in a click session are marked as
                    # clicked — not just the final log_id row.
                    intent_vals: dict = {
                        "settled": True,
                        "engagement": req.engagement,
                        "session_id": req.session_id,
                        "signal": req.signal,
                    }
                    if meta_result_count >= 0:
                        intent_vals["result_count"] = meta_result_count
                    if meta and meta.cache_hit is not None:
                        intent_vals["cache_hit"] = meta_cache_hit
                    if meta_response_ms is not None:
                        intent_vals["response_ms"] = meta_response_ms
                    if is_click_signal and is_final_intent:
                        intent_vals["clicked"] = True
                    if is_enter_signal and is_final_intent:
                        intent_vals["searched"] = True
                    await session.execute(
                        update(SL).where(SL.id == existing_row.id).values(**intent_vals)
                    )
                    rows_written += 1
                else:
                    # No matching unsettled row — this was a ghost query
                    # (refined away before the idle timer fired).
                    # Skip ghost insert if a settled row with real results
                    # already exists for this (session, query) — guards against
                    # concurrent settle races creating duplicates.
                    if req.session_id:
                        real_exists = await session.execute(
                            select(SL.id)
                            .where(
                                SL.client_id == uuid.UUID(client_id),
                                SL.query == intent_query,
                                SL.session_id == req.session_id,
                                SL.settled == True,  # noqa: E712
                                SL.result_count >= 0,
                            )
                            .limit(1)
                        )
                        if real_exists.fetchone():
                            continue
                    session.add(
                        SL(
                            id=uuid.uuid4(),
                            client_id=uuid.UUID(client_id),
                            query=intent_query,
                            result_count=meta_result_count,
                            cache_hit=meta_cache_hit,
                            response_ms=meta_response_ms,
                            clicked=(is_click_signal and is_final_intent),
                            settled=True,
                            searched=(is_enter_signal and is_final_intent),
                            engagement=req.engagement,
                            session_id=req.session_id,
                            signal=req.signal,
                        )
                    )
                    rows_written += 1

            # --- Update the final/click row if log_id was provided ---
            if log_uuid is not None:
                is_click = req.signal == "click"
                is_enter = req.signal == "enter"
                # Only set boolean flags to True — never overwrite True→False.
                # A late visibilitychange settle (fired during navigation after a
                # click) must not clobber clicked=True or engagement=True that
                # were set by the click/hover settle that preceded it.
                update_vals: dict = {
                    "settled": True,
                    "session_id": req.session_id,
                    "signal": req.signal,
                }
                if is_click:
                    update_vals["clicked"] = True
                if is_enter:
                    update_vals["searched"] = True
                if req.engagement:
                    update_vals["engagement"] = True
                await session.execute(
                    update(SL)
                    .where(
                        SL.id == log_uuid,
                        SL.client_id == uuid.UUID(client_id),
                    )
                    .values(**update_vals)
                )

            await session.commit()
            settled_count = rows_written

        # Increment session counter only if we actually wrote rows (not all deduped)
        if rows_written > 0:
            asyncio.create_task(increment_session_count(client_id))

    except Exception:
        logger.exception(
            "settle_log_write_error log_id=%s client_id=%s signal=%s",
            req.log_id,
            client_id,
            req.signal,
        )
        # Non-fatal — widget fire-and-forget; still return count so the
        # widget does not retry and generate noise.

    return {"settled": settled_count}
