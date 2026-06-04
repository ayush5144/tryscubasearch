"""
External database connection endpoints.

Routes:
  POST   /api/v1/database/preview-columns  — test conn + return column list
  POST   /api/v1/database/connect          — save connection + trigger initial sync
  GET    /api/v1/database/status           — connection status
  POST   /api/v1/database/sync             — trigger re-sync
  DELETE /api/v1/database/disconnect       — remove connection
"""

import json
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import text as sql_text

from db.postgres import AsyncSessionLocal
from middleware.clerk_auth import require_clerk_user
from services.db_connect import (
    decrypt_connection_string,
    encrypt_connection_string,
    get_table_columns,
    get_tables,
    is_internal_app_table,
    test_connection,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/database", tags=["database"])


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------


class PreviewRequest(BaseModel):
    db_type: str = "postgres"
    connection_string: str
    table_name: str


class ConnectRequest(BaseModel):
    db_type: str = "postgres"
    connection_string: str
    table_name: str
    field_mapping: dict  # {"title": "name", "price": "price", ...}


class DatabaseStatus(BaseModel):
    connected: bool
    db_type: str | None = None
    table_name: str | None = None
    field_mapping: dict | None = None
    sync_status: str | None = None
    product_count: int | None = None
    last_synced_at: str | None = None
    error_message: str | None = None
    source_columns: list[str] | None = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _validate_conn_str(conn_str: str, db_type: str) -> str:
    normalized_type = db_type.strip().lower()
    if normalized_type == "postgres":
        valid = (
            conn_str.startswith("postgres://")
            or conn_str.startswith("postgresql://")
            or conn_str.startswith("postgresql+asyncpg://")
        )
        if not valid:
            raise HTTPException(
                status_code=422,
                detail={
                    "error": "invalid_connection_string",
                    "message": "Postgres connection string must start with postgresql:// - enter only the database URL, not the table name.",
                },
            )
    elif normalized_type == "mysql":
        valid = (
            conn_str.startswith("mysql://")
            or conn_str.startswith("mysql+pymysql://")
            or conn_str.startswith("mariadb://")
            or conn_str.startswith("mariadb+pymysql://")
        )
        if not valid:
            raise HTTPException(
                status_code=422,
                detail={
                    "error": "invalid_connection_string",
                    "message": "MySQL/MariaDB connection string must start with mysql:// or mariadb:// - enter only the database URL, not the table name.",
                },
            )
    else:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "invalid_connection_string",
                "message": "Unsupported database type. Choose PostgreSQL or MySQL/MariaDB.",
            },
        )
    if "," in conn_str or " table" in conn_str.lower():
        raise HTTPException(
            status_code=422,
            detail={
                "error": "invalid_connection_string",
                "message": "Connection string looks malformed - enter only the database URL, not the table name.",
            },
        )
    return normalized_type


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


async def _get_connection_row(session, client_id: str):
    result = await session.execute(
        sql_text("SELECT * FROM database_connections WHERE client_id = :cid"),
        {"cid": uuid.UUID(client_id)},
    )
    return result.fetchone()


def _validate_source_table(
    connection_string: str,
    table_name: str,
    db_type: str,
) -> None:
    if is_internal_app_table(connection_string, table_name, db_type=db_type):
        raise HTTPException(
            status_code=422,
            detail={
                "error": "invalid_source_table",
                "message": "ScubaSearch's internal app tables cannot be used as a database source. Connect an external catalog table instead.",
            },
        )


# ---------------------------------------------------------------------------
# POST /tables  — list tables for a connection string
# ---------------------------------------------------------------------------


class TablesRequest(BaseModel):
    db_type: str = "postgres"
    connection_string: str


@router.post("/tables")
async def list_tables(
    body: TablesRequest,
    request: Request,
    clerk_user_id: str = Depends(require_clerk_user),
) -> list[str]:
    _require_client_id(request)
    db_type = _validate_conn_str(body.connection_string, body.db_type)
    try:
        tables = (
            await __import__("asyncio")
            .get_event_loop()
            .run_in_executor(None, get_tables, body.connection_string, db_type)
        )
    except Exception as exc:
        if isinstance(exc, HTTPException):
            raise exc
        raise HTTPException(
            status_code=422,
            detail={
                "error": "connection_failed",
                "message": f"Could not connect: {str(exc)[:200]}",
            },
        )
    return tables


# ---------------------------------------------------------------------------
# POST /preview-columns
# ---------------------------------------------------------------------------


@router.post("/preview-columns")
async def preview_columns(
    body: PreviewRequest,
    request: Request,
    clerk_user_id: str = Depends(require_clerk_user),
) -> list[dict]:
    _require_client_id(request)
    db_type = _validate_conn_str(body.connection_string, body.db_type)
    _validate_source_table(body.connection_string, body.table_name, db_type)
    try:
        cols = (
            await __import__("asyncio")
            .get_event_loop()
            .run_in_executor(
                None, get_table_columns, body.connection_string, body.table_name, db_type
            )
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=422, detail={"error": "table_not_found", "message": str(exc)}
        )
    except Exception as exc:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "connection_failed",
                "message": f"Could not connect: {str(exc)[:200]}",
            },
        )
    return cols


