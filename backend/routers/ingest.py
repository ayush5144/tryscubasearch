"""
Ingest router — Phase 2 / Phase 3 / Phase 6.8.

POST /api/v1/ingest/csv       — upload CSV, create ingest job, enqueue Celery task
GET  /api/v1/ingest/jobs/{id} — poll job progress
POST /api/v1/products         — single-product upsert (embed + index in-request, no Celery)

client_id is now derived from the API key via auth middleware (request.state.client_id).
The test_client_id Form field has been removed as of Phase 3.

Phase 6.8: parsed rows are bulk-upserted into the Postgres `products` table before
the Celery job is queued.  Meilisearch remains the search index; Postgres is now
the durable source of truth.
"""

import asyncio
import json
import logging
import os
import tempfile
import uuid

import meilisearch
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from middleware.clerk_auth import require_clerk_user
from meilisearch.errors import MeilisearchApiError
from pydantic import BaseModel
from sqlalchemy import text as sql_text

from config import settings
from db.postgres import AsyncSessionLocal
from services.billing import check_product_limit, get_limits
from services.catalog_source import (
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
    process_ingest_job,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/ingest", tags=["ingest"])

# Temp dir for uploaded CSVs (Celery worker reads from here)
UPLOAD_DIR = os.path.join(tempfile.gettempdir(), "scubasearch_uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)


async def _get_product_count(client_id: str) -> int:
    """
    Return the current document count for the client's Meilisearch index.
    Returns 0 if the index does not exist yet.

    All Meilisearch SDK calls are wrapped with run_in_executor because the SDK
    is synchronous and must not block the event loop.
    """

    def _fetch_stats():
        client = meilisearch.Client(
            settings.meilisearch_host, settings.meilisearch_master_key
        )
        index = client.index(f"products_{client_id}")
        return index.get_stats()

    loop = asyncio.get_event_loop()
    try:
        stats = await loop.run_in_executor(None, _fetch_stats)
        return getattr(stats, "number_of_documents", 0)
    except MeilisearchApiError as exc:
        if exc.code == "index_not_found":
            return 0
        logger.warning(
            f"_get_product_count: unexpected Meilisearch error for client {client_id}: {exc}"
        )
        return 0
    except Exception as exc:
        logger.warning(
            f"_get_product_count: failed to fetch stats for client {client_id}: {exc}"
        )
        return 0


async def _bulk_upsert_products(
    session,
    client_id: str,
    products: list[dict],
) -> None:
    """
    Bulk-upsert parsed product dicts into the Postgres `products` table.

    Each product dict is expected to have the shape produced by
    _normalize_product_dict():
        id        — the external id from the CSV (stored as external_id)
        title, description, category, tags (list[str]),
        image_url, product_url

    On conflict (client_id, external_id):
        - All mutable fields are overwritten.
        - last_indexed_at is set to NULL to force re-embedding on next worker run.
        - Our internal UUID (products.id) is never updated — it is stable.

    Parsed catalog rows now always carry a stable external_id:
        - explicit source ids are preserved
        - no-id catalogs get a deterministic fallback fingerprint
          based on title + product_url + year + content_type + language

    The NULL external_id insert branch is kept only as a defensive fallback for
    malformed internal callers. Normal CSV/JSON/NDJSON uploads should always
    upsert through (client_id, external_id).
    """
    if not products:
        return

    for p in products:
        external_id = p.get("id") or None
        if external_id:
            external_id = prefix_csv_id(str(external_id).strip())
        title = p.get("title", "")
        description = p.get("description") or None
        category = p.get("category") or None

        # tags is a list[str] in normalized product dicts; store as CSV string
        raw_tags = p.get("tags", [])
        if isinstance(raw_tags, list):
            tags_str = ", ".join(raw_tags)
        else:
            tags_str = str(raw_tags) if raw_tags else None

        image_url = p.get("image_url") or None
        product_url = p.get("product_url") or None
        actors = p.get("actors") or None
        director = p.get("director") or None
        writer = p.get("writer") or None
        content_type = p.get("content_type") or None
        year = p.get("year")
        language = p.get("language") or None
        duration_mins = p.get("duration_mins")

        # tasks.py already normalized this to either a user-supplied id or a
        # deterministic fallback fingerprint, so we can always treat it as the
        # dedup key when present.

        if external_id:
            await session.execute(
                sql_text(
                    """
                    INSERT INTO products (
                        id, client_id, external_id, title, description,
                        category, tags, image_url, product_url,
                        actors, director, writer, content_type, year, language, duration_mins,
                        last_indexed_at, created_at, updated_at
                    )
                    VALUES (
                        gen_random_uuid(), :client_id, :external_id, :title,
                        :description, :category, :tags, :image_url,
                        :product_url,
                        :actors, :director, :writer, :content_type, :year, :language, :duration_mins,
                        NULL, NOW(), NOW()
                    )
                    ON CONFLICT (client_id, external_id) DO UPDATE SET
                        title          = EXCLUDED.title,
                        description    = EXCLUDED.description,
                        category       = EXCLUDED.category,
                        tags           = EXCLUDED.tags,
                        image_url      = EXCLUDED.image_url,
                        product_url    = EXCLUDED.product_url,
                        actors         = EXCLUDED.actors,
                        director       = EXCLUDED.director,
                        writer         = EXCLUDED.writer,
                        content_type   = EXCLUDED.content_type,
                        year           = EXCLUDED.year,
                        language       = EXCLUDED.language,
                        duration_mins  = EXCLUDED.duration_mins,
                        last_indexed_at = NULL,
                        updated_at     = NOW()
                    """
                ),
                {
                    "client_id": client_id,
                    "external_id": external_id,
                    "title": title,
                    "description": description,
                    "category": category,
                    "tags": tags_str,
                    "image_url": image_url,
                    "product_url": product_url,
                    "actors": actors,
                    "director": director,
                    "writer": writer,
                    "content_type": content_type,
                    "year": year,
                    "language": language,
                    "duration_mins": duration_mins,
                },
            )
        else:
            # No stable external id — plain INSERT, no deduplication.
            await session.execute(
                sql_text(
                    """
                    INSERT INTO products (
                        id, client_id, external_id, title, description,
                        category, tags, image_url, product_url,
                        actors, director, writer, content_type, year, language, duration_mins,
                        last_indexed_at, created_at, updated_at
                    )
                    VALUES (
                        gen_random_uuid(), :client_id, NULL, :title,
                        :description, :category, :tags, :image_url,
                        :product_url,
                        :actors, :director, :writer, :content_type, :year, :language, :duration_mins,
                        NULL, NOW(), NOW()
                    )
                    """
                ),
                {
                    "client_id": client_id,
                    "title": title,
                    "description": description,
                    "category": category,
                    "tags": tags_str,
                    "image_url": image_url,
                    "product_url": product_url,
                    "actors": actors,
                    "director": director,
                    "writer": writer,
                    "content_type": content_type,
                    "year": year,
                    "language": language,
                    "duration_mins": duration_mins,
                },
            )


async def _bulk_apply_partial_products(
    session,
    client_id: str,
    products: list[dict],
) -> None:
    """
    Apply update-mode partial documents to existing Postgres rows.

    Only fields present in each parsed product dict are updated. Missing fields
    are left untouched. Rows with unknown ids are ignored.
    """
    if not products:
        return

    allowed_fields = {
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
    }

    for p in products:
        external_id = p.get("id") or None
        if not external_id:
            continue
        external_id = prefix_csv_id(str(external_id).strip())

        set_clauses: list[str] = []
        params: dict[str, object] = {
            "client_id": client_id,
            "external_id": external_id,
        }

        for field in allowed_fields:
            if field not in p:
                continue
            value = p[field]
            if field == "tags" and isinstance(value, list):
                value = ", ".join(str(tag).strip() for tag in value if str(tag).strip())
            set_clauses.append(f"{field} = :{field}")
            params[field] = value

        if not set_clauses:
            continue

        set_clauses.append("last_indexed_at = NULL")
        set_clauses.append("updated_at = NOW()")

        await session.execute(
            sql_text(
                f"""
                UPDATE products
                SET {", ".join(set_clauses)}
                WHERE client_id = :client_id
                  AND external_id = :external_id
                """
            ),
            params,
        )


def _parse_uploaded_file_sync(
    upload_path: str,
    file_format: str,
    mode: str,
    field_mapping: dict[str, str] | None = None,
) -> list[dict]:
    """
    Parse the uploaded file synchronously and return normalized product dicts.
    This runs in a thread-pool executor so it does not block the event loop.

    For update mode we use the partial parser; for replace/append we use the
    full parser.  Both return a list of dicts.
    """
    # Import here to keep tasks module as the single source of parsing truth.
    from workers.tasks import _load_products, _load_partial_products  # noqa: PLC0415

    if mode == "update":
        try:
            return _load_partial_products(upload_path, file_format, field_mapping)
        except ValueError:
            # Update mode with no id column — return empty list; the Celery
            # worker will fail the job with a proper error message.
            return []
    else:
        return _load_products(upload_path, file_format, field_mapping)


def _parse_field_mapping(raw_mapping: str | None) -> dict[str, str] | None:
    if not raw_mapping:
        return None

    try:
        parsed = json.loads(raw_mapping)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "invalid_field_mapping",
                "message": "Field mapping must be valid JSON.",
            },
        ) from exc

    if not isinstance(parsed, dict):
        raise HTTPException(
            status_code=400,
            detail={
                "error": "invalid_field_mapping",
                "message": "Field mapping must be a JSON object.",
            },
        )

    mapping: dict[str, str] = {}
    for source, target in parsed.items():
        source_key = str(source or "").strip()
        target_key = str(target or "").strip()
        if not source_key or not target_key:
            continue
        mapping[source_key] = target_key

    return mapping or None


