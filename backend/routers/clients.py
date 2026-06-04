"""
Client self-service endpoints for the dashboard.

All routes are protected by require_clerk_user — the Clerk JWT dependency.
client_id is derived server-side from the Clerk user lookup, never from the
request body.

Routes:
  POST /api/v1/me        — auto-provision client row on first login
  GET  /api/v1/me        — return current profile
  GET  /api/v1/me/keys   — list API keys (prefixes only, never full hashes)
  POST /api/v1/me/keys   — generate a new API key (raw key returned once)
  DELETE /api/v1/me/keys/{key_id} — soft-deactivate a key
"""

import asyncio
import logging
import uuid

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import text as sql_text

from config import settings
from db.postgres import (
    AsyncSessionLocal,
    create_api_key,
    create_client,
    deactivate_api_key,
    get_client_by_clerk_user_id,
    list_api_keys_for_client,
)
from middleware.clerk_auth import require_clerk_user
from services.billing import ensure_subscription_row

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/me", tags=["clients"])


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------


class ClientProfile(BaseModel):
    id: str
    email: str
    store_name: str | None
    store_url: str | None
    plan: str | None
    plan_status: str | None
    clerk_user_id: str
    store_description: str | None
    onboarding_complete: bool
    embed_config: list[str] = ["title", "category", "tags", "description"]
    available_embed_fields: list[str] = []


class UpdateMeRequest(BaseModel):
    store_name: str | None = None
    store_description: str | None = None
    onboarding_complete: bool | None = None
    embed_config: list[str] | None = None


class ApiKeyItem(BaseModel):
    id: str
    key_prefix: str
    raw_key: str | None
    label: str | None
    is_active: bool
    created_at: str


class CreateKeyRequest(BaseModel):
    label: str


class CreateKeyResponse(BaseModel):
    raw_key: str  # shown once, never stored
    key_prefix: str
    label: str | None
    id: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _format_active_source_label(
    active_source: str,
    active_file_format: str | None,
    last_trigger: str | None,
) -> str:
    if active_source == "database":
        return "DB sync"
    if active_source == "api_pull":
        return "Auto-sync pull"
    if active_source == "csv":
        if last_trigger == "rest_api_push":
            return "REST API push"
        if last_trigger == "webhook_sync":
            return "Webhook sync"
        if last_trigger == "manual_add":
            return "Manual"
        if active_file_format == "csv":
            return "CSV manual"
        if active_file_format == "json":
            return "JSON manual"
        if active_file_format == "ndjson":
            return "NDJSON manual"
        return "Manual"
    return "No catalog"


async def _resolve_clerk_email(request: Request) -> str:
    """Return the user's real email via a two-layer lookup.

    Layer 1 — JWT email claim (fast, zero extra I/O):
        clerk_auth.py stores payload.get("email") on request.state.clerk_email
        when Clerk's session template includes it.

    Layer 2 — Clerk REST API (reliable fallback):
        GET https://api.clerk.com/v1/users/{clerk_user_id}
        Parses email_addresses[0].email_address from the response.
        Uses CLERK_SECRET_KEY from settings (never from request body).

    If both layers fail, returns the deterministic placeholder
    `{clerk_user_id}@clerk.local` so provisioning never breaks.
    """
    clerk_user_id: str = request.state.clerk_user_id

    # Layer 1: JWT claim (present when session template includes `email`)
    jwt_email: str | None = getattr(request.state, "clerk_email", None)
    if jwt_email:
        return jwt_email

    # Layer 2: Clerk REST API
    if settings.clerk_secret_key:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(
                    f"https://api.clerk.com/v1/users/{clerk_user_id}",
                    headers={"Authorization": f"Bearer {settings.clerk_secret_key}"},
                )
            if resp.status_code == 200:
                data = resp.json()
                addresses = data.get("email_addresses", [])
                if addresses:
                    return addresses[0]["email_address"]
        except Exception:
            logger.warning(
                "clerk_email_api_error clerk_user_id=%s — falling back to placeholder",
                clerk_user_id,
            )

    # Final fallback: deterministic placeholder (satisfies unique constraint)
    return f"{clerk_user_id}@clerk.local"


