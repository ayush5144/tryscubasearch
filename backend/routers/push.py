"""
Programmatic document push — API-key authenticated.

POST /api/v1/push/document  — embed and index a single OTT document immediately

This route uses Bearer API key auth (set by APIKeyMiddleware).  It is intentionally
NOT under /api/v1/documents or /api/v1/ingest to avoid the CLERK_AUTH_PREFIXES bypass.

Designed for scripts, CI pipelines, and OTT platform integrations that push catalog
updates programmatically without a Clerk browser session.
"""

import asyncio
import json
import logging
import os
import uuid

from fastapi import APIRouter, File, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel
from sqlalchemy import text as sql_text

from db.postgres import AsyncSessionLocal
from routers.ingest import (
    UPLOAD_DIR,
    _ALLOWED_EXTENSIONS,
    _EXTENSION_TO_FORMAT,
    _bulk_apply_partial_products,
    _bulk_upsert_products,
    _get_product_count,
    _parse_uploaded_file_sync,
)
from services.billing import check_product_limit, get_limits
from services.catalog_source import (
    has_api_sync_connection,
    has_database_connection,
    prefix_csv_id,
    switch_client_to_csv_source,
)
from services.embedding import embed
from services.meilisearch import add_documents, ensure_index
from workers.tasks import (
    _build_embed_text,
    _build_meilisearch_doc,
    _get_embed_config,
    _normalize_partial_dict,
    _normalize_product_dict,
    process_ingest_job,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/push", tags=["push"])


class DocumentPushRequest(BaseModel):
    id: str | None = None
    title: str | None = None
    description: str | None = None
    category: str | None = None  # genre
    tags: str | list[str] | None = None  # comma-separated or array
    actors: str | list[str] | None = None
    director: str | list[str] | None = None
    writer: str | list[str] | None = None
    content_type: str | None = None  # movie / series / short
    year: int | None = None
    language: str | None = None
    duration_mins: int | None = None
    image_url: str | None = None
    product_url: str | None = None  # content / watch URL


class DocumentPushResponse(BaseModel):
    id: str
    title: str
    indexed: bool = True


class BulkPushRequest(BaseModel):
    documents: list[DocumentPushRequest]
    mode: str = "append"


class WebhookPushRequest(BaseModel):
    documents: list[DocumentPushRequest] | None = None
    document: DocumentPushRequest | None = None
    mode: str = "append"
    event: str | None = None


class BulkPushResponse(BaseModel):
    job_id: str
    status: str
    mode: str
    total: int
    trigger: str


def _stringify_value(value: str | list[str] | None) -> str:
    if isinstance(value, list):
        return ", ".join(v.strip() for v in value if v and v.strip())
    return value or ""


async def _queue_bulk_json_ingest(
    *,
    client_id: str,
    documents: list[DocumentPushRequest],
    mode: str,
    trigger: str,
) -> BulkPushResponse:
    if mode not in {"replace", "append", "update"}:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "invalid_mode",
                "message": "Mode must be replace, append, or update.",
            },
        )
    if not documents:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "invalid_payload",
                "message": "At least one document is required.",
            },
        )

    switching_from_db = await has_database_connection(client_id)
    switching_from_api_pull = await has_api_sync_connection(client_id)
    switching_source = switching_from_db or switching_from_api_pull

    if switching_source and mode != "replace":
        mode = "replace"

    if not switching_source:
        ok, used, limit = await check_product_limit(client_id)
        if not ok:
            raise HTTPException(
                status_code=402,
                detail={
                    "error": "plan_limit_exceeded",
                    "message": "Upgrade your plan to index more titles",
                    "used": used,
                    "limit": limit,
                },
            )

    raw_documents = [doc.model_dump(exclude_none=True) for doc in documents]
    if mode == "update":
        parsed_products = []
        for raw in raw_documents:
            parsed = _normalize_partial_dict(raw)
            if parsed is not None:
                parsed_products.append(parsed)
    else:
        parsed_products = []
        for raw in raw_documents:
            parsed = _normalize_product_dict(raw)
            if parsed is not None:
                parsed_products.append(parsed)

    if switching_source:
        limits = await get_limits(client_id)
        maximum = limits["max_products"]
        incoming_count = len(parsed_products)
        if maximum != -1 and incoming_count > maximum:
            raise HTTPException(
                status_code=402,
                detail={
                    "error": "plan_limit_exceeded",
                    "message": "Upgrade your plan to index more titles",
                    "used": incoming_count,
                    "limit": maximum,
                },
            )
        if incoming_count == 0:
            raise HTTPException(
                status_code=400,
                detail={
                    "error": "invalid_catalog",
                    "message": "No valid titles found in the payload. Source was not switched.",
                },
            )

    if mode == "append":
        count = await _get_product_count(client_id)
        if count == 0:
            mode = "replace"

    if not parsed_products:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "invalid_catalog",
                "message": "No valid documents found in the payload.",
            },
        )

    job_id = str(uuid.uuid4())
    upload_path = os.path.join(UPLOAD_DIR, f"{job_id}.json")
    with open(upload_path, "w", encoding="utf-8") as fh:
        json.dump(raw_documents, fh, ensure_ascii=True)

    if switching_source:
        await switch_client_to_csv_source(client_id)

    async with AsyncSessionLocal() as pg_session:
        if mode == "replace":
            await pg_session.execute(
                sql_text("DELETE FROM products WHERE client_id = :cid"),
                {"cid": client_id},
            )
        if mode == "update":
            await _bulk_apply_partial_products(pg_session, client_id, parsed_products)
        else:
            await _bulk_upsert_products(pg_session, client_id, parsed_products)

        await pg_session.execute(
            sql_text(
                """
                INSERT INTO ingest_jobs
                    (id, client_id, status, total, processed, added_count, updated_count, file_format, trigger)
                VALUES
                    (:id, :client_id, 'queued', :total, 0, 0, 0, 'json', :trigger)
                """
            ),
            {
                "id": job_id,
                "client_id": client_id,
                "total": len(parsed_products),
                "trigger": "rest_api_push" if trigger == "api" else "webhook_sync",
            },
        )
        await pg_session.commit()

    process_ingest_job.delay(job_id, client_id, upload_path, mode, "json")
    logger.info(
        "push_bulk queued job=%s client=%s trigger=%s mode=%s total=%d",
        job_id,
        client_id,
        trigger,
        mode,
        len(parsed_products),
    )
    return BulkPushResponse(
        job_id=job_id,
        status="queued",
        mode=mode,
        total=len(parsed_products),
        trigger=trigger,
    )