# ---------------------------------------------------------------------------
# POST /connect
# ---------------------------------------------------------------------------


@router.post("/connect", status_code=201)
async def connect_database(
    body: ConnectRequest,
    request: Request,
    clerk_user_id: str = Depends(require_clerk_user),
) -> DatabaseStatus:
    client_id = _require_client_id(request)
    db_type = _validate_conn_str(body.connection_string, body.db_type)
    _validate_source_table(body.connection_string, body.table_name, db_type)

    # Test connection before saving
    try:
        await (
            __import__("asyncio")
            .get_event_loop()
            .run_in_executor(None, test_connection, body.connection_string, db_type)
        )
    except Exception as exc:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "connection_failed",
                "message": f"Could not connect: {str(exc)[:200]}",
            },
        )

    enc = encrypt_connection_string(body.connection_string)

    async with AsyncSessionLocal() as session:
        await session.execute(
            sql_text("DELETE FROM api_sync_connections WHERE client_id = :cid"),
            {"cid": uuid.UUID(client_id)},
        )
        existing = await _get_connection_row(session, client_id)
        if existing:
            await session.execute(
                sql_text("""
                    UPDATE database_connections
                    SET db_type=:db_type, connection_string_enc=:enc, table_name=:tbl,
                        field_mapping=:fm, sync_status='pending',
                        error_message=NULL, product_count=NULL, last_synced_at=NULL
                    WHERE client_id=:cid
                """),
                {
                    "db_type": db_type,
                    "enc": enc,
                    "tbl": body.table_name,
                    "fm": json.dumps(body.field_mapping),
                    "cid": uuid.UUID(client_id),
                },
            )
        else:
            await session.execute(
                sql_text("""
                    INSERT INTO database_connections
                        (client_id, db_type, connection_string_enc, table_name, field_mapping, sync_status)
                    VALUES (:cid, :db_type, :enc, :tbl, :fm, 'pending')
                """),
                {
                    "cid": uuid.UUID(client_id),
                    "db_type": db_type,
                    "enc": enc,
                    "tbl": body.table_name,
                    "fm": json.dumps(body.field_mapping),
                },
            )
        await session.commit()

    # Queue sync
    try:
        from workers.tasks import sync_external_database

        sync_external_database.delay(client_id)
    except Exception:
        logger.exception("db_sync_queue_failed client_id=%s", client_id)

    return DatabaseStatus(
        connected=True,
        db_type=db_type,
        table_name=body.table_name,
        field_mapping=body.field_mapping,
        sync_status="pending",
    )


# ---------------------------------------------------------------------------
# GET /status
# ---------------------------------------------------------------------------


@router.get("/status")
async def get_status(
    request: Request,
    clerk_user_id: str = Depends(require_clerk_user),
) -> DatabaseStatus:
    client_id = _require_client_id(request)
    async with AsyncSessionLocal() as session:
        row = await _get_connection_row(session, client_id)
    if not row:
        return DatabaseStatus(connected=False)
    return DatabaseStatus(
        connected=True,
        db_type=row.db_type,
        table_name=row.table_name,
        field_mapping=row.field_mapping,
        sync_status=row.sync_status,
        product_count=row.product_count,
        last_synced_at=row.last_synced_at.isoformat() if row.last_synced_at else None,
        error_message=row.error_message,
        source_columns=list(row.source_columns) if row.source_columns else None,
    )


# ---------------------------------------------------------------------------
# POST /sync
# ---------------------------------------------------------------------------


@router.post("/sync")
async def trigger_sync(
    request: Request,
    clerk_user_id: str = Depends(require_clerk_user),
) -> dict:
    client_id = _require_client_id(request)
    async with AsyncSessionLocal() as session:
        row = await _get_connection_row(session, client_id)
        if not row:
            raise HTTPException(status_code=404, detail={"error": "not_connected"})
        connection_string = decrypt_connection_string(row.connection_string_enc)
        _validate_source_table(connection_string, row.table_name, row.db_type or "postgres")
        if row.sync_status == "syncing":
            raise HTTPException(status_code=409, detail={"error": "already_syncing"})
        await session.execute(
            sql_text(
                "UPDATE database_connections SET sync_status='pending' WHERE client_id=:cid"
            ),
            {"cid": uuid.UUID(client_id)},
        )
        await session.commit()

    from workers.tasks import sync_external_database

    sync_external_database.delay(client_id)
    return {"queued": True}


# ---------------------------------------------------------------------------
# DELETE /disconnect
# ---------------------------------------------------------------------------


@router.delete("/disconnect")
async def disconnect_database(
    request: Request,
    clerk_user_id: str = Depends(require_clerk_user),
) -> dict:
    client_id = _require_client_id(request)
    async with AsyncSessionLocal() as session:
        row = await _get_connection_row(session, client_id)
        if not row:
            raise HTTPException(status_code=404, detail={"error": "not_connected"})
        await session.execute(
            sql_text("DELETE FROM database_connections WHERE client_id=:cid"),
            {"cid": uuid.UUID(client_id)},
        )
        await session.commit()
    return {"disconnected": True}