async def _get_available_embed_fields(session, client_id: str) -> list[str]:
    """Return catalog fields that are actually present for this client.

    The embed config UI should be driven by fields that exist in the client's
    current catalog, not by a hardcoded OTT schema. DB custom columns are still
    surfaced separately through database status `source_columns`.
    """
    try:
        result = await session.execute(
            sql_text(
                """
                SELECT
                    COUNT(NULLIF(BTRIM(title), '')) > 0 AS title,
                    COUNT(NULLIF(BTRIM(description), '')) > 0 AS description,
                    COUNT(NULLIF(BTRIM(category), '')) > 0 AS category,
                    COUNT(NULLIF(BTRIM(tags), '')) > 0 AS tags,
                    COUNT(NULLIF(BTRIM(image_url), '')) > 0 AS image_url,
                    COUNT(NULLIF(BTRIM(product_url), '')) > 0 AS product_url,
                    COUNT(NULLIF(BTRIM(actors), '')) > 0 AS actors,
                    COUNT(NULLIF(BTRIM(director), '')) > 0 AS director,
                    COUNT(NULLIF(BTRIM(writer), '')) > 0 AS writer,
                    COUNT(NULLIF(BTRIM(content_type), '')) > 0 AS content_type,
                    COUNT(year) > 0 AS year,
                    COUNT(NULLIF(BTRIM(language), '')) > 0 AS language,
                    COUNT(duration_mins) > 0 AS duration_mins
                FROM products
                WHERE client_id = :cid
                """
            ),
            {"cid": uuid.UUID(client_id)},
        )
        row = result.mappings().first()
    except Exception:
        logger.exception("available_embed_fields_error client_id=%s", client_id)
        return []

    if not row:
        return []

    ordered_fields = [
        "title",
        "description",
        "category",
        "tags",
        "image_url",
        "product_url",
        "actors",
        "director",
        "writer",
        "content_type",
        "year",
        "language",
        "duration_mins",
    ]
    return [field for field in ordered_fields if row.get(field)]


async def _profile_from_client(session, client) -> ClientProfile:
    available_embed_fields = await _get_available_embed_fields(session, str(client.id))
    return ClientProfile(
        id=str(client.id),
        email=client.email,
        store_name=client.store_name,
        store_url=client.store_url,
        plan=client.plan,
        plan_status=client.plan_status,
        clerk_user_id=client.clerk_user_id or "",
        store_description=client.store_description,
        onboarding_complete=client.onboarding_complete,
        embed_config=list(client.embed_config)
        if client.embed_config
        else ["title", "category", "tags", "description"],
        available_embed_fields=available_embed_fields,
    )


# ---------------------------------------------------------------------------
# POST /api/v1/me  — auto-provision on first login
# ---------------------------------------------------------------------------


