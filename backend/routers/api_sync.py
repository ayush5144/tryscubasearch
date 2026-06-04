import json
import logging
import uuid
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import text as sql_text

from db.postgres import AsyncSessionLocal
from middleware.clerk_auth import require_clerk_user
from services.api_sync import (
    decrypt_headers,
    encrypt_headers,
    preview_remote_source,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/api-sync", tags=["api-sync"])


class PreviewRequest(BaseModel):
    source_url: str
    headers: dict[str, str] | None = None
    items_path: str | None = None


class ConnectRequest(PreviewRequest):
    field_mapping: dict[str, str]
    sync_interval_mins: int = Field(default=15, ge=1, le=1440)


class SyncStatus(BaseModel):
    connected: bool
    source_url: str | None = None
    items_path: str | None = None
    field_mapping: dict | None = None
    sync_status: str | None = None
    product_count: int | None = None
    last_synced_at: str | None = None
    next_sync_at: str | None = None
    sync_interval_mins: int | None = None
    error_message: str | None = None
    source_columns: list[str] | None = None


def _require_client_id(request: Request) -> str:
    client_id = getattr(request.state, "client_id", None)
    if not client_id:
        raise HTTPException(
            status_code=403,
            detail={
                "error": "account_not_found",
                "message": "No account found. Call POST /api/v1/me first.",
            },
        )
    return client_id


def _validate_source_url(source_url: str) -> str:
    cleaned = source_url.strip()
    if not cleaned.startswith(("http://", "https://")):
        raise HTTPException(
            status_code=422,
            detail={
                "error": "invalid_source_url",
                "message": "Source URL must start with http:// or https://",
            },
        )
    return cleaned


async def _get_connection_row(session, client_id: str):
    result = await session.execute(
        sql_text("SELECT * FROM api_sync_connections WHERE client_id = :cid"),
        {"cid": uuid.UUID(client_id)},
    )
    return result.fetchone()


@router.post("/preview")
async def preview_api_source(
    body: PreviewRequest,
    request: Request,
    clerk_user_id: str = Depends(require_clerk_user),
) -> list[dict]:
    _require_client_id(request)
    source_url = _validate_source_url(body.source_url)
    try:
        return await __import__("asyncio").get_event_loop().run_in_executor(
            None,
            preview_remote_source,
            source_url,
            body.headers or {},
            body.items_path,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "preview_failed",
                "message": str(exc)[:300],
            },
        )


@router.post("/connect", response_model=SyncStatus, status_code=201)
async def connect_api_source(
    body: ConnectRequest,
    request: Request,
    clerk_user_id: str = Depends(require_clerk_user),
) -> SyncStatus:
    client_id = _require_client_id(request)
    source_url = _validate_source_url(body.source_url)

    try:
        preview = await __import__("asyncio").get_event_loop().run_in_executor(
            None,
            preview_remote_source,
            source_url,
            body.headers or {},
            body.items_path,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=422,
            detail={"error": "preview_failed", "message": str(exc)[:300]},
        )

    headers_enc = encrypt_headers(body.headers or {})
    now = datetime.utcnow()
    next_sync_at = now + timedelta(minutes=body.sync_interval_mins)

    async with AsyncSessionLocal() as session:
        await session.execute(
            sql_text("DELETE FROM database_connections WHERE client_id = :cid"),
            {"cid": uuid.UUID(client_id)},
        )
        existing = await _get_connection_row(session, client_id)
        payload = {
            "cid": uuid.UUID(client_id),
            "source_url": source_url,
            "headers_enc": headers_enc,
            "items_path": body.items_path,
            "field_mapping": json.dumps(body.field_mapping),
            "source_columns": json.dumps([c["name"] for c in preview]),
            "next_sync_at": next_sync_at,
            "sync_interval_mins": body.sync_interval_mins,
        }
        if existing:
            await session.execute(
                sql_text(
                    """
                    UPDATE api_sync_connections
                    SET source_url = :source_url,
                        headers_enc = :headers_enc,
                        items_path = :items_path,
                        field_mapping = :field_mapping,
                        sync_status = 'pending',
                        product_count = NULL,
                        last_synced_at = NULL,
                        next_sync_at = :next_sync_at,
                        sync_interval_mins = :sync_interval_mins,
                        error_message = NULL,
                        source_columns = :source_columns
                    WHERE client_id = :cid
                    """
                ),
                payload,
            )
        else:
            await session.execute(
                sql_text(
                    """
                    INSERT INTO api_sync_connections (
                        client_id, source_url, headers_enc, items_path, field_mapping,
                        sync_status, next_sync_at, sync_interval_mins, source_columns
                    )
                    VALUES (
                        :cid, :source_url, :headers_enc, :items_path, :field_mapping,
                        'pending', :next_sync_at, :sync_interval_mins, :source_columns
                    )
                    """
                ),
                payload,
            )
        await session.commit()

    from workers.tasks import sync_external_api_source

    sync_external_api_source.delay(client_id)

    return SyncStatus(
        connected=True,
        source_url=source_url,
        items_path=body.items_path,
        field_mapping=body.field_mapping,
        sync_status="pending",
        product_count=None,
        last_synced_at=None,
        next_sync_at=next_sync_at.isoformat(),
        sync_interval_mins=body.sync_interval_mins,
        error_message=None,
        source_columns=[c["name"] for c in preview],
    )


@router.get("/status", response_model=SyncStatus)
async def get_api_sync_status(
    request: Request,
    clerk_user_id: str = Depends(require_clerk_user),
) -> SyncStatus:
    client_id = _require_client_id(request)
    async with AsyncSessionLocal() as session:
        row = await _get_connection_row(session, client_id)
        if not row:
            return SyncStatus(connected=False)
        return SyncStatus(
            connected=True,
            source_url=row.source_url,
            items_path=row.items_path,
            field_mapping=row.field_mapping,
            sync_status=row.sync_status,
            product_count=row.product_count,
            last_synced_at=row.last_synced_at.isoformat()
            if row.last_synced_at
            else None,
            next_sync_at=row.next_sync_at.isoformat() if row.next_sync_at else None,
            sync_interval_mins=row.sync_interval_mins,
            error_message=row.error_message,
            source_columns=row.source_columns,
        )


@router.post("/sync")
async def trigger_api_sync(
    request: Request,
    clerk_user_id: str = Depends(require_clerk_user),
) -> dict:
    client_id = _require_client_id(request)
    async with AsyncSessionLocal() as session:
        row = await _get_connection_row(session, client_id)
        if not row:
            raise HTTPException(status_code=404, detail={"error": "not_connected"})
        if row.sync_status == "syncing":
            raise HTTPException(status_code=409, detail={"error": "already_syncing"})
        await session.execute(
            sql_text(
                "UPDATE api_sync_connections SET sync_status = 'pending', error_message = NULL WHERE client_id = :cid"
            ),
            {"cid": uuid.UUID(client_id)},
        )
        await session.commit()

    from workers.tasks import sync_external_api_source

    sync_external_api_source.delay(client_id)
    return {"ok": True}


@router.delete("/disconnect")
async def disconnect_api_source(
    request: Request,
    clerk_user_id: str = Depends(require_clerk_user),
) -> dict:
    client_id = _require_client_id(request)
    async with AsyncSessionLocal() as session:
        await session.execute(
            sql_text("DELETE FROM api_sync_connections WHERE client_id = :cid"),
            {"cid": uuid.UUID(client_id)},
        )
        await session.commit()
    return {"ok": True}
