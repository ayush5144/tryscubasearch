"""
Analytics endpoints for the dashboard.

All routes require a valid Clerk JWT via require_clerk_user.
All queries are scoped to the authenticated user's client_id.

Routes:
  GET /api/v1/analytics/summary      — aggregate stats
  GET /api/v1/analytics/top-queries  — most-searched terms
  GET /api/v1/analytics/zero-results — queries that returned nothing
"""

import asyncio
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy import text as sql_text

from db.postgres import AsyncSessionLocal
from middleware.clerk_auth import require_clerk_user
from services.billing import get_plan
from services.meilisearch import get_client as get_meili_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/analytics", tags=["analytics"])


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------


class AnalyticsSummary(BaseModel):
    total_searches: int
    zero_result_rate: float
    zero_result_count: int
    ctr: float | None
    days_window: int
    total_products: int
    clicked_count: int
    searched_count: int
    browsed_count: int
    abandoned_count: int
    total_sessions: int


class TopQueryItem(BaseModel):
    query: str
    count: int
    avg_results: float


class ZeroResultItem(BaseModel):
    query: str
    count: int
    last_seen: str


class QueryLogItem(BaseModel):
    query: str
    intent: str  # "clicked" | "searched" | "searched_browsed" | "browsed" | "abandoned"
    signal: str | None = (
        None  # "idle" | "hover" | "scroll" | "enter" | "click" | "visibilitychange"
    )
    result_count: int | None  # None = ghost query (results unknown)
    searched_at: str  # ISO datetime string
    session_id: str | None = None  # groups rows from the same widget session


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _require_client_id(request: Request) -> str:
    """Return request.state.client_id, raising 403 if not set."""
    client_id: str | None = getattr(request.state, "client_id", None)
    if client_id is None:
        raise HTTPException(
            status_code=403,
            detail={
                "error": "account_not_found",
                "message": "No account found for this user. Call POST /api/v1/me first.",
            },
        )
    return client_id


def _date_filter_sql(
    from_date: str | None,
    to_date: str | None,
    plan_window: int,
) -> tuple[str, dict]:
    """Return a SQL WHERE fragment and params for date filtering.

    Uses NOW() in SQL (IST-aware) so comparisons are consistent with
    IST-stored created_at values. When user provides dates, uses
    CAST(:date AS DATE) which PostgreSQL interprets in IST.
    """
    params: dict = {}

    if from_date:
        from_sql = "created_at >= CAST(:from_date AS DATE)"
        params["from_date"] = from_date
    else:
        from_sql = "created_at >= NOW() - (INTERVAL '1 day' * :days_window)"
        params["days_window"] = plan_window

    if to_date:
        to_sql = "created_at < CAST(:to_date AS DATE) + INTERVAL '1 day'"
        params["to_date"] = to_date
    else:
        to_sql = "created_at <= NOW()"

    return f"{from_sql} AND {to_sql}", params


async def _get_analytics_tier(client_id: str) -> tuple[str, int]:
    """Returns (plan, days_window). All plans get 30 days."""
    plan_info = await get_plan(client_id)
    plan = plan_info["plan"]
    return (plan, 30)


async def _get_index_doc_count(client_id: str) -> int:
    """Return total document count from Meilisearch for this client's index.

    Uses run_in_executor because the Meilisearch SDK is synchronous.
    Returns 0 on any error (index may not exist yet).
    """

    def _fetch():
        meili = get_meili_client()
        index = meili.index(f"products_{client_id}")
        stats = index.get_stats()
        return stats.number_of_documents

    try:
        loop = asyncio.get_event_loop()
        count = await loop.run_in_executor(None, _fetch)
        return count
    except Exception:
        logger.exception("analytics_meili_stats_error client_id=%s", client_id)
        return 0


# ---------------------------------------------------------------------------
# GET /api/v1/analytics/summary
# ---------------------------------------------------------------------------