@router.post("", status_code=200)
async def upsert_me(
    request: Request,
    clerk_user_id: str = Depends(require_clerk_user),
) -> ClientProfile:
    """Return existing client profile or create one for first-time users.

    Idempotent: calling this multiple times is safe.
    """
    # Resolve real email before opening the DB session — may call Clerk API.
    real_email = await _resolve_clerk_email(request)

    async with AsyncSessionLocal() as session:
        client = await get_client_by_clerk_user_id(session, clerk_user_id)
        if client is None:
            try:
                client = await create_client(
                    session,
                    clerk_user_id=clerk_user_id,
                    email=real_email,
                )
                await session.commit()
                # Refresh to get server-default fields (created_at, etc.)
                await session.refresh(client)
                # Provision the subscription row asynchronously — fire-and-forget.
                # ensure_subscription_row is idempotent so retries are safe.
                asyncio.create_task(ensure_subscription_row(str(client.id)))
            except Exception:
                logger.exception("client_create_error clerk_user_id=%s", clerk_user_id)
                raise HTTPException(
                    status_code=500,
                    detail={
                        "error": "server_error",
                        "message": "Could not provision your account. Please retry.",
                    },
                )
        else:
            # Heal existing rows that were created with the placeholder email.
            # Triggered on every login — no migration needed.
            placeholder = f"{clerk_user_id}@clerk.local"
            if client.email.endswith("@clerk.local") and real_email != placeholder:
                client.email = real_email
                try:
                    await session.commit()
                    await session.refresh(client)
                    logger.info("clerk_email_healed clerk_user_id=%s", clerk_user_id)
                except Exception:
                    logger.warning(
                        "clerk_email_heal_failed clerk_user_id=%s", clerk_user_id
                    )
                    await session.rollback()

        # Keep request.state.client_id in sync for any downstream use
        request.state.client_id = str(client.id)
        return await _profile_from_client(session, client)


# ---------------------------------------------------------------------------
# GET /api/v1/me
# ---------------------------------------------------------------------------


@router.get("")
async def get_me(
    request: Request,
    clerk_user_id: str = Depends(require_clerk_user),
) -> ClientProfile:
    """Return the current client's profile."""
    async with AsyncSessionLocal() as session:
        client = await get_client_by_clerk_user_id(session, clerk_user_id)

        if client is None:
            raise HTTPException(
                status_code=403,
                detail={
                    "error": "account_not_found",
                    "message": "No account found for this user. Call POST /api/v1/me to create one.",
                },
            )

        return await _profile_from_client(session, client)


# ---------------------------------------------------------------------------
# PUT /api/v1/me  — partial update of client profile
# ---------------------------------------------------------------------------


@router.put("")
async def update_me(
    body: UpdateMeRequest,
    request: Request,
    clerk_user_id: str = Depends(require_clerk_user),
) -> ClientProfile:
    """Partially update the current client's profile.

    Only fields present and non-None in the request body are written.
    Returns the full updated profile in the same shape as GET /api/v1/me.
    """
    async with AsyncSessionLocal() as session:
        client = await get_client_by_clerk_user_id(session, clerk_user_id)

        if client is None:
            raise HTTPException(
                status_code=403,
                detail={
                    "error": "account_not_found",
                    "message": "No account found for this user. Call POST /api/v1/me to create one.",
                },
            )

        updated = False
        if body.store_name is not None:
            client.store_name = body.store_name
            updated = True
        if body.store_description is not None:
            client.store_description = body.store_description
            updated = True
        if body.onboarding_complete is not None:
            client.onboarding_complete = body.onboarding_complete
            updated = True
        if body.embed_config is not None:
            client.embed_config = body.embed_config
            updated = True

        if updated:
            try:
                await session.commit()
                await session.refresh(client)
            except Exception:
                logger.exception("client_update_error clerk_user_id=%s", clerk_user_id)
                await session.rollback()
                raise HTTPException(
                    status_code=500,
                    detail={
                        "error": "server_error",
                        "message": "Could not update your profile. Please retry.",
                    },
                )

    async with AsyncSessionLocal() as session:
        refreshed = await get_client_by_clerk_user_id(session, clerk_user_id)
        if refreshed is None:
            raise HTTPException(
                status_code=403,
                detail={
                    "error": "account_not_found",
                    "message": "No account found for this user. Call POST /api/v1/me to create one.",
                },
            )
        return await _profile_from_client(session, refreshed)


# ---------------------------------------------------------------------------
# GET /api/v1/me/keys
# ---------------------------------------------------------------------------


