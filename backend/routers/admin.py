"""
Admin dashboard endpoints.

All routes require a valid Clerk JWT whose user ID is listed in
settings.admin_clerk_user_ids.  Never exposed to end users.

Routes:
  GET  /api/v1/admin/stats                          — platform-wide totals
  GET  /api/v1/admin/clients                        — paginated client list
  POST /api/v1/admin/clients/{client_id}/activate   — activate a plan
  POST /api/v1/admin/clients/{client_id}/cancel     — cancel a plan
"""

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text as sql_text

from db.postgres import AsyncSessionLocal
from middleware.admin_auth import require_admin
from services.billing import activate_plan, cancel_plan

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])

VALID_PLANS = {"growth", "scale"}


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------


class AdminStats(BaseModel):
    total_clients: int
    active_subscriptions: int
    searches_today: int
    sessions_this_month: int


class AdminClientRow(BaseModel):
    id: str
    email: str
    store_name: str | None
    store_url: str | None
    plan: str | None
    plan_status: str | None
    onboarding_complete: bool
    created_at: str  # ISO
    sub_plan: str
    sub_status: str
    sessions_this_month: int
    queries_this_month: int
    product_count: int
    last_active: str | None  # ISO or None


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------


class ActivatePlanRequest(BaseModel):
    plan: str  # "growth" | "scale"


# ---------------------------------------------------------------------------
# GET /api/v1/admin/stats
# ---------------------------------------------------------------------------


@router.get("/stats", response_model=AdminStats)
async def admin_stats(
    clerk_user_id: str = Depends(require_admin),
) -> AdminStats:
    """Return platform-wide aggregate totals."""
    try:
        async with AsyncSessionLocal() as session:
            row_clients = await session.execute(
                sql_text("SELECT COUNT(*) FROM clients")
            )
            total_clients: int = row_clients.scalar_one() or 0

            row_subs = await session.execute(
                sql_text("SELECT COUNT(*) FROM subscriptions WHERE status = 'active'")
            )
            active_subscriptions: int = row_subs.scalar_one() or 0

            row_searches = await session.execute(
                sql_text(
                    """
                    SELECT COUNT(*) FROM search_logs
                    WHERE created_at >= NOW() - INTERVAL '1 day'
                      AND settled = true
                      AND response_ms IS NOT NULL
                    """
                )
            )
            searches_today: int = row_searches.scalar_one() or 0

            row_sessions = await session.execute(
                sql_text(
                    "SELECT COALESCE(SUM(monthly_session_count), 0) FROM subscriptions"
                )
            )
            sessions_this_month: int = int(row_sessions.scalar_one() or 0)

    except Exception:
        logger.exception("admin_stats_error")
        raise HTTPException(
            status_code=500,
            detail={
                "error": "server_error",
                "message": "Could not retrieve admin stats. Please retry.",
            },
        )

    return AdminStats(
        total_clients=total_clients,
        active_subscriptions=active_subscriptions,
        searches_today=searches_today,
        sessions_this_month=sessions_this_month,
    )


# ---------------------------------------------------------------------------
# GET /api/v1/admin/clients
# ---------------------------------------------------------------------------


@router.get("/clients", response_model=list[AdminClientRow])
async def admin_clients(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    clerk_user_id: str = Depends(require_admin),
) -> list[AdminClientRow]:
    """Return a paginated list of all clients with subscription and usage details."""
    try:
        async with AsyncSessionLocal() as session:
            result = await session.execute(
                sql_text(
                    """
                    SELECT
                        c.id::text,
                        c.email,
                        c.store_name,
                        c.store_url,
                        c.plan,
                        c.plan_status,
                        c.onboarding_complete,
                        c.created_at,
                        COALESCE(s.plan, 'none') AS sub_plan,
                        COALESCE(s.status, 'inactive') AS sub_status,
                        COALESCE(s.monthly_session_count, 0) AS sessions_this_month,
                        COALESCE(s.monthly_query_count, 0) AS queries_this_month,
                        (SELECT COUNT(*) FROM products p WHERE p.client_id = c.id) AS product_count,
                        (SELECT MAX(sl.created_at) FROM search_logs sl WHERE sl.client_id = c.id) AS last_active
                    FROM clients c
                    LEFT JOIN subscriptions s ON s.client_id = c.id
                    ORDER BY c.created_at DESC
                    LIMIT :lim OFFSET :off
                    """
                ),
                {"lim": limit, "off": offset},
            )
            rows = result.fetchall()
    except Exception:
        logger.exception("admin_clients_error limit=%s offset=%s", limit, offset)
        raise HTTPException(
            status_code=500,
            detail={
                "error": "server_error",
                "message": "Could not retrieve client list. Please retry.",
            },
        )

    return [
        AdminClientRow(
            id=row.id,
            email=row.email,
            store_name=row.store_name,
            store_url=row.store_url,
            plan=row.plan,
            plan_status=row.plan_status,
            onboarding_complete=bool(row.onboarding_complete),
            created_at=row.created_at.isoformat() if row.created_at else "",
            sub_plan=row.sub_plan,
            sub_status=row.sub_status,
            sessions_this_month=int(row.sessions_this_month),
            queries_this_month=int(row.queries_this_month),
            product_count=int(row.product_count),
            last_active=row.last_active.isoformat() if row.last_active else None,
        )
        for row in rows
    ]


# ---------------------------------------------------------------------------
# POST /api/v1/admin/clients/{client_id}/activate
# ---------------------------------------------------------------------------


@router.post("/clients/{client_id}/activate")
async def admin_activate_client(
    client_id: str,
    body: ActivatePlanRequest,
    clerk_user_id: str = Depends(require_admin),
) -> dict:
    """Activate a plan for the given client. Body: {"plan": "growth"|"scale"}."""
    if body.plan not in VALID_PLANS:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "validation_error",
                "message": f"plan must be one of: {', '.join(sorted(VALID_PLANS))}",
            },
        )

    # Validate that client_id is a well-formed UUID before hitting the DB.
    try:
        uuid.UUID(client_id)
    except ValueError:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "validation_error",
                "message": "client_id must be a valid UUID.",
            },
        )

    try:
        await activate_plan(client_id, body.plan)
    except Exception:
        logger.exception(
            "admin_activate_error client_id=%s plan=%s", client_id, body.plan
        )
        raise HTTPException(
            status_code=500,
            detail={
                "error": "server_error",
                "message": "Could not activate plan. Please retry.",
            },
        )

    logger.info(
        "admin_activate client_id=%s plan=%s by=%s", client_id, body.plan, clerk_user_id
    )
    return {"ok": True}


# ---------------------------------------------------------------------------
# POST /api/v1/admin/clients/{client_id}/cancel
# ---------------------------------------------------------------------------


@router.post("/clients/{client_id}/cancel")
async def admin_cancel_client(
    client_id: str,
    clerk_user_id: str = Depends(require_admin),
) -> dict:
    """Cancel the subscription for the given client."""
    try:
        uuid.UUID(client_id)
    except ValueError:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "validation_error",
                "message": "client_id must be a valid UUID.",
            },
        )

    try:
        await cancel_plan(client_id)
    except Exception:
        logger.exception("admin_cancel_error client_id=%s", client_id)
        raise HTTPException(
            status_code=500,
            detail={
                "error": "server_error",
                "message": "Could not cancel plan. Please retry.",
            },
        )

    logger.info("admin_cancel client_id=%s by=%s", client_id, clerk_user_id)
    return {"ok": True}
