"""
Documents CRUD router — Phase 6.8 (renamed from products for OTT pivot).

Endpoints (all require Clerk JWT auth):

  GET    /api/v1/documents          — paginated product list from Postgres
  PUT    /api/v1/documents/{id}     — update editable fields; smart sync strategy
  DELETE /api/v1/documents/{id}     — delete from Postgres + Meilisearch
  POST   /api/v1/documents/reindex  — queue Celery job to re-index stale products

client_id is always resolved from the Clerk JWT (request.state.client_id) — never
from the request body.

Meilisearch SDK calls use run_in_executor because the SDK is synchronous.
"""

import asyncio
import logging
import uuid

import meilisearch
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy import text as sql_text

from config import settings
from db.postgres import AsyncSessionLocal
from middleware.clerk_auth import require_clerk_user
from services.cache import get_redis
from workers.tasks import reindex_stale_products

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/documents", tags=["documents"])

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_VECTOR_FIELDS = frozenset({"title", "description", "tags", "category"})
_NON_VECTOR_FIELDS = frozenset(
    {
        "actors",
        "director",
        "writer",
        "content_type",
        "language",
        "image_url",
        "product_url",
        "year",
        "duration_mins",
    }
)
_MUTABLE_FIELDS = _NON_VECTOR_FIELDS
_EDITABLE_FIELDS = _VECTOR_FIELDS | _NON_VECTOR_FIELDS


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


async def _flush_cache(client_id: str) -> None:
    """Flush all search cache keys for this client from Redis DB1."""
    try:
        r = get_redis(db=1)
        pattern = f"search:{client_id}:*"
        cursor = 0
        deleted = 0
        while True:
            cursor, keys = await r.scan(cursor, match=pattern, count=100)
            if keys:
                await r.delete(*keys)
                deleted += len(keys)
            if cursor == 0:
                break
        logger.info("products_cache_flush client_id=%s deleted=%d", client_id, deleted)
    except Exception:
        logger.exception("products_cache_flush_error client_id=%s", client_id)


def _get_meili() -> meilisearch.Client:
    return meilisearch.Client(
        settings.meilisearch_host, settings.meilisearch_master_key
    )


async def _meili_update_documents(client_id: str, docs: list[dict]) -> None:
    """Partial-update documents in Meilisearch (no re-embed). Uses run_in_executor."""
    meili = _get_meili()
    index_name = f"products_{client_id}"

    def _call():
        index = meili.index(index_name)
        task = index.update_documents(docs)
        meili.wait_for_task(task.task_uid, timeout_in_ms=10_000)

    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _call)


async def _meili_delete_document(client_id: str, doc_id: str) -> None:
    """Delete a single document from Meilisearch. Uses run_in_executor."""
    meili = _get_meili()
    index_name = f"products_{client_id}"

    def _call():
        index = meili.index(index_name)
        task = index.delete_document(doc_id)
        meili.wait_for_task(task.task_uid, timeout_in_ms=10_000)

    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _call)