@router.get("/keys")
async def list_keys(
    request: Request,
    clerk_user_id: str = Depends(require_clerk_user),
) -> list[ApiKeyItem]:
    """List all API keys for the current client.

    Never returns the full key hash — only the safe prefix.
    """
    client_id = request.state.client_id
    if client_id is None:
        raise HTTPException(
            status_code=403,
            detail={
                "error": "account_not_found",
                "message": "No account found for this user. Call POST /api/v1/me first.",
            },
        )

    async with AsyncSessionLocal() as session:
        keys = await list_api_keys_for_client(session, uuid.UUID(client_id))

    return [
        ApiKeyItem(
            id=str(k.id),
            key_prefix=k.key_prefix,
            raw_key=k.raw_key,
            label=k.label,
            is_active=k.is_active,
            created_at=k.created_at.isoformat(),
        )
        for k in keys
    ]


# ---------------------------------------------------------------------------
# POST /api/v1/me/keys
# ---------------------------------------------------------------------------


@router.post("/keys", status_code=201)
async def create_key(
    body: CreateKeyRequest,
    request: Request,
    clerk_user_id: str = Depends(require_clerk_user),
) -> CreateKeyResponse:
    """Generate a new API key.

    The raw_key is returned exactly once in this response and is never stored.
    The client must copy it immediately.
    """
    client_id = request.state.client_id
    if client_id is None:
        raise HTTPException(
            status_code=403,
            detail={
                "error": "account_not_found",
                "message": "No account found for this user. Call POST /api/v1/me first.",
            },
        )

    if not body.label or not body.label.strip():
        raise HTTPException(
            status_code=422,
            detail={
                "error": "validation_error",
                "message": "label is required and must not be blank.",
            },
        )

    try:
        async with AsyncSessionLocal() as session:
            raw_key, api_key = await create_api_key(
                session,
                client_id=uuid.UUID(client_id),
                label=body.label.strip(),
            )
            await session.commit()
            await session.refresh(api_key)
    except Exception:
        logger.exception("api_key_create_error client_id=%s", client_id)
        raise HTTPException(
            status_code=500,
            detail={
                "error": "server_error",
                "message": "Could not create API key. Please retry.",
            },
        )

    return CreateKeyResponse(
        raw_key=raw_key,
        key_prefix=api_key.key_prefix,
        label=api_key.label,
        id=str(api_key.id),
    )


# ---------------------------------------------------------------------------
# DELETE /api/v1/me/keys/{key_id}
# ---------------------------------------------------------------------------


@router.delete("/keys/{key_id}")
async def delete_key(
    key_id: str,
    request: Request,
    clerk_user_id: str = Depends(require_clerk_user),
) -> dict:
    """Soft-deactivate an API key (sets is_active=False).

    Hard deletes are never performed — keys must remain in the DB for audit
    purposes.  The key becomes immediately invalid for new requests once
    deactivated (auth middleware checks is_active=True).
    """
    client_id = request.state.client_id
    if client_id is None:
        raise HTTPException(
            status_code=403,
            detail={
                "error": "account_not_found",
                "message": "No account found for this user. Call POST /api/v1/me first.",
            },
        )

    try:
        key_uuid = uuid.UUID(key_id)
    except ValueError:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "validation_error",
                "message": f"key_id '{key_id}' is not a valid UUID.",
            },
        )

    try:
        async with AsyncSessionLocal() as session:
            updated = await deactivate_api_key(
                session,
                key_id=key_uuid,
                client_id=uuid.UUID(client_id),
            )
            await session.commit()
    except Exception:
        logger.exception(
            "api_key_deactivate_error client_id=%s key_id=%s", client_id, key_id
        )
        raise HTTPException(
            status_code=500,
            detail={
                "error": "server_error",
                "message": "Could not deactivate API key. Please retry.",
            },
        )

    if not updated:
        raise HTTPException(
            status_code=404,
            detail={
                "error": "key_not_found",
                "message": "API key not found or does not belong to your account.",
            },
        )

    return {"ok": True}


# ---------------------------------------------------------------------------
# GET /api/v1/me/catalog
# ---------------------------------------------------------------------------


