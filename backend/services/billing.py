"""
Gateway-agnostic billing service for ScubaSearch.

All public functions accept client_id as a string (UUID).  Database access
uses async SQLAlchemy sessions via AsyncSessionLocal.

Plan limits:
  growth  → 1,000 titles / 10,000 sessions per month   ($199/mo)
  scale   → 10,000 titles / 100,000 sessions per month ($499/mo)
  none    → 0 / 0  (must subscribe before using the product)

Two billing counters tracked in the subscriptions table:
  monthly_query_count   — incremented on every search request (including cache hits)
  monthly_session_count — incremented once per settled widget session

Session counts are the user-facing limit.  Both counters reset on the first
call after search_count_reset_at has passed (calendar-month boundary, seeded
when the subscription is first created).
"""

import logging
import uuid
from datetime import datetime

from sqlalchemy import select, update

from db.postgres import AsyncSessionLocal
from db.models import Client, Product, Subscription

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Plan definitions
# ---------------------------------------------------------------------------

PLAN_LIMITS: dict[str, dict[str, int]] = {
    "growth": {"max_products": 1_000, "max_sessions": 10_000},
    "scale": {"max_products": 10_000, "max_sessions": 100_000},
    "none": {"max_products": 0, "max_sessions": 0},
}


def _next_month_start(from_dt: datetime) -> datetime:
    """Return the first second of the calendar month after *from_dt* (UTC).

    Returns a naive datetime (no tzinfo) because the subscriptions table uses
    TIMESTAMP WITHOUT TIME ZONE.  asyncpg rejects tz-aware values for such columns.
    """
    year = from_dt.year
    month = from_dt.month + 1
    if month > 12:
        month = 1
        year += 1
    return datetime(year, month, 1)


# ---------------------------------------------------------------------------
# Subscription row helpers (internal)
# ---------------------------------------------------------------------------


async def _get_subscription(session, client_id: str) -> Subscription | None:
    stmt = (
        select(Subscription)
        .where(Subscription.client_id == uuid.UUID(client_id))
        .limit(1)
    )
    result = await session.execute(stmt)
    return result.scalar_one_or_none()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def get_plan(client_id: str) -> dict:
    """Return the current plan name and status for the client.

    Returns: {"plan": str, "status": str}
    Falls back to {"plan": "none", "status": "inactive"} if no row exists.
    """
    async with AsyncSessionLocal() as session:
        sub = await _get_subscription(session, client_id)
    if sub is None:
        return {"plan": "none", "status": "inactive"}
    return {"plan": sub.plan or "none", "status": sub.status or "inactive"}


async def get_limits(client_id: str) -> dict:
    """Return max_products and max_sessions for the client's current plan.

    Returns: {"max_products": int, "max_sessions": int}
    """
    plan_info = await get_plan(client_id)
    plan = plan_info["plan"]
    return PLAN_LIMITS.get(plan, PLAN_LIMITS["none"])


async def activate_plan(
    client_id: str,
    plan: str,
    gateway_sub_id: str | None = None,
) -> None:
    """Upsert subscription to active for the given plan.

    Also syncs clients.plan and clients.plan_status so that quick lookups
    on the clients table remain accurate without a join.
    """
    now = datetime.utcnow()
    reset_at = _next_month_start(now)

    async with AsyncSessionLocal() as session:
        sub = await _get_subscription(session, client_id)

        if sub is None:
            sub = Subscription(
                client_id=uuid.UUID(client_id),
                plan=plan,
                status="active",
                gateway_sub_id=gateway_sub_id,
                monthly_query_count=0,
                monthly_session_count=0,
                search_count_reset_at=reset_at,
            )
            session.add(sub)
        else:
            sub.plan = plan
            sub.status = "active"
            if gateway_sub_id is not None:
                sub.gateway_sub_id = gateway_sub_id
            # Only reset the window timestamp if it has not been set yet
            if sub.search_count_reset_at is None:
                sub.search_count_reset_at = reset_at

        # Mirror onto clients table for fast single-table reads
        await session.execute(
            update(Client)
            .where(Client.id == uuid.UUID(client_id))
            .values(plan=plan, plan_status="active")
        )

        await session.commit()


async def cancel_plan(client_id: str) -> None:
    """Mark subscription as inactive and clear plan on the client row."""
    async with AsyncSessionLocal() as session:
        sub = await _get_subscription(session, client_id)
        if sub is not None:
            sub.status = "inactive"
        await session.execute(
            update(Client)
            .where(Client.id == uuid.UUID(client_id))
            .values(plan_status="inactive")
        )
        await session.commit()


async def set_past_due(client_id: str) -> None:
    """Mark subscription and client row as past_due after a failed payment."""
    async with AsyncSessionLocal() as session:
        sub = await _get_subscription(session, client_id)
        if sub is not None:
            sub.status = "past_due"
        await session.execute(
            update(Client)
            .where(Client.id == uuid.UUID(client_id))
            .values(plan_status="past_due")
        )
        await session.commit()