def _row_to_dict(row) -> dict:
    """Convert a DB row to a product dict suitable for API responses."""
    return {
        "id": str(row.id),
        "external_id": row.external_id,
        "title": row.title,
        "description": row.description,
                "category": row.category,
        "tags": row.tags,
        "image_url": row.image_url,
        "product_url": row.product_url,
        "actors": row.actors,
        "director": row.director,
        "writer": row.writer,
        "content_type": row.content_type,
        "year": row.year,
        "language": row.language,
        "duration_mins": row.duration_mins,
        "last_indexed_at": row.last_indexed_at.isoformat()
        if row.last_indexed_at
        else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------


class ProductUpdateRequest(BaseModel):
    """All fields optional — send only what you want to change."""

    title: str | None = None
    description: str | None = None
    category: str | None = None
    tags: str | None = None
    image_url: str | None = None
    product_url: str | None = None
    actors: str | None = None
    director: str | None = None
    writer: str | None = None
    content_type: str | None = None
    year: int | None = None
    language: str | None = None
    duration_mins: int | None = None


# ---------------------------------------------------------------------------
# GET /api/v1/products
# ---------------------------------------------------------------------------


@router.get("")
async def list_products(
    request: Request,
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=50, ge=1, le=200),
    q: str = Query(default=""),
    category: str = Query(default=""),
    stale_only: bool = Query(default=False),
    clerk_user_id: str = Depends(require_clerk_user),
) -> dict:
    """Return a paginated list of products from Postgres for the authenticated client.

    Optional filters:
    - q: partial title match (ILIKE)
    - category: partial category match (ILIKE)
    - stale_only: True to show only products where last_indexed_at IS NULL
      or last_indexed_at < updated_at

    Results ordered by updated_at DESC.
    """
    client_id = _require_client_id(request)
    offset = (page - 1) * limit

    conditions = ["client_id = :cid"]
    params: dict = {"cid": uuid.UUID(client_id)}

    if q:
        conditions.append("title ILIKE :q")
        params["q"] = f"%{q}%"

    if category:
        conditions.append("category ILIKE :category")
        params["category"] = f"%{category}%"

    if stale_only:
        conditions.append("(last_indexed_at IS NULL OR last_indexed_at < updated_at)")

    where_clause = " AND ".join(conditions)

    try:
        async with AsyncSessionLocal() as session:
            count_result = await session.execute(
                sql_text(f"SELECT COUNT(*) FROM products WHERE {where_clause}"),
                params,
            )
            total: int = count_result.scalar_one() or 0

            rows_result = await session.execute(
                sql_text(
                    f"""
                    SELECT id, external_id, title, description, category,
                           tags, image_url, product_url,
                           actors, director, writer, content_type, year, language, duration_mins,
                           last_indexed_at, updated_at, created_at
                    FROM products
                    WHERE {where_clause}
                    ORDER BY updated_at DESC
                    LIMIT :lim OFFSET :off
"""
                ),
                {**params, "lim": limit, "off": offset},
            )
            rows = rows_result.fetchall()

    except Exception:
        logger.exception("products_list_error client_id=%s", client_id)
        raise HTTPException(
            status_code=500,
            detail={
                "error": "server_error",
                "message": "Could not retrieve products. Please retry.",
            },
        )

    pages = max(1, -(-total // limit))  # ceiling division

    return {
        "products": [_row_to_dict(row) for row in rows],
        "total": total,
        "page": page,
        "pages": pages,
    }


# ---------------------------------------------------------------------------
# POST /api/v1/products/reindex
# ---------------------------------------------------------------------------
# NOTE: this route MUST be defined before PUT /{product_id} so FastAPI doesn't
# try to match "reindex" as a product_id path parameter.


@router.post("/reindex")
async def reindex_products(
    request: Request,
    clerk_user_id: str = Depends(require_clerk_user),
) -> dict:
    """Queue a Celery job to re-embed and re-index all stale products.

    Stale = last_indexed_at IS NULL OR last_indexed_at < updated_at.
    Returns { job_id: str, stale_count: int }. If stale_count = 0, no job is
    queued and job_id is null.
    """
    client_id = _require_client_id(request)

    try:
        async with AsyncSessionLocal() as session:
            count_result = await session.execute(
                sql_text(
                    """
                    SELECT COUNT(*) FROM products
                    WHERE client_id = :cid
                      AND (last_indexed_at IS NULL OR last_indexed_at < updated_at)
                    """
                ),
                {"cid": uuid.UUID(client_id)},
            )
            stale_count: int = count_result.scalar_one() or 0

    except Exception:
        logger.exception("products_reindex_count_error client_id=%s", client_id)
        raise HTTPException(
            status_code=500,
            detail={
                "error": "server_error",
                "message": "Could not count stale products. Please retry.",
            },
        )

    if stale_count == 0:
        return {"job_id": None, "stale_count": 0}

    # Queue Celery task — returns immediately, task runs in background.
    result = reindex_stale_products.delay(client_id)
    job_id = result.id

    logger.info(
        "products_reindex_queued client_id=%s job_id=%s stale_count=%d",
        client_id,
        job_id,
        stale_count,
    )

    return {"job_id": job_id, "stale_count": stale_count}


# ---------------------------------------------------------------------------
# PUT /api/v1/products/{product_id}
# ---------------------------------------------------------------------------


@router.put("/{product_id}")
async def update_product(
    product_id: str,
    body: ProductUpdateRequest,
    request: Request,
    clerk_user_id: str = Depends(require_clerk_user),
) -> dict:
    """Update editable fields on a product.

    Strategy:
    - If any vector field (title/description/tags/category) changed: clear last_indexed_at
      so the next reindex run re-embeds this product.
    - If only non-vector fields changed (actors/director/writer/content_type/language/year
      or image/product URL): call Meilisearch update_documents() immediately
      (partial PUT, no re-embed) and set last_indexed_at = NOW().
    - Always flushes the search cache.

    Returns the updated product dict. 404 if product not found or belongs to
    a different client.
    """
    client_id = _require_client_id(request)

    # Only process fields that were explicitly set in the request body.
    update_data = body.model_dump(exclude_none=True)

    if not update_data:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "no_fields_provided",
                "message": "Provide at least one field to update.",
            },
        )

    try:
        product_uuid = uuid.UUID(product_id)
    except ValueError:
        raise HTTPException(
            status_code=404,
            detail={
                "error": "not_found",
                "message": "Product not found.",
            },
        )

    vector_changed = bool(_VECTOR_FIELDS & update_data.keys())
    only_mutable = not vector_changed and bool(_MUTABLE_FIELDS & update_data.keys())

    # Build SET clause — always update updated_at, conditionally clear last_indexed_at
    set_parts = ["updated_at = NOW()"]
    params: dict = {
        "product_id": product_uuid,
        "client_id": uuid.UUID(client_id),
    }

    for field in _EDITABLE_FIELDS:
        if field in update_data:
            set_parts.append(f"{field} = :{field}")
            params[field] = update_data[field]

    if vector_changed:
        # Signal re-embed needed on next reindex run
        set_parts.append("last_indexed_at = NULL")
    elif only_mutable:
        # Will be kept fresh after Meilisearch update below
        set_parts.append("last_indexed_at = NOW()")

    set_clause = ", ".join(set_parts)

    try:
        async with AsyncSessionLocal() as session:
            result = await session.execute(
                sql_text(
                    f"""
                    UPDATE products
                    SET {set_clause}
                    WHERE id = :product_id AND client_id = :client_id
                    RETURNING id, external_id, title, description, category,
                              tags, image_url, product_url,
                              actors, director, writer, content_type, year, language, duration_mins,
                              last_indexed_at, updated_at, created_at
"""
                ),
                params,
            )
            row = result.fetchone()
            await session.commit()

    except Exception:
        logger.exception(
            "products_update_error client_id=%s product_id=%s", client_id, product_id
        )
        raise HTTPException(
            status_code=500,
            detail={
                "error": "server_error",
                "message": "Could not update product. Please retry.",
            },
        )

    if row is None:
        raise HTTPException(
            status_code=404,
            detail={
                "error": "not_found",
                "message": "Product not found.",
            },
        )

    updated = _row_to_dict(row)

    # For metadata-only changes, push the delta to Meilisearch immediately so
    # search results reflect OTT fields without waiting for a reindex.
    if only_mutable:
        meili_doc: dict = {"id": str(product_uuid)}
        for field in _MUTABLE_FIELDS:
            if field in update_data:
                meili_doc[field] = update_data[field]

        try:
            await _meili_update_documents(client_id, [meili_doc])
        except Exception:
            # Non-fatal: the Postgres row is already updated; Meilisearch will
            # catch up on the next reindex. Log and continue.
            logger.exception(
                "products_update_meili_error client_id=%s product_id=%s",
                client_id,
                product_id,
            )

    # Flush search cache regardless of which update path was taken
    asyncio.get_event_loop().create_task(_flush_cache(client_id))

    return updated