@router.get("/summary")
async def get_summary(
    request: Request,
    clerk_user_id: str = Depends(require_clerk_user),
) -> AnalyticsSummary:
    """Return aggregate search statistics for the authenticated client."""
    client_id = _require_client_id(request)
    plan, days_window = await _get_analytics_tier(client_id)

    try:
        async with AsyncSessionLocal() as session:
            row_total = await session.execute(
                sql_text(
                    "SELECT COUNT(*) AS cnt FROM search_logs WHERE client_id = :cid AND created_at >= NOW() - (INTERVAL '1 day' * :days) AND settled = true AND response_ms IS NOT NULL"
                ),
                {"cid": uuid.UUID(client_id), "days": days_window},
            )
            total_searches: int = row_total.scalar_one() or 0

            row_zero = await session.execute(
                sql_text(
                    """
                    SELECT
                        COUNT(*) FILTER (WHERE result_count = 0) AS zero_count,
                        COUNT(*) AS total_count
                    FROM search_logs
                    WHERE client_id = :cid
                      AND created_at >= NOW() - (INTERVAL '1 day' * :days)
                      AND settled = true
                      AND response_ms IS NOT NULL
                    """
                ),
                {"cid": uuid.UUID(client_id), "days": days_window},
            )
            zero_row = row_zero.fetchone()
            zero_count = zero_row.zero_count or 0
            total_count = zero_row.total_count or 0
            zero_result_rate = (zero_count / total_count) if total_count > 0 else 0.0

            # --- Intent breakdown counts (exclude ghost rows) ---
            row_intents = await session.execute(
                sql_text(
                    """
                    SELECT
                        COUNT(*) FILTER (WHERE clicked = true)  AS clicked_count,
                        COUNT(*) FILTER (WHERE searched = true AND clicked = false) AS searched_count,
                        COUNT(*) FILTER (
                            WHERE clicked = false
                              AND searched = false
                              AND engagement = true
                        ) AS browsed_count,
                        COUNT(*) FILTER (
                            WHERE clicked = false
                              AND searched = false
                              AND engagement = false
                        ) AS abandoned_count
                    FROM search_logs
                    WHERE client_id = :cid
                      AND created_at >= NOW() - (INTERVAL '1 day' * :days)
                      AND settled = true
                      AND response_ms IS NOT NULL
                    """
                ),
                {"cid": uuid.UUID(client_id), "days": days_window},
            )
            intent_row = row_intents.fetchone()
            clicked_count_int: int = intent_row.clicked_count or 0
            searched_count_int: int = intent_row.searched_count or 0
            browsed_count_int: int = intent_row.browsed_count or 0
            abandoned_count_int: int = intent_row.abandoned_count or 0

            row_ctr = await session.execute(
                sql_text(
                    """
                    SELECT
                        COUNT(*) FILTER (WHERE clicked = true) AS clicked_count,
                        COUNT(*) AS total_count
                    FROM search_logs
                    WHERE client_id = :cid
                      AND created_at >= NOW() - (INTERVAL '1 day' * :days)
                      AND settled = true
                      AND response_ms IS NOT NULL
                    """
                ),
                {"cid": uuid.UUID(client_id), "days": days_window},
            )
            ctr_row = row_ctr.fetchone()
            clicked_count = ctr_row.clicked_count or 0
            ctr_total = ctr_row.total_count or 0
            ctr: float | None = (clicked_count / ctr_total) if ctr_total > 0 else 0.0

    except Exception:
        logger.exception("analytics_summary_error client_id=%s", client_id)
        raise HTTPException(
            status_code=500,
            detail={
                "error": "server_error",
                "message": "Could not retrieve analytics. Please retry.",
            },
        )

    total_products = await _get_index_doc_count(client_id)

    from services.billing import get_usage

    usage = await get_usage(client_id)
    total_sessions = usage["sessions_this_month"]

    return AnalyticsSummary(
        total_searches=total_searches,
        zero_result_rate=round(zero_result_rate, 4),
        zero_result_count=int(zero_count),
        ctr=round(ctr, 4) if ctr is not None else None,
        days_window=days_window,
        total_products=total_products,
        clicked_count=clicked_count_int,
        searched_count=searched_count_int,
        browsed_count=browsed_count_int,
        abandoned_count=abandoned_count_int,
        total_sessions=total_sessions,
    )


# ---------------------------------------------------------------------------
# GET /api/v1/analytics/top-queries
# ---------------------------------------------------------------------------


