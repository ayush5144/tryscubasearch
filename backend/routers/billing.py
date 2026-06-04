"""
Billing router — Phase 6.

Endpoints:
  GET  /api/v1/billing/status          — current plan + usage (Clerk JWT required)
  POST /api/v1/billing/webhook         — gateway webhook (no auth, always returns 200)
  POST /api/v1/billing/activate-test   — dev-only plan activation (Clerk JWT required)

The webhook endpoint is intentionally gateway-agnostic.  Stripe, Dodo Payments,
Razorpay, or any other processor can call it by posting the normalised payload
shape.  One day's wiring work wires a real gateway.

Idempotency (non-negotiable):
  Before processing any webhook event that creates/updates a subscription, we
  check whether gateway_sub_id already exists in the subscriptions table.
  If yes → return 200 immediately without reprocessing.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select

from config import settings
from middleware.clerk_auth import require_clerk_user
from services.billing import (
    activate_plan,
    cancel_plan,
    get_plan,
    get_usage,
    set_past_due,
    PLAN_LIMITS,
)
from db.postgres import AsyncSessionLocal
from db.models import Subscription

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/billing", tags=["billing"])

VALID_PLANS = {"growth", "scale"}


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------


class BillingStatusResponse(BaseModel):
    plan: str
    status: str
    products_used: int
    products_limit: int
    sessions_used: int
    sessions_limit: int
    reset_at: str | None


class WebhookPayload(BaseModel):
    event_type: (
        str  # "subscription.activated" | "subscription.canceled" | "payment.failed"
    )
    gateway_sub_id: str | None = None
    plan: str | None = None
    client_id: str | None = (
        None  # gateway sends us the client_id it received at checkout
    )


class ActivateTestRequest(BaseModel):
    plan: str  # "starter" | "growth" | "scale"


# ---------------------------------------------------------------------------
# GET /api/v1/billing/status
# ---------------------------------------------------------------------------


@router.get("/status", response_model=BillingStatusResponse)
async def billing_status(
    request: Request,
    clerk_user_id: str = Depends(require_clerk_user),
) -> BillingStatusResponse:
    """Return current plan, status, and usage counters for the authenticated client."""
    client_id: str | None = request.state.client_id
    if client_id is None:
        raise HTTPException(
            status_code=403,
            detail={
                "error": "account_not_found",
                "message": "No account found. Call POST /api/v1/me first.",
            },
        )

    plan_info = await get_plan(client_id)
    usage = await get_usage(client_id)
    limits = PLAN_LIMITS.get(plan_info["plan"], PLAN_LIMITS["none"])

    return BillingStatusResponse(
        plan=plan_info["plan"],
        status=plan_info["status"],
        products_used=usage["products_count"],
        products_limit=limits["max_products"],
        sessions_used=usage["sessions_this_month"],
        sessions_limit=limits["max_sessions"],
        reset_at=usage["reset_at"],
    )


# ---------------------------------------------------------------------------
# POST /api/v1/billing/webhook
# ---------------------------------------------------------------------------


@router.post("/webhook")
async def billing_webhook(payload: WebhookPayload) -> dict:
    """Receive a normalised billing event from any payment gateway.

    Always returns HTTP 200 — returning non-200 causes gateway retries.

    Idempotency: if gateway_sub_id already exists in the subscriptions table,
    we skip processing and return 200 immediately.

    Supported event_type values:
      "subscription.activated" — plan goes live
      "subscription.canceled"  — plan deactivated
      "payment.failed"         — mark as past_due
    """
    event_type = payload.event_type
    gateway_sub_id = payload.gateway_sub_id
    client_id = payload.client_id

    logger.info(
        "billing_webhook event=%s gateway_sub_id=%s client_id=%s",
        event_type,
        gateway_sub_id,
        client_id,
    )

    # -----------------------------------------------------------------------
    # Idempotency check for events that carry a gateway_sub_id
    # -----------------------------------------------------------------------
    if gateway_sub_id and event_type == "subscription.activated":
        async with AsyncSessionLocal() as session:
            stmt = (
                select(Subscription)
                .where(Subscription.gateway_sub_id == gateway_sub_id)
                .limit(1)
            )
            result = await session.execute(stmt)
            existing = result.scalar_one_or_none()

        if existing is not None:
            logger.info(
                "billing_webhook idempotent skip gateway_sub_id=%s", gateway_sub_id
            )
            return {"ok": True, "skipped": True}

    # -----------------------------------------------------------------------
    # Route to the appropriate handler
    # -----------------------------------------------------------------------
    try:
        if event_type == "subscription.activated":
            if not client_id:
                logger.warning(
                    "billing_webhook missing client_id for subscription.activated"
                )
                return {"ok": True, "warning": "missing client_id"}
            plan = payload.plan or "none"
            if plan not in VALID_PLANS:
                logger.warning("billing_webhook unknown plan=%s", plan)
                return {"ok": True, "warning": f"unknown plan: {plan}"}
            await activate_plan(client_id, plan, gateway_sub_id)
            logger.info(
                "billing_webhook activated plan=%s client_id=%s", plan, client_id
            )

        elif event_type == "subscription.canceled":
            if not client_id:
                logger.warning(
                    "billing_webhook missing client_id for subscription.canceled"
                )
                return {"ok": True, "warning": "missing client_id"}
            await cancel_plan(client_id)
            logger.info("billing_webhook canceled client_id=%s", client_id)

        elif event_type == "payment.failed":
            if not client_id:
                logger.warning("billing_webhook missing client_id for payment.failed")
                return {"ok": True, "warning": "missing client_id"}
            await set_past_due(client_id)
            logger.info("billing_webhook past_due client_id=%s", client_id)

        else:
            logger.info("billing_webhook unhandled event_type=%s (ignored)", event_type)

    except Exception:
        # Must always return 200 to prevent gateway retries flooding us.
        logger.exception(
            "billing_webhook_error event=%s gateway_sub_id=%s client_id=%s",
            event_type,
            gateway_sub_id,
            client_id,
        )

    return {"ok": True}


# ---------------------------------------------------------------------------
# POST /api/v1/billing/activate-test  (development only)
# ---------------------------------------------------------------------------


@router.post("/activate-test")
async def activate_test(
    body: ActivateTestRequest,
    request: Request,
    clerk_user_id: str = Depends(require_clerk_user),
) -> dict:
    """Activate a plan for the current user without payment — for local testing only.

    Returns 403 in any environment other than development.
    """
    if settings.environment != "development":
        raise HTTPException(
            status_code=403,
            detail={
                "error": "forbidden",
                "message": "This endpoint is only available in development.",
            },
        )

    client_id: str | None = request.state.client_id
    if client_id is None:
        raise HTTPException(
            status_code=403,
            detail={
                "error": "account_not_found",
                "message": "No account found. Call POST /api/v1/me first.",
            },
        )

    plan = body.plan
    if plan not in VALID_PLANS:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "validation_error",
                "message": f"plan must be one of: {', '.join(sorted(VALID_PLANS))}",
            },
        )

    try:
        await activate_plan(client_id, plan, gateway_sub_id=None)
    except Exception:
        logger.exception("activate_test_error client_id=%s plan=%s", client_id, plan)
        raise

    # Mark onboarding complete atomically — don't rely on a separate updateMe call
    try:
        async with AsyncSessionLocal() as session:
            await session.execute(
                update(ClientModel)
                .where(ClientModel.id == uuid.UUID(client_id))
                .values(onboarding_complete=True)
            )
            await session.commit()
    except Exception:
        logger.warning(
            "activate_test: failed to set onboarding_complete for %s", client_id
        )

    return {
        "ok": True,
        "plan": plan,
        "message": f"Test plan '{plan}' activated for client {client_id}.",
    }