# ---------------------------------------------------------------------------
# DELETE /api/v1/products/{product_id}
# ---------------------------------------------------------------------------


@router.delete("/{product_id}")
async def delete_product(
    product_id: str,
    request: Request,
    clerk_user_id: str = Depends(require_clerk_user),
) -> dict:
    """Delete a product from Postgres and Meilisearch.

    Returns { deleted: true }. 404 if not found or belongs to a different client.
    """
    client_id = _require_client_id(request)

    try:
        product_uuid = uuid.UUID(product_id)
    except ValueError:
        raise HTTPException(
            status_code=404,
            detail={
                "error": "not_found",
                "message": "Product not found.",
            },
        )

    try:
        async with AsyncSessionLocal() as session:
            result = await session.execute(
                sql_text(
                    """
                    DELETE FROM products
                    WHERE id = :product_id AND client_id = :client_id
                    RETURNING id
                    """
                ),
                {
                    "product_id": product_uuid,
                    "client_id": uuid.UUID(client_id),
                },
            )
            deleted_row = result.fetchone()
            await session.commit()

    except Exception:
        logger.exception(
            "products_delete_error client_id=%s product_id=%s", client_id, product_id
        )
        raise HTTPException(
            status_code=500,
            detail={
                "error": "server_error",
                "message": "Could not delete product. Please retry.",
            },
        )

    if deleted_row is None:
        raise HTTPException(
            status_code=404,
            detail={
                "error": "not_found",
                "message": "Product not found.",
            },
        )

    # Delete from Meilisearch — non-fatal if index doesn't exist
    try:
        await _meili_delete_document(client_id, product_id)
    except Exception:
        logger.exception(
            "products_delete_meili_error client_id=%s product_id=%s",
            client_id,
            product_id,
        )
        # Continue — Postgres delete is the authoritative action.

    # Flush search cache
    asyncio.get_event_loop().create_task(_flush_cache(client_id))

    return {"deleted": True}