async def get_usage(client_id: str) -> dict:
    """Return current usage counters for the client.

    Returns:
        {
            "products_count": int,
            "queries_this_month": int,
            "sessions_this_month": int,
            "reset_at": str | None,    # ISO 8601
        }
    """
    async with AsyncSessionLocal() as session:
        sub = await _get_subscription(session, client_id)
        # Count the current live catalog size, not historical ingest totals.
        from sqlalchemy import func as sa_func

        stmt = select(sa_func.count()).select_from(Product).where(
            Product.client_id == uuid.UUID(client_id),
        )
        result = await session.execute(stmt)
        products_count = result.scalar() or 0

    queries = sub.monthly_query_count if sub else 0
    sessions = sub.monthly_session_count if sub else 0
    reset_at = None
    if sub and sub.search_count_reset_at:
        reset_at = sub.search_count_reset_at.isoformat()

    return {
        "products_count": int(products_count),
        "queries_this_month": queries,
        "sessions_this_month": sessions,
        "reset_at": reset_at,
    }


async def check_product_limit(client_id: str) -> tuple[bool, int, int]:
    """Check whether the client can upload more products.

    Returns (ok, used, max) where ok=False means they have hit their limit.
    """
    limits = await get_limits(client_id)
    usage = await get_usage(client_id)
    used = usage["products_count"]
    maximum = limits["max_products"]
    if maximum == -1:
        return True, used, maximum
    ok = used < maximum
    return ok, used, maximum


async def check_session_limit(client_id: str) -> tuple[bool, int, int]:
    """Check whether the client can start another session this month.

    Returns (ok, used, max) where ok=False means they have hit their limit.

    Internally uses a single DB query to fetch the subscription row, derives
    both the plan limits and the current count from it.
    """
    async with AsyncSessionLocal() as session:
        sub = await _get_subscription(session, client_id)

    plan = sub.plan if sub else "none"
    limits = PLAN_LIMITS.get(plan, PLAN_LIMITS["none"])
    maximum = limits["max_sessions"]

    if maximum == -1:
        return True, 0, -1  # unlimited

    used = sub.monthly_session_count if sub else 0
    ok = used < maximum
    return ok, used, maximum


async def increment_query_count(client_id: str) -> None:
    """Increment the monthly query counter for the client.

    Fire-and-forget safe: exceptions are logged but not re-raised.
    """
    try:
        async with AsyncSessionLocal() as session:
            # Use an atomic UPDATE to avoid race conditions
            await session.execute(
                update(Subscription)
                .where(Subscription.client_id == uuid.UUID(client_id))
                .values(monthly_query_count=Subscription.monthly_query_count + 1)
            )
            await session.commit()
    except Exception:
        logger.exception("increment_query_count_error client_id=%s", client_id)


async def increment_session_count(client_id: str) -> None:
    """Increment the monthly session counter for the client.

    Fire-and-forget safe: exceptions are logged but not re-raised.
    """
    try:
        async with AsyncSessionLocal() as session:
            await session.execute(
                update(Subscription)
                .where(Subscription.client_id == uuid.UUID(client_id))
                .values(monthly_session_count=Subscription.monthly_session_count + 1)
            )
            await session.commit()
    except Exception:
        logger.exception("increment_session_count_error client_id=%s", client_id)


async def reset_counts_if_needed(client_id: str) -> None:
    """Reset both monthly counters if the reset window has passed.

    Rolls the reset_at forward to next month and zeroes both counters.
    Fire-and-forget safe.
    """
    try:
        async with AsyncSessionLocal() as session:
            sub = await _get_subscription(session, client_id)
            if sub is None:
                return
            now = datetime.utcnow()
            reset_at = sub.search_count_reset_at
            if reset_at is not None and now >= reset_at:
                sub.monthly_query_count = 0
                sub.monthly_session_count = 0
                sub.search_count_reset_at = _next_month_start(now)
                await session.commit()
    except Exception:
        logger.exception("reset_counts_error client_id=%s", client_id)


async def ensure_subscription_row(client_id: str) -> None:
    """Upsert a default subscription row for a newly-provisioned client.

    Called from clients.py POST /api/v1/me.  Idempotent — safe to call if
    the row already exists.
    """
    try:
        async with AsyncSessionLocal() as session:
            sub = await _get_subscription(session, client_id)
            if sub is None:
                now = datetime.utcnow()
                sub = Subscription(
                    client_id=uuid.UUID(client_id),
                    plan="none",
                    status="inactive",
                    gateway_sub_id=None,
                    monthly_query_count=0,
                    monthly_session_count=0,
                    search_count_reset_at=_next_month_start(now),
                )
                session.add(sub)
                await session.commit()
    except Exception:
        logger.exception("ensure_subscription_row_error client_id=%s", client_id)