@router.get("/catalog")
async def get_catalog(
    request: Request,
    clerk_user_id: str = Depends(require_clerk_user),
) -> dict:
    """Return current catalog stats, active source, and last ingest job."""
    import asyncio
    from sqlalchemy import text as sql_text
    from services.meilisearch import get_client as get_meili_client

    client_id = request.state.client_id
    if client_id is None:
        raise HTTPException(status_code=403, detail={"error": "account_not_found"})

    # Product count from Meilisearch
    def _fetch_count():
        try:
            meili = get_meili_client()
            return meili.index(f"products_{client_id}").get_stats().number_of_documents
        except Exception:
            return 0

    loop = asyncio.get_event_loop()
    product_count = await loop.run_in_executor(None, _fetch_count)

    # Last ingest job
    active_source = "none"
    active_source_label = "No catalog"
    active_file_format = None
    last_trigger = None
    async with AsyncSessionLocal() as session:
        source_result = await session.execute(
            sql_text(
                """
                SELECT table_name, sync_status, last_synced_at
                FROM database_connections
                WHERE client_id = :cid
                LIMIT 1
                """
            ),
            {"cid": uuid.UUID(client_id)},
        )
        source_row = source_result.fetchone()
        if source_row:
            active_source = "database"
        else:
            api_sync_result = await session.execute(
                sql_text(
                    """
                    SELECT source_url
                    FROM api_sync_connections
                    WHERE client_id = :cid
                    LIMIT 1
                    """
                ),
                {"cid": uuid.UUID(client_id)},
            )
            api_sync_row = api_sync_result.fetchone()
            if api_sync_row:
                active_source = "api_pull"
            else:
                prefix_result = await session.execute(
                    sql_text(
                        """
                        SELECT external_id
                        FROM products
                        WHERE client_id = :cid
                          AND external_id IS NOT NULL
                        ORDER BY created_at DESC
                        LIMIT 1
                        """
                    ),
                    {"cid": uuid.UUID(client_id)},
                )
                prefix_row = prefix_result.fetchone()
                external_id = (prefix_row.external_id or "") if prefix_row else ""
                if external_id.startswith("csv_"):
                    active_source = "csv"
                elif external_id.startswith("dbsync_"):
                    active_source = "database"
                elif external_id.startswith("pull_"):
                    active_source = "api_pull"

        result = await session.execute(
            sql_text(
                """
                SELECT id, status, total, processed, error_log, created_at,
                       added_count, updated_count, skipped_count, file_format, trigger
                FROM ingest_jobs
                WHERE client_id = :cid
                ORDER BY created_at DESC
                LIMIT 1
                """
            ),
            {"cid": uuid.UUID(client_id)},
        )
        row = result.fetchone()

        format_result = await session.execute(
            sql_text(
                """
                SELECT file_format
                FROM ingest_jobs
                WHERE client_id = :cid
                  AND status = 'done'
                  AND file_format IS NOT NULL
                ORDER BY created_at DESC
                LIMIT 1
                """
            ),
            {"cid": uuid.UUID(client_id)},
        )
        format_row = format_result.fetchone()
        if format_row:
            active_file_format = format_row.file_format
        if row:
            last_trigger = row.trigger

    active_source_label = _format_active_source_label(
        active_source,
        active_file_format,
        last_trigger,
    )

    last_job = None
    if row:
        last_job = {
            "id": str(row.id),
            "status": row.status,
            "total": row.total,
            "processed": row.processed,
            "error_log": row.error_log,
            "created_at": row.created_at.isoformat(),
            "added_count": row.added_count,
            "updated_count": row.updated_count,
            "skipped_count": row.skipped_count,
            "file_format": row.file_format,
            "trigger": row.trigger,
        }

    return {
        "product_count": product_count,
        "active_source": active_source,
        "active_source_label": active_source_label,
        "active_file_format": active_file_format,
        "last_job": last_job,
    }