class JobStatusResponse(BaseModel):
    job_id: str
    client_id: str
    status: str
    total: int
    processed: int
    added_count: int = 0
    updated_count: int = 0
    skipped_count: int | None = None
    error_log: str | None


_ALLOWED_EXTENSIONS = {".csv", ".json", ".ndjson"}
_EXTENSION_TO_FORMAT = {".csv": "csv", ".json": "json", ".ndjson": "ndjson"}


@router.post("/csv")
async def upload_csv(
    request: Request,
    file: UploadFile = File(...),
    field_mapping: str | None = Form(default=None),
    mode: str = Query(default="replace", pattern="^(replace|append|update)$"),
    clerk_user_id: str = Depends(require_clerk_user),
):
    """
    Upload a product catalog file (.csv, .json, or .ndjson) and start a
    background ingest job.

    Expected fields: id, title, description, tags, category, image_url, product_url
    (OTT content — no pricing required)

    Requires: Bearer token authentication (Clerk JWT)
    client_id is derived server-side from the Clerk JWT.

    After saving the file to disk, rows are parsed and bulk-upserted
    into the Postgres `products` table (last_indexed_at = NULL on every row) so
    Postgres becomes the durable source of truth before the Celery job starts.
    """
    filename = file.filename or ""
    # Determine extension — support double-extension .ndjson before .json check
    if filename.endswith(".ndjson"):
        ext = ".ndjson"
    else:
        _, ext = os.path.splitext(filename.lower())

    if ext not in _ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail="File must be .csv, .json, or .ndjson",
        )

    file_format = _EXTENSION_TO_FORMAT[ext]
    parsed_field_mapping = _parse_field_mapping(field_mapping)

    # client_id is set by APIKeyMiddleware — guaranteed present on this route.
    client_id: str = request.state.client_id
    switching_from_db = await has_database_connection(client_id)

    if switching_from_db and mode != "replace":
        logger.info(
            "upload_csv: switching client %s from db to csv - forcing replace mode",
            client_id,
        )
        mode = "replace"

    # Plan enforcement: for an active CSV/manual catalog, use the current live
    # count. On a DB -> CSV switch, validate against the incoming file size
    # after parsing because the old DB catalog is about to be replaced.
    if not switching_from_db:
        ok, used, limit = await check_product_limit(client_id)
        if not ok:
            raise HTTPException(
                status_code=402,
                detail={
                    "error": "plan_limit_exceeded",
                    "message": "Upgrade your plan to upload more titles",
                    "used": used,
                    "limit": limit,
                },
            )

    # Append mode on an empty index would fail at the Meilisearch level because
    # add_documents() requires the index to exist with correct settings applied.
    # Override to replace so the worker sets up the index from scratch.
    if mode == "append":
        count = await _get_product_count(client_id)
        if count == 0:
            logger.info(
                f"upload_csv: client {client_id} requested append on empty index — "
                "overriding mode to replace"
            )
            mode = "replace"

    # Save uploaded file to temp dir, preserving the original extension so the
    # Celery worker can re-detect format from the path if needed.
    job_id = str(uuid.uuid4())
    upload_path = os.path.join(UPLOAD_DIR, f"{job_id}{ext}")
    contents = await file.read()
    with open(upload_path, "wb") as fh:
        fh.write(contents)

    # ------------------------------------------------------------------
    # Phase 6.8: parse the file and bulk-upsert rows into Postgres BEFORE
    # queueing Celery.  This makes Postgres the source of truth so the
    # worker can read from DB instead of re-parsing the file.
    #
    # Parsing runs in a thread-pool executor (the parse functions are
    # synchronous I/O — they must not block the async event loop).
    # Errors here are non-fatal: log and continue — the Celery worker will
    # re-parse from the file as a fallback.
    # ------------------------------------------------------------------
    loop = asyncio.get_event_loop()
    try:
        parsed_products = await loop.run_in_executor(
            None,
            _parse_uploaded_file_sync,
            upload_path,
            file_format,
            mode,
            parsed_field_mapping,
        )
        if switching_from_db:
            limits = await get_limits(client_id)
            maximum = limits["max_products"]
            incoming_count = len(parsed_products)
            if maximum != -1 and incoming_count > maximum:
                raise HTTPException(
                    status_code=402,
                    detail={
                        "error": "plan_limit_exceeded",
                        "message": "Upgrade your plan to upload more titles",
                        "used": incoming_count,
                        "limit": maximum,
                    },
                )
            if incoming_count == 0:
                raise HTTPException(
                    status_code=400,
                    detail={
                        "error": "invalid_catalog",
                        "message": "No valid titles found in the upload. Source was not switched.",
                    },
                )
        if parsed_products:
            if switching_from_db:
                await switch_client_to_csv_source(client_id)
            async with AsyncSessionLocal() as pg_session:
                # Replace mode: wipe existing Postgres rows first so Postgres
                # stays in sync with what Meilisearch will hold after the swap.
                if mode == "replace":
                    await pg_session.execute(
                        sql_text("DELETE FROM products WHERE client_id = :cid"),
                        {"cid": client_id},
                    )
                if mode == "update":
                    await _bulk_apply_partial_products(
                        pg_session, client_id, parsed_products
                    )
                else:
                    await _bulk_upsert_products(pg_session, client_id, parsed_products)
                await pg_session.commit()
            logger.info(
                f"upload_csv: upserted {len(parsed_products)} rows into products "
                f"table for client {client_id} (job {job_id})"
            )
        else:
            logger.info(
                f"upload_csv: no rows parsed from {file_format.upper()} "
                f"(job {job_id}) — Celery worker will handle validation"
            )
    except Exception as exc:
        # Non-fatal: Celery worker will fall back to parsing the file itself.
        logger.warning(
            f"upload_csv: Postgres bulk-upsert failed (non-fatal) for job {job_id}: {exc}"
        )

    # Create ingest_jobs row using the real client_id from auth.
    # A stub client row is upserted for Phase 3 testing — this is replaced by
    # real Clerk auth in Phase 5 where clients are created at signup.
    async with AsyncSessionLocal() as session:
        await session.execute(
            sql_text(
                """
                INSERT INTO clients (id, email, store_name)
                VALUES (:id, :email, :store)
                ON CONFLICT (id) DO NOTHING
                """
            ),
            {
                "id": client_id,
                "email": f"{client_id}@dev.local",
                "store": client_id,
            },
        )
        await session.execute(
            sql_text(
                """
                INSERT INTO ingest_jobs (id, client_id, status, total, processed, file_format, trigger)
                VALUES (:id, :client_id, 'queued', 0, 0, :file_format, 'manual_upload')
                """
            ),
            {
                "id": job_id,
                "client_id": client_id,
                "file_format": file_format,
            },
        )
        await session.commit()

    # Enqueue Celery task with the (possibly overridden) mode and file format.
    # The file is still passed — the worker reads from Postgres first and uses
    # the file only as a fallback if the DB returns zero rows.
    process_ingest_job.delay(
        job_id,
        client_id,
        upload_path,
        mode,
        file_format,
        parsed_field_mapping,
    )

    return {
        "job_id": job_id,
        "client_id": client_id,
        "status": "queued",
        "message": f"Ingest job {job_id} queued. Poll GET /api/v1/ingest/jobs/{job_id} for progress.",
    }