@router.post("/document", response_model=DocumentPushResponse, status_code=200)
async def push_document(req: DocumentPushRequest, request: Request):
    """Embed and index a single document immediately (no Celery job).

    Accepts Bearer API key.  client_id is derived server-side from the key.
    """
    client_id: str = request.state.client_id

    await switch_client_to_csv_source(client_id)

    ok, used, limit = await check_product_limit(client_id)
    if not ok:
        raise HTTPException(
            status_code=402,
            detail={
                "error": "plan_limit_exceeded",
                "message": "Upgrade your plan to index more titles",
                "used": used,
                "limit": limit,
            },
        )

    if not req.title or not req.title.strip():
        raise HTTPException(
            status_code=422,
            detail={"error": "invalid_payload", "message": "Title is required."},
        )

    raw_doc_id = req.id if req.id else "doc_" + uuid.uuid4().hex[:16]
    doc_id = prefix_csv_id(raw_doc_id)
    product_dict = {
        "id": doc_id,
        "title": req.title,
        "description": req.description or "",
        "category": req.category or "",
        "tags": _stringify_value(req.tags),
        "actors": _stringify_value(req.actors),
        "director": _stringify_value(req.director),
        "writer": _stringify_value(req.writer),
        "content_type": req.content_type or "",
        "year": req.year,
        "language": req.language or "",
        "duration_mins": req.duration_mins,
        "image_url": req.image_url or "",
        "product_url": req.product_url or "",
    }
    embed_fields = _get_embed_config(client_id)
    embed_text = _build_embed_text(product_dict, embed_fields)

    try:
        vector = await embed(embed_text)
    except Exception as exc:
        logger.error(
            "push_document embed_error client=%s doc=%s: %s", client_id, doc_id, exc
        )
        raise HTTPException(
            status_code=502,
            detail={
                "error": "embedding_failed",
                "message": "Could not generate embedding.",
            },
        )

    try:
        await ensure_index(client_id)
    except Exception as exc:
        logger.error("push_document ensure_index_error client=%s: %s", client_id, exc)
        raise HTTPException(
            status_code=502,
            detail={
                "error": "index_setup_failed",
                "message": "Could not prepare search index.",
            },
        )

    document = _build_meilisearch_doc(product_dict, vector)

    try:
        await add_documents(client_id, [document])
    except Exception as exc:
        logger.error(
            "push_document index_error client=%s doc=%s: %s", client_id, doc_id, exc
        )
        raise HTTPException(
            status_code=502,
            detail={
                "error": "index_write_failed",
                "message": "Could not write to search index.",
            },
        )

    # Persist to Postgres (non-fatal)
    try:
        async with AsyncSessionLocal() as pg:
            await pg.execute(
                sql_text("""
                    INSERT INTO products (
                        id, client_id, external_id, title, description, price,
                        category, tags, image_url, product_url,
                        actors, director, writer, content_type, year, language, duration_mins,
                        last_indexed_at, created_at, updated_at
                    )
                    VALUES (
                        gen_random_uuid(), :client_id, :external_id, :title, :description, NULL,
                        :category, :tags, :image_url, :product_url,
                        :actors, :director, :writer, :content_type, :year, :language, :duration_mins,
                        NOW(), NOW(), NOW()
                    )
                    ON CONFLICT (client_id, external_id) DO UPDATE SET
                        title           = EXCLUDED.title,
                        description     = EXCLUDED.description,
                        category        = EXCLUDED.category,
                        tags            = EXCLUDED.tags,
                        image_url       = EXCLUDED.image_url,
                        product_url     = EXCLUDED.product_url,
                        actors          = EXCLUDED.actors,
                        director        = EXCLUDED.director,
                        writer          = EXCLUDED.writer,
                        content_type    = EXCLUDED.content_type,
                        year            = EXCLUDED.year,
                        language        = EXCLUDED.language,
                        duration_mins   = EXCLUDED.duration_mins,
                        last_indexed_at = NOW(),
                        updated_at      = NOW()
                """),
                {
                    "client_id": client_id,
                    "external_id": doc_id,
                    "title": req.title,
                    "description": req.description,
                    "category": req.category,
                    "tags": _stringify_value(req.tags) or None,
                    "image_url": req.image_url,
                    "product_url": req.product_url,
                    "actors": _stringify_value(req.actors) or None,
                    "director": _stringify_value(req.director) or None,
                    "writer": _stringify_value(req.writer) or None,
                    "content_type": req.content_type,
                    "year": req.year,
                    "language": req.language,
                    "duration_mins": req.duration_mins,
                },
            )
            await pg.commit()
    except Exception as exc:
        logger.warning(
            "push_document pg_write_failed client=%s doc=%s (non-fatal): %s",
            client_id,
            doc_id,
            exc,
        )

    return DocumentPushResponse(id=doc_id, title=req.title, indexed=True)