@router.get("/top-queries")
async def get_top_queries(
    request: Request,
    limit: int = Query(default=10, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    from_date: str | None = Query(default=None),
    to_date: str | None = Query(default=None),
    clerk_user_id: str = Depends(require_clerk_user),
) -> list[TopQueryItem]:
    """Return most-searched queries with result counts, scoped to this client."""
    client_id = _require_client_id(request)
    _plan, days_window = await _get_analytics_tier(client_id)
    date_fragment, date_params = _date_filter_sql(from_date, to_date, days_window)

    try:
        async with AsyncSessionLocal() as session:
            result = await session.execute(
                sql_text(
                    f"""
                    SELECT
                        query,
                        COUNT(*) AS count,
                        AVG(result_count) AS avg_results
                    FROM search_logs
                    WHERE client_id = :cid
                      AND result_count > 0
                      AND {date_fragment}
                      AND settled = true
                    GROUP BY query
                    ORDER BY count DESC
                    LIMIT :lim OFFSET :off
                    """
                ),
                {
                    "cid": uuid.UUID(client_id),
                    "lim": limit,
                    "off": offset,
                    **date_params,
                },
            )
            rows = result.fetchall()
    except Exception:
        logger.exception("analytics_top_queries_error client_id=%s", client_id)
        raise HTTPException(
            status_code=500,
            detail={
                "error": "server_error",
                "message": "Could not retrieve top queries. Please retry.",
            },
        )

    return [
        TopQueryItem(
            query=row.query,
            count=int(row.count),
            avg_results=round(float(row.avg_results), 2),
        )
        for row in rows
    ]


# ---------------------------------------------------------------------------
# GET /api/v1/analytics/zero-results
# ---------------------------------------------------------------------------


@router.get("/zero-results")
async def get_zero_results(
    request: Request,
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    from_date: str | None = Query(default=None),
    to_date: str | None = Query(default=None),
    clerk_user_id: str = Depends(require_clerk_user),
) -> list[ZeroResultItem]:
    """Return queries that returned zero results, grouped and sorted by frequency."""
    client_id = _require_client_id(request)
    _plan, days_window = await _get_analytics_tier(client_id)
    date_fragment, date_params = _date_filter_sql(from_date, to_date, days_window)

    try:
        async with AsyncSessionLocal() as session:
            result = await session.execute(
                sql_text(
                    f"""
                    SELECT
                        query,
                        COUNT(*) AS count,
                        MAX(created_at) AS last_seen
                    FROM search_logs
                    WHERE client_id = :cid
                      AND result_count = 0
                      AND response_ms IS NOT NULL
                      AND {date_fragment}
                      AND settled = true
                    GROUP BY query
                    ORDER BY count DESC
                    LIMIT :lim OFFSET :off
                    """
                ),
                {
                    "cid": uuid.UUID(client_id),
                    "lim": limit,
                    "off": offset,
                    **date_params,
                },
            )
            rows = result.fetchall()
    except Exception:
        logger.exception("analytics_zero_results_error client_id=%s", client_id)
        raise HTTPException(
            status_code=500,
            detail={
                "error": "server_error",
                "message": "Could not retrieve zero-result queries. Please retry.",
            },
        )

    return [
        ZeroResultItem(
            query=row.query,
            count=int(row.count),
            last_seen=row.last_seen.isoformat() if row.last_seen else "",
        )
        for row in rows
    ]


# ---------------------------------------------------------------------------
# GET /api/v1/analytics/query-log
# ---------------------------------------------------------------------------


@router.get("/query-log")
async def get_query_log(
    request: Request,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    from_date: str | None = Query(default=None),
    to_date: str | None = Query(default=None),
    clerk_user_id: str = Depends(require_clerk_user),
) -> list[QueryLogItem]:
    """Return a chronological log of settled search queries with derived intent."""
    client_id = _require_client_id(request)
    _plan, days_window = await _get_analytics_tier(client_id)
    date_fragment, date_params = _date_filter_sql(from_date, to_date, days_window)

    try:
        async with AsyncSessionLocal() as session:
            result = await session.execute(
                sql_text(
                    f"""
                    SELECT
                        query,
                        CASE
                            WHEN clicked = true THEN 'clicked'
                            WHEN searched = true AND engagement = true THEN 'searched_browsed'
                            WHEN searched = true THEN 'searched'
                            WHEN engagement = false THEN 'abandoned'
                            ELSE 'browsed'
                        END AS intent,
                        signal,
                        result_count,
                        created_at AS searched_at,
                        session_id
                    FROM search_logs
                    WHERE client_id = :cid
                      AND settled = true
                      AND response_ms IS NOT NULL
                      AND {date_fragment}
                    ORDER BY created_at DESC
                    LIMIT :lim OFFSET :off
                    """
                ),
                {
                    "cid": uuid.UUID(client_id),
                    "lim": limit,
                    "off": offset,
                    **date_params,
                },
            )
            rows = result.fetchall()
    except Exception:
        logger.exception("analytics_query_log_error client_id=%s", client_id)
        raise HTTPException(
            status_code=500,
            detail={
                "error": "server_error",
                "message": "Could not retrieve query log. Please retry.",
            },
        )

    return [
        QueryLogItem(
            query=row.query,
            intent=row.intent,
            signal=row.signal,
            result_count=None if row.result_count == -1 else int(row.result_count),
            searched_at=row.searched_at.isoformat() if row.searched_at else "",
            session_id=row.session_id,
        )
        for row in rows
    ]