@router.get("/jobs/{job_id}", response_model=JobStatusResponse)
async def get_job_status(job_id: str, clerk_user_id: str = Depends(require_clerk_user)):
    """Poll ingest job progress."""
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            sql_text(
                """
                SELECT id, client_id, status, total, processed,
                       added_count, updated_count, skipped_count, error_log
                FROM ingest_jobs
                WHERE id = :id
                """
            ),
            {"id": job_id},
        )
        row = result.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Job not found")

    return JobStatusResponse(
        job_id=str(row.id),
        client_id=str(row.client_id),
        status=row.status,
        total=row.total,
        processed=row.processed,
        added_count=row.added_count or 0,
        updated_count=row.updated_count or 0,
        skipped_count=row.skipped_count,
        error_log=row.error_log,
    )


# ---------------------------------------------------------------------------
# Single-product upsert
# ---------------------------------------------------------------------------

products_router = APIRouter(prefix="/api/v1/documents", tags=["documents"])


class ProductUpsertRequest(BaseModel):
    id: str | None = None
    title: str
    description: str | None = None
    category: str | None = None
    tags: str | None = None  # comma-separated string
    image_url: str | None = None
    product_url: str | None = None
    actors: str | None = None
    director: str | None = None
    writer: str | None = None
    content_type: str | None = None
    year: int | None = None
    language: str | None = None
    duration_mins: int | None = None