@router.post("/documents", response_model=BulkPushResponse, status_code=202)
async def push_documents(req: BulkPushRequest, request: Request):
    """REST ingest / push method for bulk JSON document sync."""
    client_id: str = request.state.client_id
    return await _queue_bulk_json_ingest(
        client_id=client_id,
        documents=req.documents,
        mode=req.mode,
        trigger="api",
    )


@router.post("/webhook", response_model=BulkPushResponse, status_code=202)
async def push_webhook(req: WebhookPushRequest, request: Request):
    """Webhook alias for bulk JSON document sync."""
    client_id: str = request.state.client_id
    documents = list(req.documents or [])
    if req.document is not None:
        documents.append(req.document)
    return await _queue_bulk_json_ingest(
        client_id=client_id,
        documents=documents,
        mode=req.mode,
        trigger="webhook",
    )


@router.post("/file", response_model=BulkPushResponse, status_code=202)
async def push_file(
    request: Request,
    file: UploadFile = File(...),
    mode: str = Query(default="append", pattern="^(replace|append|update)$"),
):
    """API-key authenticated catalog file upload. Accepts .csv, .json, or .ndjson."""
    client_id: str = request.state.client_id

    filename = file.filename or ""
    if filename.endswith(".ndjson"):
        ext = ".ndjson"
    else:
        _, ext = os.path.splitext(filename.lower())

    if ext not in _ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "invalid_format",
                "message": "File must be .csv, .json, or .ndjson",
            },
        )

    file_format = _EXTENSION_TO_FORMAT[ext]

    switching_from_db = await has_database_connection(client_id)
    switching_from_api_pull = await has_api_sync_connection(client_id)
    switching_source = switching_from_db or switching_from_api_pull

    if switching_source and mode != "replace":
        mode = "replace"

    if not switching_source:
        ok, used, limit = await check_product_limit(client_id)
        if not ok:
            raise HTTPException(
                status_code=402,
                detail={
                    "error": "plan_limit_exceeded",
                    "message": "Upgrade your plan to index more titles",
                    "used": used,
                    "limit": limit,
                },
            )

    if mode == "append":
        count = await _get_product_count(client_id)
        if count == 0:
            mode = "replace"

    job_id = str(uuid.uuid4())
    upload_path = os.path.join(UPLOAD_DIR, f"{job_id}{ext}")
    contents = await file.read()
    with open(upload_path, "wb") as fh:
        fh.write(contents)

    loop = asyncio.get_event_loop()
    try:
        parsed_products = await loop.run_in_executor(
            None, _parse_uploaded_file_sync, upload_path, file_format, mode
        )
    except Exception:
        parsed_products = []

    if switching_source:
        limits = await get_limits(client_id)
        maximum = limits["max_products"]
        if maximum != -1 and len(parsed_products) > maximum:
            raise HTTPException(
                status_code=402,
                detail={
                    "error": "plan_limit_exceeded",
                    "message": "Upgrade your plan to index more titles",
                    "used": len(parsed_products),
                    "limit": maximum,
                },
            )
        if not parsed_products:
            raise HTTPException(
                status_code=400,
                detail={
                    "error": "invalid_catalog",
                    "message": "No valid titles found in the file. Source was not switched.",
                },
            )

    if not parsed_products:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "invalid_catalog",
                "message": "No valid documents found in the file.",
            },
        )

    if switching_source:
        await switch_client_to_csv_source(client_id)

    async with AsyncSessionLocal() as pg_session:
        if mode == "replace":
            await pg_session.execute(
                sql_text("DELETE FROM products WHERE client_id = :cid"),
                {"cid": client_id},
            )
        if mode == "update":
            await _bulk_apply_partial_products(pg_session, client_id, parsed_products)
        else:
            await _bulk_upsert_products(pg_session, client_id, parsed_products)

        await pg_session.execute(
            sql_text(
                """
                INSERT INTO ingest_jobs
                    (id, client_id, status, total, processed, added_count, updated_count, file_format, trigger)
                VALUES
                    (:id, :client_id, 'queued', :total, 0, 0, 0, :file_format, 'rest_api_push')
                """
            ),
            {
                "id": job_id,
                "client_id": client_id,
                "total": len(parsed_products),
                "file_format": file_format,
            },
        )
        await pg_session.commit()

    process_ingest_job.delay(job_id, client_id, upload_path, mode, file_format)
    logger.info(
        "push_file queued job=%s client=%s mode=%s format=%s total=%d",
        job_id,
        client_id,
        mode,
        file_format,
        len(parsed_products),
    )
    return BulkPushResponse(
        job_id=job_id,
        status="queued",
        mode=mode,
        total=len(parsed_products),
        trigger="file_push",
    )