class ProductUpsertResponse(BaseModel):
    id: str
    title: str
    indexed: bool = True


@products_router.post("", response_model=ProductUpsertResponse, status_code=200)
async def upsert_product(
    req: ProductUpsertRequest,
    request: Request,
    clerk_user_id: str = Depends(require_clerk_user),
):
    """Embed and index a single product immediately (no Celery job).

    Idempotent: re-sending the same id overwrites the existing document in
    Meilisearch (upsert semantics via add_documents with primaryKey=id).

    Phase 6.8: the product is also written to the Postgres `products` table
    with last_indexed_at = NOW() (it is indexed in this same request).

    Requires: Authorization: Bearer <api_key>
    client_id is derived server-side from the API key — never from the request body.
    """
    client_id: str = request.state.client_id

    await switch_client_to_csv_source(client_id)

    # Plan enforcement — same gate as CSV upload.
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

    # Stable id: caller-supplied or a deterministic short uuid prefixed "prod_".
    raw_product_id = req.id if req.id is not None else "prod_" + uuid.uuid4().hex[:16]
    product_id = prefix_csv_id(raw_product_id)

    # Build the text to embed using client's embed_config (same as Celery worker)
    tags_val = (
        req.tags
        if isinstance(req.tags, str)
        else (", ".join(req.tags) if req.tags else "")
    )
    product_dict = {
        "title": req.title,
        "description": req.description or "",
        "category": req.category or "",
        "tags": tags_val,
        "image_url": req.image_url or "",
        "product_url": req.product_url or "",
        "actors": req.actors or "",
        "director": req.director or "",
        "writer": req.writer or "",
        "content_type": req.content_type or "",
        "year": req.year,
        "language": req.language or "",
        "duration_mins": req.duration_mins,
    }
    embed_fields = _get_embed_config(client_id)
    embed_text = _build_embed_text(product_dict, embed_fields)

    try:
        vector = await embed(embed_text)
    except Exception as exc:
        logger.error(
            "product_upsert_embed_error client_id=%s product_id=%s: %s",
            client_id,
            product_id,
            exc,
        )
        raise HTTPException(
            status_code=502,
            detail={
                "error": "embedding_failed",
                "message": "Could not generate embedding. Try again shortly.",
            },
        )

    # Ensure the Meilisearch index exists with correct settings before writing.
    # ensure_index is idempotent — safe to call on every upsert.
    try:
        await ensure_index(client_id)
    except Exception as exc:
        logger.error(
            "product_upsert_ensure_index_error client_id=%s: %s", client_id, exc
        )
        raise HTTPException(
            status_code=502,
            detail={
                "error": "index_setup_failed",
                "message": "Could not prepare the search index. Try again shortly.",
            },
        )

    document = _build_meilisearch_doc({"id": product_id, **product_dict}, vector)

    try:
        await add_documents(client_id, [document])
    except Exception as exc:
        logger.error(
            "product_upsert_index_error client_id=%s product_id=%s: %s",
            client_id,
            product_id,
            exc,
        )
        raise HTTPException(
            status_code=502,
            detail={
                "error": "index_write_failed",
                "message": "Could not write product to the search index. Try again shortly.",
            },
        )

    # ------------------------------------------------------------------
    # Phase 6.8: persist to Postgres with last_indexed_at = NOW().
    # The product was just indexed so it is immediately fresh.
    # Non-fatal: log and continue if this fails — Meilisearch is the
    # authoritative index for search; Postgres is for management UI.
    # ------------------------------------------------------------------
    try:
        async with AsyncSessionLocal() as pg_session:
            await pg_session.execute(
                sql_text(
                    """
                    INSERT INTO products (
                        id, client_id, external_id, title, description,
                        category, tags, image_url, product_url,
                        actors, director, writer, content_type, year, language, duration_mins,
                        last_indexed_at, created_at, updated_at
                    )
                    VALUES (
                        gen_random_uuid(), :client_id, :external_id, :title,
                        :description, :category, :tags, :image_url,
                        :product_url,
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
                    """
                ),
                {
                    "client_id": client_id,
                    "external_id": product_id,  # caller-supplied id is the external key
                    "title": req.title,
                    "description": req.description,
                    "category": req.category,
                    "tags": tags_val or None,
                    "image_url": req.image_url,
                    "product_url": req.product_url,
                    "actors": req.actors,
                    "director": req.director,
                    "writer": req.writer,
                    "content_type": req.content_type,
                    "year": req.year,
                    "language": req.language,
                    "duration_mins": req.duration_mins,
                },
            )
            await pg_session.commit()
    except Exception as exc:
        logger.warning(
            "product_upsert_pg_write_failed client_id=%s product_id=%s (non-fatal): %s",
            client_id,
            product_id,
            exc,
        )

    return ProductUpsertResponse(id=product_id, title=req.title, indexed=True)
