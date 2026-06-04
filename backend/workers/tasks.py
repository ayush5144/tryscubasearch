"""
Celery tasks for ScubaSearch.
"""

import csv
import hashlib
import json
import os
import logging


import meilisearch

from workers.celery_app import celery_app
from config import settings

logger = logging.getLogger(__name__)

OPENAI_EMBED_MODEL = "text-embedding-3-small"
EMBEDDING_DIMS = 1536
CSV_ID_PREFIX = "csv_"
DB_ID_PREFIX = "dbsync_"
PULL_ID_PREFIX = "pull_"

# ---------------------------------------------------------------------------
# Batch sizing — Phase 6.10 resilience (explicit, single source of truth)
# ---------------------------------------------------------------------------
# OpenAI embedding: how many texts we send per API call (rate-limit friendly).
_EMBED_BATCH = 100

# Meilisearch push limits: independent of embed batch size.
# On the 8 GB VPS with MEILI_MAX_INDEXING_MEMORY=2GB:
#   each 1536-float vector ≈ 15 KB serialised JSON
#   200 docs × 15 KB = ~3 MB per call — well inside the 100 MB HTTP cap
#   and a small enough working set to avoid RAM spikes during indexing.
_MEILI_BATCH_DOCS = 200  # max docs per add_documents / update_documents call
_MEILI_BYTES_PER_DOC = (
    15_000  # conservative estimate: 1536-float vector + OTT text fields
)
_MEILI_MAX_BATCH_BYTES = (
    10 * 1024 * 1024
)  # 10 MB hard cap; well below default 100 MB HTTP limit
_MEILI_BATCH_TIMEOUT_MS = 120_000  # ms per indexing task (2 min)


def _get_meili() -> meilisearch.Client:
    return meilisearch.Client(
        settings.meilisearch_host, settings.meilisearch_master_key
    )


def _meili_safe_chunks(docs: list[dict]) -> list[list[dict]]:
    """Split docs into Meilisearch-safe sub-batches.

    Respects two independent limits:
      - _MEILI_BATCH_DOCS: cap doc count per call (controls indexing working set)
      - _MEILI_MAX_BATCH_BYTES: cap estimated JSON payload (avoids HTTP limit)

    With current constants (200 docs, 10 MB cap, 15 KB/doc estimate):
      200 docs × 15 KB = 3 MB per call — byte cap never triggers in normal use.
    The byte cap exists as a safety net if docs grow unusually large.
    """
    byte_count_cap = max(1, _MEILI_MAX_BATCH_BYTES // _MEILI_BYTES_PER_DOC)
    chunk_size = min(_MEILI_BATCH_DOCS, byte_count_cap)
    return [docs[i : i + chunk_size] for i in range(0, len(docs), chunk_size)]


def _push_to_meili(
    meili: meilisearch.Client, index_name: str, docs: list[dict]
) -> None:
    """add_documents in safe chunks, waiting for each Meilisearch task."""
    index = meili.index(index_name)
    for chunk in _meili_safe_chunks(docs):
        task = index.add_documents(chunk)
        meili.wait_for_task(task.task_uid, timeout_in_ms=_MEILI_BATCH_TIMEOUT_MS)


def _update_in_meili(
    meili: meilisearch.Client, index_name: str, docs: list[dict]
) -> None:
    """update_documents in safe chunks, waiting for each Meilisearch task."""
    index = meili.index(index_name)
    for chunk in _meili_safe_chunks(docs):
        task = index.update_documents(chunk)
        meili.wait_for_task(task.task_uid, timeout_in_ms=_MEILI_BATCH_TIMEOUT_MS)


def _ensure_index(meili: meilisearch.Client, index_name: str) -> None:
    """Create index and apply settings if it doesn't exist."""
    # Enable vectorStore experimental feature
    meili.http.patch("/experimental-features", {"vectorStore": True})

    try:
        meili.create_index(index_name, {"primaryKey": "id"})
    except Exception:
        pass  # Already exists

    index = meili.index(index_name)
    task = index.update_settings(
        {
            "searchableAttributes": [
                "title",
                "actors",
                "director",
                "writer",
                "content_type",
                "year",
                "language",
                "tags",
                "category",
                "description",
            ],
            "filterableAttributes": [
                "category",
                "content_type",
                "language",
                "year",
                "tags",
            ],
            "sortableAttributes": ["year"],
            "typoTolerance": {
                "enabled": True,
                "minWordSizeForTypos": {"oneTypo": 3, "twoTypos": 7},
            },
            "searchCutoffMs": 150,
            "embedders": {
                "default": {"source": "userProvided", "dimensions": EMBEDDING_DIMS}
            },
        }
    )
    meili.wait_for_task(task.task_uid)


def _delete_index_if_exists(meili: meilisearch.Client, index_name: str) -> None:
    try:
        task = meili.delete_index(index_name)
        meili.wait_for_task(task.task_uid, timeout_in_ms=30_000)
    except Exception as exc:
        if isinstance(exc, meilisearch.errors.MeilisearchApiError):
            if exc.code == "index_not_found":
                return
        raise


def _prefix_csv_id(raw_id: str) -> str:
    return raw_id if raw_id.startswith(CSV_ID_PREFIX) else f"{CSV_ID_PREFIX}{raw_id}"


def _normalize_identity_value(value: object) -> str:
    """Collapse a value into a stable, case-insensitive identity fragment."""
    if value is None:
        return ""
    text = str(value).strip().lower()
    return " ".join(text.split())


def _build_fallback_identity(
    *,
    title: str,
    product_url: str = "",
    year: int | None = None,
    content_type: str = "",
    language: str = "",
) -> str:
    """
    Build a stable fallback id for catalogs that do not provide one.

    Only use fields that are likely to define identity, not fields like
    description/tags/actors that may legitimately evolve over time.
    """
    identity_parts = [f"title:{_normalize_identity_value(title)}"]

    normalized_url = _normalize_identity_value(product_url)
    if normalized_url:
        identity_parts.append(f"url:{normalized_url}")

    if year is not None:
        identity_parts.append(f"year:{year}")

    normalized_type = _normalize_identity_value(content_type)
    if normalized_type:
        identity_parts.append(f"type:{normalized_type}")

    normalized_language = _normalize_identity_value(language)
    if normalized_language:
        identity_parts.append(f"lang:{normalized_language}")

    fingerprint = "|".join(identity_parts)
    return hashlib.md5(fingerprint.encode("utf-8")).hexdigest()[:16]


_COLUMN_ALIASES = {
    # description variations
    "body (html)": "description",
    "overview": "description",
    "plot": "description",
    "synopsis": "description",
    # category maps to genre
    "genre": "category",
    "genres": "category",
    # actors / cast
    "cast": "actors",
    "starring": "actors",
    "stars": "actors",
    # director
    "directed by": "director",
    # writer
    "screenplay": "writer",
    "written by": "writer",
    # release year
    "release_year": "year",
    "release year": "year",
    "released": "year",
    # content type
    "type": "content_type",
    "show_type": "content_type",
    "media_type": "content_type",
    # image / thumbnail
    "poster": "image_url",
    "thumbnail": "image_url",
    "thumbnail_url": "image_url",
    "poster_url": "image_url",
    # content URL / stream URL
    "content_url": "product_url",
    "stream_url": "product_url",
    "watch_url": "product_url",
    # duration
    "duration": "duration_mins",
    "runtime": "duration_mins",
    "runtime_mins": "duration_mins",
    # language
    "lang": "language",
    # id
    "content_id": "id",
    "show_id": "id",
    "movie_id": "id",
}


def _normalize_field_mapping(field_mapping: dict[str, str] | None) -> dict[str, str]:
    """Normalize a source->target field mapping."""
    if not field_mapping:
        return {}

    normalized: dict[str, str] = {}
    for source, target in field_mapping.items():
        source_key = str(source or "").strip().lower()
        target_key = str(target or "").strip().lower()
        if not source_key or not target_key:
            continue
        normalized[source_key] = _COLUMN_ALIASES.get(target_key, target_key)
    return normalized


def _normalize_column_name(
    raw_key: object,
    field_mapping: dict[str, str] | None = None,
) -> str:
    key = str(raw_key or "").strip().lower()
    if field_mapping:
        mapped = field_mapping.get(key)
        if not mapped:
            return ""
        key = mapped
    return _COLUMN_ALIASES.get(key, key)


def _normalize_row(row: dict, field_mapping: dict[str, str] | None = None) -> dict:
    """Lowercase keys and apply column aliases so common export formats work."""
    normalized = {}
    for k, v in row.items():
        key = _normalize_column_name(k, field_mapping)
        if not key:
            continue
        if key not in normalized:
            normalized[key] = v
    return normalized


def _normalize_text_value(value: object) -> str:
    if isinstance(value, list):
        return ", ".join(str(v).strip() for v in value if str(v).strip())
    return str(value or "").strip()


def _parse_csv(
    csv_path: str,
    field_mapping: dict[str, str] | None = None,
) -> list[dict]:
    """Parse ingest CSV into product dicts. Accepts common column name variations."""
    products = []
    normalized_mapping = _normalize_field_mapping(field_mapping)
    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for raw_row in reader:
            product = _normalize_product_dict(raw_row, normalized_mapping)
            if product is None:
                continue
            products.append(product)
    return products


def _parse_csv_partial(
    csv_path: str,
    field_mapping: dict[str, str] | None = None,
) -> list[dict]:
    """
    Parse CSV for update mode: extracts id + any present optional fields.
    Does NOT generate embeddings or _vectors.
    Requires 'id' column after normalization — raises ValueError if missing.
    Strips empty string values so partial updates don't overwrite data with blanks.
    """
    products = []
    normalized_mapping = _normalize_field_mapping(field_mapping)
    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)

        # Check normalized header for 'id'
        if reader.fieldnames is None:
            raise ValueError("CSV appears to be empty.")
        normalized_headers = set()
        for col in reader.fieldnames:
            norm = _normalize_column_name(col, normalized_mapping)
            normalized_headers.add(norm)

        if "id" not in normalized_headers:
            raise ValueError(
                "Update mode requires an 'id' column. Add product IDs to your CSV or use Replace mode."
            )

        for raw_row in reader:
            doc = _normalize_partial_dict(raw_row, normalized_mapping)
            if doc is None:
                continue
            products.append(doc)

    return products


def _normalize_product_dict(
    row: dict,
    field_mapping: dict[str, str] | None = None,
) -> dict | None:
    """
    Apply the same field extraction used in _parse_csv to a single product dict.
    Returns None if the row has no non-empty title (caller should skip it).
    """
    row = _normalize_row(row, field_mapping)

    title = str(row.get("title", "")).strip()
    if not title:
        return None

    raw_id = str(row.get("id", "")).strip()
    description = _normalize_text_value(row.get("description", ""))
    category = _normalize_text_value(row.get("category", ""))

    raw_tags_value = row.get("tags", "")
    if isinstance(raw_tags_value, list):
        tags = [str(t).strip() for t in raw_tags_value if str(t).strip()]
    else:
        raw_tags = str(raw_tags_value).strip()
        tags = [t.strip() for t in raw_tags.split(",") if t.strip()]

    image_url = _normalize_text_value(row.get("image_url", ""))
    product_url = _normalize_text_value(row.get("product_url", ""))

    actors = _normalize_text_value(row.get("actors", ""))
    director = _normalize_text_value(row.get("director", ""))
    writer = _normalize_text_value(row.get("writer", ""))
    content_type = _normalize_text_value(row.get("content_type", ""))
    year_raw = str(row.get("year", "")).strip()
    year = int(year_raw) if year_raw.isdigit() else None
    language = _normalize_text_value(row.get("language", ""))
    duration_raw = str(row.get("duration_mins", "")).strip()
    duration_mins = int(duration_raw) if duration_raw.isdigit() else None

    raw_product_id = (
        raw_id[:50]
        if raw_id
        else _build_fallback_identity(
            title=title,
            product_url=product_url,
            year=year,
            content_type=content_type,
            language=language,
        )
    )
    product_id = _prefix_csv_id(raw_product_id)

    return {
        "id": product_id,
        "title": title,
        "description": description,
        "category": category,
        "tags": tags,
        "image_url": image_url,
        "product_url": product_url,
        "actors": actors,
        "director": director,
        "writer": writer,
        "content_type": content_type,
        "year": year,
        "language": language,
        "duration_mins": duration_mins,
    }


def _normalize_partial_dict(
    row: dict,
    field_mapping: dict[str, str] | None = None,
) -> dict | None:
    """
    Apply the same partial-field extraction used in _parse_csv_partial to a
    single product dict.  Returns None if the row has no usable id field.
    """
    _OPTIONAL_FIELDS = {
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

    row = _normalize_row(row, field_mapping)

    raw_id = str(row.get("id", "")).strip()
    if not raw_id:
        logger.warning("Skipping row with empty id in update mode")
        return None

    doc: dict = {"id": _prefix_csv_id(raw_id[:50])}

    for field in _OPTIONAL_FIELDS:
        if field not in row:
            continue
        value = row[field]
        if field == "tags":
            if isinstance(value, list):
                parsed = [str(t).strip() for t in value if str(t).strip()]
            else:
                raw_tags = str(value).strip()
                parsed = [t.strip() for t in raw_tags.split(",") if t.strip()]
            if parsed:
                doc["tags"] = parsed
        elif field in {"year", "duration_mins"}:
            raw_value = str(value).strip()
            if raw_value.isdigit():
                doc[field] = int(raw_value)
        else:
            str_val = _normalize_text_value(value)
            if str_val:
                doc[field] = str_val

    return doc


def _parse_json_products(
    content: str,
    field_mapping: dict[str, str] | None = None,
) -> list[dict]:
    """Parse a JSON array of product objects into normalized product dicts."""
    try:
        raw = json.loads(content)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON: {exc}") from exc

    if not isinstance(raw, list):
        raise ValueError("JSON file must contain a top-level array of product objects.")

    normalized_mapping = _normalize_field_mapping(field_mapping)
    products = []
    for i, item in enumerate(raw):
        if not isinstance(item, dict):
            logger.warning(f"JSON row {i}: not a dict, skipping")
            continue
        try:
            product = _normalize_product_dict(item, normalized_mapping)
        except Exception as exc:
            logger.warning(f"JSON row {i}: normalization error ({exc}), skipping")
            continue
        if product is None:
            continue
        products.append(product)

    return products


def _parse_ndjson_products(
    content: str,
    field_mapping: dict[str, str] | None = None,
) -> list[dict]:
    """Parse a newline-delimited JSON file into normalized product dicts."""
    normalized_mapping = _normalize_field_mapping(field_mapping)
    products = []
    for i, line in enumerate(content.splitlines()):
        line = line.strip()
        if not line:
            continue
        try:
            item = json.loads(line)
        except json.JSONDecodeError as exc:
            logger.warning(f"NDJSON line {i}: parse error ({exc}), skipping")
            continue
        if not isinstance(item, dict):
            logger.warning(f"NDJSON line {i}: not a dict, skipping")
            continue
        try:
            product = _normalize_product_dict(item, normalized_mapping)
        except Exception as exc:
            logger.warning(f"NDJSON line {i}: normalization error ({exc}), skipping")
            continue
        if product is None:
            continue
        products.append(product)

    return products


def _parse_json_partial(
    content: str,
    field_mapping: dict[str, str] | None = None,
) -> list[dict]:
    """
    Parse a JSON array for update mode — same rules as _parse_csv_partial.
    Raises ValueError if no top-level id field is found across all items.
    """
    try:
        raw = json.loads(content)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON: {exc}") from exc

    if not isinstance(raw, list):
        raise ValueError("JSON file must contain a top-level array of product objects.")

    # Validate that at least one item has an id-like key
    has_id = False
    for item in raw:
        if isinstance(item, dict):
            normalized_keys = set()
            for k in item.keys():
                norm = _normalize_column_name(k, normalized_mapping)
                normalized_keys.add(norm)
            if "id" in normalized_keys:
                has_id = True
                break

    if not has_id:
        raise ValueError(
            "Update mode requires an 'id' column. Add product IDs to your JSON or use Replace mode."
        )

    products = []
    for i, item in enumerate(raw):
        if not isinstance(item, dict):
            logger.warning(f"JSON row {i}: not a dict, skipping")
            continue
        doc = _normalize_partial_dict(item, normalized_mapping)
        if doc is None:
            continue
        products.append(doc)

    return products


def _parse_ndjson_partial(
    content: str,
    field_mapping: dict[str, str] | None = None,
) -> list[dict]:
    """
    Parse a newline-delimited JSON file for update mode.
    Raises ValueError if no items have an id field.
    """
    lines = [l.strip() for l in content.splitlines() if l.strip()]
    if not lines:
        raise ValueError("NDJSON file appears to be empty.")

    # Validate id presence by checking all parsed lines
    has_id = False
    for line in lines:
        try:
            item = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(item, dict):
            normalized_keys = set()
            for k in item.keys():
                norm = _normalize_column_name(k, normalized_mapping)
                normalized_keys.add(norm)
            if "id" in normalized_keys:
                has_id = True
                break

    if not has_id:
        raise ValueError(
            "Update mode requires an 'id' column. Add product IDs to your NDJSON or use Replace mode."
        )

    products = []
    for i, line in enumerate(lines):
        try:
            item = json.loads(line)
        except json.JSONDecodeError as exc:
            logger.warning(f"NDJSON line {i}: parse error ({exc}), skipping")
            continue
        if not isinstance(item, dict):
            logger.warning(f"NDJSON line {i}: not a dict, skipping")
            continue
        doc = _normalize_partial_dict(item, normalized_mapping)
        if doc is None:
            continue
        products.append(doc)

    return products


def _load_products(
    file_path: str,
    file_format: str,
    field_mapping: dict[str, str] | None = None,
) -> list[dict]:
    """Load and parse product file — dispatch on format."""
    if file_format == "csv":
        return _parse_csv(file_path, field_mapping)
    with open(file_path, encoding="utf-8") as fh:
        content = fh.read()
    if file_format == "json":
        return _parse_json_products(content, field_mapping)
    if file_format == "ndjson":
        return _parse_ndjson_products(content, field_mapping)
    raise ValueError(
        f"Unknown file_format '{file_format}'. Must be csv, json, or ndjson."
    )


def _load_partial_products(
    file_path: str,
    file_format: str,
    field_mapping: dict[str, str] | None = None,
) -> list[dict]:
    """Load and parse product file for update mode — dispatch on format."""
    if file_format == "csv":
        return _parse_csv_partial(file_path, field_mapping)
    with open(file_path, encoding="utf-8") as fh:
        content = fh.read()
    if file_format == "json":
        return _parse_json_partial(content, field_mapping)
    if file_format == "ndjson":
        return _parse_ndjson_partial(content, field_mapping)
    raise ValueError(
        f"Unknown file_format '{file_format}'. Must be csv, json, or ndjson."
    )


def _file_has_id_column(
    file_path: str,
    file_format: str,
    field_mapping: dict[str, str] | None = None,
) -> bool:
    """Return True if the file contains a column/key that normalizes to 'id'."""
    if file_format == "csv":
        return _csv_has_id_column(file_path, field_mapping)
    with open(file_path, encoding="utf-8") as fh:
        content = fh.read()
    normalized_mapping = _normalize_field_mapping(field_mapping)
    if file_format == "json":
        try:
            raw = json.loads(content)
            if not isinstance(raw, list) or not raw:
                return False
            first = raw[0] if isinstance(raw[0], dict) else {}
        except (json.JSONDecodeError, IndexError):
            return False
    else:  # ndjson
        first_line = next((l.strip() for l in content.splitlines() if l.strip()), "")
        try:
            first = json.loads(first_line)
            if not isinstance(first, dict):
                return False
        except json.JSONDecodeError:
            return False
    for k in first.keys():
        norm = _normalize_column_name(k, normalized_mapping)
        if norm == "id":
            return True
    return False


def _embed_batch(texts: list[str]) -> list[list[float]]:
    """Embed a batch of texts via OpenAI text-embedding-3-small."""
    import httpx

    api_key = settings.openai_api_key.strip()
    if not api_key:
        raise RuntimeError(
            "OPENAI_API_KEY is not configured. Set it in .env and restart the Celery worker."
        )

    with httpx.Client(
        base_url="https://api.openai.com",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        timeout=30.0,
    ) as client:
        resp = client.post(
            "/v1/embeddings",
            json={"model": OPENAI_EMBED_MODEL, "input": texts},
        )
        resp.raise_for_status()
        data = resp.json()
    return [item["embedding"] for item in data["data"]]


_DEFAULT_EMBED_FIELDS = ["title", "category", "tags", "description"]


def _get_embed_config(client_id: str) -> list[str]:
    """Return the ordered embed field list for a client.

    Reads embed_config from the clients table. Falls back to the default
    order if the row is missing or the column is NULL/empty.
    """
    import psycopg2

    db_url = settings.database_url.replace("+asyncpg", "")
    try:
        conn = psycopg2.connect(db_url, connect_timeout=5)
        with conn.cursor() as cur:
            cur.execute("SELECT embed_config FROM clients WHERE id = %s", (client_id,))
            row = cur.fetchone()
        conn.close()
        if row and row[0]:
            return list(row[0])
    except Exception:
        logger.warning(
            "_get_embed_config failed client_id=%s — using default", client_id
        )
    return list(_DEFAULT_EMBED_FIELDS)


def _build_embed_text(p: dict, fields: list[str]) -> str:
    """Build embedding input string from a product dict in field order.

    Core fields are read directly from p. Custom fields are looked up in
    p['_extra'] (populated by fetch_products for unmapped DB columns).
    """
    extra = p.get("_extra") or {}
    parts = []
    for field in fields:
        val = p.get(field)
        if val is None:
            val = extra.get(field)
        if not val:
            continue
        if isinstance(val, list):
            parts.append(", ".join(str(v) for v in val if v))
        else:
            parts.append(str(val)[:300])
    return " ".join(parts)


def _build_meilisearch_doc(p: dict, vector: list[float]) -> dict:
    """Build a complete Meilisearch document from a product dict.

    Includes all OTT content fields (actors, director, writer, year, language, etc.)
    and metadata fields (image_url, product_url) even though only some
    are embedded. All are stored for searchability, filterability, and sorting.

    Strips internal Postgres fields (_pg_uuid, _extra) before returning.
    """
    doc = {
        "id": str(p["id"]),
        "title": p.get("title", ""),
        "description": p.get("description", ""),
        "category": p.get("category", ""),
        "tags": p.get("tags", ""),
        "image_url": p.get("image_url", ""),
        "product_url": p.get("product_url", ""),
        # OTT fields — stored for BM25 search (not embedded)
        "actors": p.get("actors", ""),
        "director": p.get("director", ""),
        "writer": p.get("writer", ""),
        # OTT metadata — stored for filtering and sorting
        "content_type": p.get("content_type", ""),
        "year": p.get("year"),
        "language": p.get("language", ""),
        "duration_mins": p.get("duration_mins"),
        # Vector and hash
        "_vectors": {"default": vector},
        "_text_hash": p.get("_text_hash", ""),
    }
    return doc


def _get_index_doc_count(index_name: str) -> int:
    """
    Return the current numberOfDocuments for a Meilisearch index.
    Returns 0 if the index does not exist or stats are unavailable.
    This is a synchronous helper — only call from Celery tasks (not async handlers).
    """
    try:
        meili = _get_meili()
        stats = meili.index(index_name).get_stats()
        return getattr(stats, "number_of_documents", 0)
    except Exception as exc:
        logger.warning(f"_get_index_doc_count({index_name}): {exc}")
        return 0


def _update_job(
    job_id: str,
    processed: int,
    status: str,
    error: str | None = None,
    added_count: int | None = None,
    updated_count: int | None = None,
    skipped_count: int | None = None,
) -> None:
    """Update ingest_jobs row via synchronous psycopg2.

    added_count / updated_count / skipped_count are only written when explicitly
    provided so mid-job progress updates don't clobber the final counts.
    """
    import psycopg2

    # Strip asyncpg prefix if present
    db_url = settings.database_url.replace(
        "postgresql+asyncpg://", "postgresql://"
    ).replace("asyncpg://", "postgresql://")

    try:
        conn = psycopg2.connect(db_url)
        with conn.cursor() as cur:
            if error:
                cur.execute(
                    "UPDATE ingest_jobs SET status=%s, processed=%s, error_log=%s WHERE id=%s",
                    (status, processed, error, job_id),
                )
            elif added_count is not None and updated_count is not None:
                if skipped_count is not None:
                    cur.execute(
                        """
                        UPDATE ingest_jobs
                        SET status=%s, processed=%s, added_count=%s, updated_count=%s,
                            skipped_count=%s
                        WHERE id=%s
                        """,
                        (
                            status,
                            processed,
                            added_count,
                            updated_count,
                            skipped_count,
                            job_id,
                        ),
                    )
                else:
                    cur.execute(
                        """
                        UPDATE ingest_jobs
                        SET status=%s, processed=%s, added_count=%s, updated_count=%s
                        WHERE id=%s
                        """,
                        (status, processed, added_count, updated_count, job_id),
                    )
            else:
                cur.execute(
                    "UPDATE ingest_jobs SET status=%s, processed=%s WHERE id=%s",
                    (status, processed, job_id),
                )
        conn.commit()
        conn.close()
    except Exception as e:
        logger.error(f"DB update failed for job {job_id}: {e}")


def _set_job_total(job_id: str, total: int) -> None:
    """Set the total product count on an ingest job row."""
    import psycopg2

    db_url = settings.database_url.replace(
        "postgresql+asyncpg://", "postgresql://"
    ).replace("asyncpg://", "postgresql://")
    try:
        conn = psycopg2.connect(db_url)
        with conn.cursor() as cur:
            cur.execute("UPDATE ingest_jobs SET total=%s WHERE id=%s", (total, job_id))
        conn.commit()
        conn.close()
    except Exception as e:
        logger.warning(f"Could not update total for job {job_id}: {e}")


def _get_sync_db_url() -> str:
    """Return a psycopg2-compatible DB URL (strips asyncpg prefix if present)."""
    return settings.database_url.replace(
        "postgresql+asyncpg://", "postgresql://"
    ).replace("asyncpg://", "postgresql://")


def _fetch_products_from_db(client_id: str, mode: str) -> list[dict]:
    """
    Fetch product rows from Postgres for the given client.

    mode == "replace": fetch ALL products for the client.
    mode == "append" or "update": fetch only stale rows
        (last_indexed_at IS NULL OR last_indexed_at < updated_at).

    Returns a list of dicts in the same shape as _normalize_product_dict():
        id          — external_id (used as Meilisearch document id for back-compat)
        _pg_uuid    — internal Postgres UUID (used only to write last_indexed_at)
        title, description, category, image_url, product_url,
        tags        — list[str] (split from comma-separated Postgres column)

    Returns an empty list on any error — caller falls back to CSV parsing.
    """
    import psycopg2
    import psycopg2.extras

    db_url = _get_sync_db_url()
    try:
        conn = psycopg2.connect(db_url)
        with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
            if mode == "replace":
                cur.execute(
                    """
                    SELECT id, external_id, title, description, category,
                           tags, image_url, product_url,
                           actors, director, writer, content_type, year,
                           language, duration_mins
                    FROM products
                    WHERE client_id = %s
                    ORDER BY created_at
                    """,
                    (client_id,),
                )
            else:
                # append / update — only stale rows
                cur.execute(
                    """
                    SELECT id, external_id, title, description, category,
                           tags, image_url, product_url,
                           actors, director, writer, content_type, year,
                           language, duration_mins
                    FROM products
                    WHERE client_id = %s
                      AND (last_indexed_at IS NULL OR last_indexed_at < updated_at)
                    ORDER BY created_at
                    """,
                    (client_id,),
                )
            rows = cur.fetchall()
        conn.close()
    except Exception as exc:
        logger.warning(f"_fetch_products_from_db({client_id}, {mode}): {exc}")
        return []

    products = []
    for row in rows:
        # Reconstruct the same dict shape as _normalize_product_dict().
        # external_id is used as the Meilisearch document id for backward
        # compatibility — existing indexes keyed on external_id remain valid.
        external_id = (row["external_id"] or "").strip()
        title = (row["title"] or "").strip()
        if not title:
            continue
        if not external_id:
            # No stable Meilisearch id — cannot push this product.  Skip and
            # let the CSV fallback handle it (it will generate an MD5 id).
            logger.debug(
                f"_fetch_products_from_db: skipping row with NULL external_id "
                f"(pg_uuid={row['id']})"
            )
            continue

        # tags stored as CSV string in Postgres; normalise back to list[str]
        raw_tags = row["tags"] or ""
        tags = [t.strip() for t in raw_tags.split(",") if t.strip()]

        description = row["description"] or ""
        category = row["category"] or ""
        image_url = row["image_url"] or ""
        product_url = row["product_url"] or ""

        # OTT fields
        actors = row["actors"] or ""
        director = row["director"] or ""
        writer = row["writer"] or ""
        content_type = row["content_type"] or ""
        year = row["year"]
        language = row["language"] or ""
        duration_mins = row["duration_mins"]

        products.append(
            {
                "id": external_id,  # Meilisearch doc id — keep external_id for compat
                "_pg_uuid": str(row["id"]),  # internal UUID for last_indexed_at update
                "title": title,
                "description": description,
                "category": category,
                "tags": tags,
                "image_url": image_url,
                "product_url": product_url,
                "actors": actors,
                "director": director,
                "writer": writer,
                "content_type": content_type,
                "year": year,
                "language": language,
                "duration_mins": duration_mins,
            }
        )

    return products


def _mark_indexed(pg_uuids: list[str], client_id: str) -> None:
    """
    Set last_indexed_at = NOW() for the given Postgres product UUIDs.
    Called after each batch is successfully pushed to Meilisearch.
    Non-fatal — logs a warning on failure.
    """
    if not pg_uuids:
        return
    import psycopg2

    db_url = _get_sync_db_url()
    try:
        conn = psycopg2.connect(db_url)
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE products
                SET last_indexed_at = NOW()
                WHERE id = ANY(%s::uuid[]) AND client_id = %s
                """,
                (pg_uuids, client_id),
            )
        conn.commit()
        conn.close()
    except Exception as exc:
        logger.warning(f"_mark_indexed: failed to update last_indexed_at: {exc}")


def _flush_cache(client_id: str, job_id: str) -> None:
    """Flush search cache keys for a client from Redis DB1."""
    try:
        import redis as redis_sync

        r = redis_sync.from_url(settings.redis_url, db=1, decode_responses=True)
        pattern = f"search:{client_id}:*"
        cursor = 0
        deleted = 0
        while True:
            cursor, keys = r.scan(cursor, match=pattern, count=100)
            if keys:
                r.delete(*keys)
                deleted += len(keys)
            if cursor == 0:
                break
        r.close()
        logger.info(
            f"Job {job_id}: flushed {deleted} cache keys for client {client_id}"
        )
    except Exception as e:
        logger.warning(f"Job {job_id}: cache flush failed (non-fatal): {e}")


def _run_replace(
    job_id: str,
    client_id: str,
    csv_path: str,
    file_format: str = "csv",
    field_mapping: dict[str, str] | None = None,
) -> dict:
    """
    Replace mode: build a pending index, push all docs, swap atomically with the
    live index, then delete the now-stale pending index. Zero downtime.

    Phase 6.8: reads all products for the client from Postgres as the primary
    source.  Falls back to parsing the CSV file if Postgres returns 0 rows.
    After the atomic index swap completes, marks all Postgres rows as indexed
    (last_indexed_at = NOW()).
    """
    # ------------------------------------------------------------------
    # Primary source: Postgres products table.
    # ------------------------------------------------------------------
    products = _fetch_products_from_db(client_id, "replace")
    source = "Postgres"
    if not products:
        logger.warning(
            f"[replace] Job {job_id}: Postgres returned 0 rows — "
            "falling back to CSV/file parsing"
        )
        products = _load_products(csv_path, file_format, field_mapping)
        source = file_format.upper()

    total = len(products)
    logger.info(f"[replace] Job {job_id}: loaded {total} products from {source}")

    if total == 0:
        _update_job(
            job_id,
            0,
            "failed",
            "No valid products found. Check that your file has a 'title' field with non-empty values.",
        )
        return {"job_id": job_id, "processed": 0, "status": "failed"}

    _set_job_total(job_id, total)

    meili = _get_meili()
    live_index_name = f"products_{client_id}"
    pending_index_name = f"products_{client_id}_pending"

    # Ensure both indexes exist with correct settings
    _ensure_index(meili, live_index_name)
    _ensure_index(meili, pending_index_name)

    processed = 0
    # Collect Postgres UUIDs to mark as indexed after the swap completes.
    all_pg_uuids: list[str] = []
    embed_fields = _get_embed_config(client_id)

    for i in range(0, total, _EMBED_BATCH):
        batch = products[i : i + _EMBED_BATCH]

        texts = [_build_embed_text(p, embed_fields) for p in batch]
        embeddings = _embed_batch(texts)

        docs = [_build_meilisearch_doc(p, embeddings[j]) for j, p in enumerate(batch)]

        _push_to_meili(meili, pending_index_name, docs)

        # Accumulate UUIDs for the final last_indexed_at batch update.
        for p in batch:
            if p.get("_pg_uuid"):
                all_pg_uuids.append(p["_pg_uuid"])

        processed += len(batch)
        _update_job(job_id, processed, "processing")
        logger.info(
            f"[replace] Job {job_id}: {processed}/{total} pushed to pending index"
        )

    # Swap pending -> live atomically
    logger.info(f"[replace] Job {job_id}: swapping indexes")
    task = meili.swap_indexes([{"indexes": [live_index_name, pending_index_name]}])
    meili.wait_for_task(task.task_uid, timeout_in_ms=60000)

    # Delete the now-stale pending index (contains old data after swap)
    logger.info(f"[replace] Job {job_id}: deleting stale pending index")
    task = meili.delete_index(pending_index_name)
    meili.wait_for_task(task.task_uid, timeout_in_ms=_MEILI_BATCH_TIMEOUT_MS)

    # Mark all indexed products as fresh in Postgres.
    if all_pg_uuids:
        _mark_indexed(all_pg_uuids, client_id)
        logger.info(
            f"[replace] Job {job_id}: marked {len(all_pg_uuids)} products as indexed in Postgres"
        )

    _flush_cache(client_id, job_id)
    # Replace mode: every product in the source is a fresh index — all are "added".
    _update_job(
        job_id,
        processed,
        "done",
        added_count=processed,
        updated_count=0,
    )
    logger.info(f"[replace] Job {job_id} complete: {processed} products indexed")

    return {"job_id": job_id, "processed": processed, "status": "done"}


def _csv_has_id_column(
    csv_path: str,
    field_mapping: dict[str, str] | None = None,
) -> bool:
    """Return True if the CSV header contains a column that normalizes to 'id'."""
    normalized_mapping = _normalize_field_mapping(field_mapping)
    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames:
            return False
        for col in reader.fieldnames:
            norm = _normalize_column_name(col, normalized_mapping)
            if norm == "id":
                return True
    return False


def _append_text(p: dict, embed_fields: list[str] | None = None) -> str:
    """Build the embedding input text for a product dict."""
    return _build_embed_text(p, embed_fields or _DEFAULT_EMBED_FIELDS)


def _run_append(
    job_id: str,
    client_id: str,
    csv_path: str,
    file_format: str = "csv",
    field_mapping: dict[str, str] | None = None,
) -> dict:
    """
    Append mode: smart-upsert products into the live index.

    Products are routed into three buckets:
    - to_embed:         new product (id not in index) OR text changed (hash differs)
                        → embed + add_documents with _text_hash stored
    - to_partial_update: existing product, text unchanged, but image_url
                        may differ → update_documents (no embed, vectors untouched)
    - skipped:          existing product, hash and all tracked non-text fields
                        identical → no Meilisearch call at all

    Phase 6.8: reads stale products (last_indexed_at IS NULL or < updated_at) from
    Postgres as the primary source.  Falls back to CSV parsing if DB returns 0 rows.
    Calls _mark_indexed() per batch after successful Meilisearch pushes.
    """
    # ------------------------------------------------------------------
    # Primary source: Postgres stale rows.
    # ------------------------------------------------------------------
    products = _fetch_products_from_db(client_id, "append")
    using_db = bool(products)
    if using_db:
        logger.info(
            f"[append] Job {job_id}: loaded {len(products)} stale products from Postgres"
        )
    else:
        logger.warning(
            f"[append] Job {job_id}: Postgres returned 0 stale rows — "
            "falling back to CSV/file parsing"
        )
        # Only validate id column requirement when falling back to file parsing.
        if not _file_has_id_column(csv_path, file_format, field_mapping):
            error_msg = (
                "Append mode requires an 'id' column. "
                f"Add product IDs to your {file_format.upper()} or use Replace mode."
            )
            _update_job(job_id, 0, "failed", error_msg)
            return {"job_id": job_id, "processed": 0, "status": "failed"}

        products = _load_products(csv_path, file_format, field_mapping)
        logger.info(
            f"[append] Parsed {len(products)} products from {file_format.upper()}"
        )

    total = len(products)

    if total == 0:
        _update_job(
            job_id,
            0,
            "failed",
            "No valid products found. Check that your file has a 'title' field with non-empty values.",
        )
        return {"job_id": job_id, "processed": 0, "status": "failed"}

    _set_job_total(job_id, total)

    meili = _get_meili()
    index_name = f"products_{client_id}"
    _ensure_index(meili, index_name)

    # ------------------------------------------------------------------
    # Fetch existing documents: only id and _text_hash (plus the mutable
    # non-text fields we need for the full-skip comparison).
    # ------------------------------------------------------------------
    logger.info(f"[append] Job {job_id}: fetching existing hashes from Meilisearch")
    try:
        existing_result = meili.index(index_name).get_documents(
            {
                "fields": [
                    "id",
                    "_text_hash",
                    "image_url",
                    "product_url",
                ],
                "limit": 100000,
            }
        )
        # SDK returns Document objects — convert to plain dicts via .__dict__
        existing_docs: dict[str, dict] = {}
        for doc in existing_result.results:
            d = doc.__dict__ if hasattr(doc, "__dict__") else dict(doc)
            doc_id = d.get("id", "")
            if doc_id:
                existing_docs[doc_id] = d
        existing_hashes: dict[str, str] = {
            doc_id: d.get("_text_hash", "") for doc_id, d in existing_docs.items()
        }
    except Exception as exc:
        logger.warning(
            f"[append] Job {job_id}: could not fetch existing docs ({exc}), "
            "treating all products as new"
        )
        existing_docs = {}
        existing_hashes = {}

    logger.info(f"[append] Job {job_id}: {len(existing_hashes)} existing docs fetched")

    # ------------------------------------------------------------------
    # Route each incoming product into a bucket.
    # ------------------------------------------------------------------
    to_embed: list[dict] = []  # new or text-changed → full embed + add
    to_partial_update: list[dict] = []  # existing, text same, mutable fields differ
    skipped_ids: set[str] = set()  # completely unchanged

    # Track which to_embed products are genuinely new (not previously in index)
    to_embed_new_ids: set[str] = set()

    _MUTABLE_FIELDS = ("image_url", "product_url")
    embed_fields = _get_embed_config(client_id)

    for p in products:
        pid = p["id"]
        text = _append_text(p, embed_fields)
        new_hash = hashlib.sha256(text.encode()).hexdigest()
        p["_text_hash"] = new_hash

        if pid not in existing_hashes:
            # Brand-new product
            to_embed.append(p)
            to_embed_new_ids.add(pid)
        elif existing_hashes[pid] != new_hash:
            # Text changed — must re-embed
            to_embed.append(p)
        else:
            # Text unchanged — check mutable fields
            existing_doc = existing_docs.get(pid, {})
            mutable_changed = False
            for field in _MUTABLE_FIELDS:
                incoming_val = p.get(field)
                existing_val = existing_doc.get(field)
                # Normalise both sides to strings for a robust comparison
                if str(incoming_val) != str(existing_val):
                    mutable_changed = True
                    break

            if mutable_changed:
                to_partial_update.append(p)
            else:
                skipped_ids.add(pid)

    embedded_count = len(to_embed)
    partial_updated_count = len(to_partial_update)
    skipped_count = len(skipped_ids)

    logger.info(
        f"[append] Job {job_id}: to_embed={embedded_count}, "
        f"to_partial_update={partial_updated_count}, skipped={skipped_count}"
    )

    # ------------------------------------------------------------------
    # Process to_embed bucket: embed in batches of 100, then add_documents.
    # ------------------------------------------------------------------
    processed = 0

    for i in range(0, embedded_count, _EMBED_BATCH):
        batch = to_embed[i : i + _EMBED_BATCH]
        texts = [_append_text(p, embed_fields) for p in batch]
        embeddings = _embed_batch(texts)

        docs = [_build_meilisearch_doc(p, embeddings[j]) for j, p in enumerate(batch)]

        _push_to_meili(meili, index_name, docs)

        # Mark this batch as indexed in Postgres.
        batch_uuids = [p["_pg_uuid"] for p in batch if p.get("_pg_uuid")]
        if batch_uuids:
            _mark_indexed(batch_uuids, client_id)

        processed += len(batch)
        _update_job(job_id, processed, "processing")
        logger.info(
            f"[append] Job {job_id}: embed bucket {processed}/{embedded_count} pushed"
        )

    # ------------------------------------------------------------------
    # Process to_partial_update bucket: send only mutable fields, no embed.
    # ------------------------------------------------------------------
    partial_processed = 0
    for i in range(0, partial_updated_count, _EMBED_BATCH):
        batch = to_partial_update[i : i + _EMBED_BATCH]
        # Only send the fields that may have changed; leave vectors untouched.
        partial_docs = [
            {
                "id": p["id"],
                "image_url": p["image_url"],
                "product_url": p["product_url"],
                "_text_hash": p["_text_hash"],
            }
            for p in batch
        ]

        _update_in_meili(meili, index_name, partial_docs)

        # Mark this batch as indexed in Postgres.
        batch_uuids = [p["_pg_uuid"] for p in batch if p.get("_pg_uuid")]
        if batch_uuids:
            _mark_indexed(batch_uuids, client_id)

        partial_processed += len(batch)
        _update_job(job_id, embedded_count + partial_processed, "processing")
        logger.info(
            f"[append] Job {job_id}: partial-update bucket "
            f"{partial_processed}/{partial_updated_count} pushed"
        )

    # ------------------------------------------------------------------
    # Derive final counts and persist.
    # ------------------------------------------------------------------
    added_count = len(to_embed_new_ids)
    updated_count = embedded_count - added_count  # text-changed re-embeds

    logger.info(
        f"[append] Job {job_id} complete: "
        f"added={added_count}, updated={updated_count}, "
        f"partial_updated={partial_updated_count}, skipped={skipped_count}"
    )

    _flush_cache(client_id, job_id)
    _update_job(
        job_id,
        total,
        "done",
        added_count=added_count,
        updated_count=updated_count + partial_updated_count,
        skipped_count=skipped_count,
    )

    return {"job_id": job_id, "processed": total, "status": "done"}


def _run_update(
    job_id: str,
    client_id: str,
    csv_path: str,
    file_format: str = "csv",
    field_mapping: dict[str, str] | None = None,
) -> dict:
    """
    Update mode: partial field update with no embedding step.
    Only sends fields present in the file; _vectors are never touched.
    Requires an explicit 'id' column.

    Phase 6.8: reads stale products (last_indexed_at IS NULL or < updated_at)
    from Postgres as the primary source, converting each row to the partial-doc
    format expected by update_documents().  Falls back to CSV parsing if the DB
    returns 0 rows.  Marks each successfully pushed batch with last_indexed_at.
    """
    # ------------------------------------------------------------------
    # Primary source: Postgres stale rows.
    # For update mode we build partial docs from the DB rows — only the fields
    # that are present in the Postgres row (same semantics as _parse_csv_partial).
    # ------------------------------------------------------------------
    db_products = _fetch_products_from_db(client_id, "update")
    if db_products:
        logger.info(
            f"[update] Job {job_id}: loaded {len(db_products)} stale products from Postgres"
        )
        # Convert full product dicts to partial-doc format for update_documents().
        # Include all fields that exist on the row; downstream Meilisearch will
        # merge them with existing vectors (no re-embedding).
        products = []
        for p in db_products:
            doc: dict = {"id": p["id"]}
            for field in (
                "title",
                "description",
                "category",
                "image_url",
                "product_url",
                "actors",
                "director",
                "writer",
                "content_type",
                "year",
                "language",
                "duration_mins",
            ):
                val = p.get(field)
                if val is not None and val != "":
                    doc[field] = val
            # tags is already a list[str]
            if p.get("tags"):
                doc["tags"] = p["tags"]
            # carry _pg_uuid through for last_indexed_at update
            if p.get("_pg_uuid"):
                doc["_pg_uuid"] = p["_pg_uuid"]
            products.append(doc)
    else:
        logger.warning(
            f"[update] Job {job_id}: Postgres returned 0 stale rows — "
            "falling back to CSV/file parsing"
        )
        try:
            products = _load_partial_products(csv_path, file_format, field_mapping)
        except ValueError as e:
            _update_job(job_id, 0, "failed", str(e))
            return {"job_id": job_id, "processed": 0, "status": "failed"}

    total = len(products)
    logger.info(f"[update] Job {job_id}: {total} docs to partially update")

    if total == 0:
        _update_job(
            job_id,
            0,
            "failed",
            "No valid rows with an 'id' found. Check your CSV.",
        )
        return {"job_id": job_id, "processed": 0, "status": "failed"}

    _set_job_total(job_id, total)

    meili = _get_meili()
    index_name = f"products_{client_id}"

    # Index must already exist — update mode does not create it
    try:
        meili.get_index(index_name)
    except Exception:
        error_msg = (
            f"Index '{index_name}' does not exist. "
            "Run a Replace or Append upload first before using Update mode."
        )
        _update_job(job_id, 0, "failed", error_msg)
        return {"job_id": job_id, "processed": 0, "status": "failed"}

    processed = 0

    for i in range(0, total, _EMBED_BATCH):
        batch = products[i : i + _EMBED_BATCH]

        # Strip _pg_uuid before sending to Meilisearch.
        meili_docs = [
            {k: v for k, v in doc.items() if k != "_pg_uuid"} for doc in batch
        ]

        _update_in_meili(meili, index_name, meili_docs)

        # Mark this batch as indexed in Postgres.
        batch_uuids = [doc["_pg_uuid"] for doc in batch if doc.get("_pg_uuid")]
        if batch_uuids:
            _mark_indexed(batch_uuids, client_id)

        processed += len(batch)
        _update_job(job_id, processed, "processing")
        logger.info(f"[update] Job {job_id}: {processed}/{total} partial docs sent")

    _flush_cache(client_id, job_id)
    _update_job(
        job_id,
        processed,
        "done",
        added_count=0,
        updated_count=processed,
    )
    logger.info(f"[update] Job {job_id} complete: {processed} docs partially updated")

    return {"job_id": job_id, "processed": processed, "status": "done"}


@celery_app.task(name="workers.tasks.reindex_stale_products", bind=True)
def reindex_stale_products(self, client_id: str) -> dict:
    """Re-embed and re-index all stale products for a client.

    Stale = last_indexed_at IS NULL OR last_indexed_at < updated_at.

    Reads product rows from Postgres, embeds text-changed / new ones,
    sends partial updates for image_url changes, and marks
    each batch as indexed via UPDATE products SET last_indexed_at = NOW().
    """
    import psycopg2

    logger.info(f"[reindex] Starting stale reindex for client {client_id}")

    db_url = settings.database_url.replace(
        "postgresql+asyncpg://", "postgresql://"
    ).replace("asyncpg://", "postgresql://")

    # Fetch all stale products synchronously via psycopg2 (Celery task is sync)
    try:
        conn = psycopg2.connect(db_url)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, external_id, title, description, category,
                       tags, image_url, product_url, last_indexed_at
                FROM products
                WHERE client_id = %s
                  AND (last_indexed_at IS NULL OR last_indexed_at < updated_at)
                ORDER BY created_at
                """,
                (client_id,),
            )
            rows = cur.fetchall()
            cols = [desc[0] for desc in cur.description]
        conn.close()
    except Exception as exc:
        logger.error(f"[reindex] client={client_id}: DB fetch failed: {exc}")
        raise

    if not rows:
        logger.info(f"[reindex] client={client_id}: no stale products, nothing to do")
        return {"client_id": client_id, "processed": 0}

    products = [dict(zip(cols, row)) for row in rows]
    total = len(products)
    logger.info(f"[reindex] client={client_id}: {total} stale products to process")

    meili = _get_meili()
    index_name = f"products_{client_id}"
    _ensure_index(meili, index_name)

    processed = 0
    embed_fields = _get_embed_config(client_id)

    for i in range(0, total, _EMBED_BATCH):
        batch = products[i : i + _EMBED_BATCH]

        texts = [_build_embed_text(p, embed_fields) for p in batch]
        embeddings = _embed_batch(texts)

        docs = [_build_meilisearch_doc(p, embeddings[j]) for j, p in enumerate(batch)]

        _push_to_meili(meili, index_name, docs)

        # Mark these rows as indexed
        batch_ids = [str(p["id"]) for p in batch]
        try:
            conn = psycopg2.connect(db_url)
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE products
                    SET last_indexed_at = NOW()
                    WHERE id = ANY(%s::uuid[])
                    """,
                    (batch_ids,),
                )
            conn.commit()
            conn.close()
        except Exception as exc:
            logger.warning(
                f"[reindex] client={client_id}: failed to mark batch as indexed: {exc}"
            )

        processed += len(batch)
        logger.info(
            f"[reindex] client={client_id}: {processed}/{total} products re-indexed"
        )

    _flush_cache(client_id, "reindex")
    logger.info(f"[reindex] client={client_id}: complete, {processed} products indexed")
    return {"client_id": client_id, "processed": processed}


@celery_app.task(name="workers.tasks.process_ingest_job", bind=True)
def process_ingest_job(
    self,
    job_id: str,
    client_id: str,
    csv_path: str,
    mode: str = "replace",
    file_format: str = "csv",
    field_mapping: dict[str, str] | None = None,
) -> dict:
    """
    Process an ingest job in one of three modes:

    - replace (default): swap-index pattern, zero downtime full re-index
    - append: upsert products into the live index (requires id column)
    - update: partial field update, no embeddings re-generated (requires id column)

    file_format: "csv" (default), "json", or "ndjson"
    """
    logger.info(
        f"Starting ingest job {job_id} for client {client_id} "
        f"(mode={mode}, format={file_format})"
    )
    _update_job(job_id, 0, "processing")

    try:
        if mode == "replace":
            result = _run_replace(
                job_id, client_id, csv_path, file_format, field_mapping
            )
        elif mode == "append":
            result = _run_append(
                job_id, client_id, csv_path, file_format, field_mapping
            )
        elif mode == "update":
            result = _run_update(
                job_id, client_id, csv_path, file_format, field_mapping
            )
        else:
            error_msg = f"Unknown mode '{mode}'. Must be replace, append, or update."
            _update_job(job_id, 0, "failed", error_msg)
            return {"job_id": job_id, "processed": 0, "status": "failed"}

        # Clean up uploaded file after successful processing
        try:
            os.remove(csv_path)
        except Exception:
            pass

        return result

    except Exception as e:
        error_msg = str(e)[:1000]
        logger.error(f"Job {job_id} failed: {error_msg}")
        _update_job(job_id, 0, "failed", error_msg)
        # Clean up on failure too
        try:
            os.remove(csv_path)
        except Exception:
            pass
        raise


# ---------------------------------------------------------------------------
# External database sync task
# ---------------------------------------------------------------------------


@celery_app.task(name="sync_external_database", bind=True, max_retries=2)
def sync_external_database(self, client_id: str) -> dict:
    """Fetch products from a connected external database and index them."""
    import uuid as _uuid
    import psycopg2

    from services.db_connect import (
        decrypt_connection_string,
        fetch_products,
        is_internal_app_table,
        normalize_db_type,
    )

    db_url = settings.database_url.replace("+asyncpg", "")
    pg = psycopg2.connect(db_url)
    pg.autocommit = True
    cur = pg.cursor()

    # Load connection record
    cur.execute(
        "SELECT connection_string_enc, table_name, field_mapping, db_type FROM database_connections WHERE client_id = %s",
        (client_id,),
    )
    row = cur.fetchone()
    if not row:
        return {"error": "no_connection_found"}

    enc_conn_str, table_name, field_mapping, db_type = row
    db_type = normalize_db_type(db_type)
    conn_str_preview = decrypt_connection_string(enc_conn_str)

    if is_internal_app_table(conn_str_preview, table_name, db_type=db_type):
        message = (
            "ScubaSearch's internal app tables cannot be used as a database "
            "source. Connect an external catalog table instead."
        )
        cur.execute(
            "UPDATE database_connections SET sync_status='failed', error_message=%s WHERE client_id=%s",
            (message, client_id),
        )
        cur.close()
        pg.close()
        logger.warning("[db_sync] blocked internal app table client_id=%s", client_id)
        return {"error": "invalid_source_table"}

    # Discover all source columns (for Kanban UI) before fetching products
    from services.db_connect import get_table_columns

    try:
        source_cols = [
            c["name"] for c in get_table_columns(conn_str_preview, table_name, db_type)
        ]
        cur.execute(
            "UPDATE database_connections SET source_columns=%s WHERE client_id=%s",
            (json.dumps(source_cols), client_id),
        )
    except Exception:
        logger.warning(
            "[db_sync] could not save source_columns client_id=%s", client_id
        )

    # Mark syncing
    cur.execute(
        "UPDATE database_connections SET sync_status='syncing', error_message=NULL WHERE client_id=%s",
        (client_id,),
    )

    try:
        raw_products = fetch_products(
            conn_str_preview, table_name, field_mapping, db_type
        )
    except Exception as exc:
        cur.execute(
            "UPDATE database_connections SET sync_status='failed', error_message=%s WHERE client_id=%s",
            (str(exc)[:500], client_id),
        )
        cur.close()
        pg.close()
        logger.exception("[db_sync] fetch failed client_id=%s", client_id)
        raise

    meili = _get_meili()
    live_index_name = f"products_{client_id}"
    pending_index_name = f"products_{client_id}_pending"

    # DB mode is authoritative. Every sync replaces the previous catalog from
    # either source so removed external rows do not linger in search.
    cur.execute("DELETE FROM products WHERE client_id = %s", (client_id,))
    _delete_index_if_exists(meili, live_index_name)
    _delete_index_if_exists(meili, pending_index_name)

    if not raw_products:
        cur.execute(
            "UPDATE database_connections SET sync_status='done', product_count=0, last_synced_at=NOW() WHERE client_id=%s",
            (client_id,),
        )
        cur.close()
        pg.close()
        return {"synced": 0}

    # Build product dicts with stable DB-prefixed IDs
    _ensure_index(meili, live_index_name)
    index = meili.index(live_index_name)

    client_uuid = _uuid.UUID(client_id)
    synced = 0
    embed_fields = _get_embed_config(client_id)

    for i in range(0, len(raw_products), _EMBED_BATCH):
        batch = raw_products[i : i + _EMBED_BATCH]
        texts = [_build_embed_text(p, embed_fields) for p in batch]
        vectors = _embed_batch(texts)

        docs = []
        pg_rows = []
        for p, vec in zip(batch, vectors):
            ext_id = p.get("_external_id")
            fallback_external_id = _build_fallback_identity(
                title=p["title"],
                product_url=p.get("product_url", ""),
                year=p.get("year"),
                content_type=p.get("content_type", ""),
                language=p.get("language", ""),
            )
            external_id = (
                f"{DB_ID_PREFIX}{ext_id}"
                if ext_id
                else f"{DB_ID_PREFIX}{fallback_external_id}"
            )
            prod_uuid = str(_uuid.uuid4())
            p["id"] = external_id
            doc = _build_meilisearch_doc(p, vec)
            docs.append(doc)
            tags_str = (
                ", ".join(p["tags"]) if isinstance(p["tags"], list) else p["tags"]
            )
            pg_rows.append(
                (
                    prod_uuid,
                    str(client_uuid),
                    external_id,
                    p["title"],
                    p["description"],
                    p["category"],
                    tags_str,
                    p["image_url"],
                    p["product_url"],
                    p.get("actors", ""),
                    p.get("director", ""),
                    p.get("writer", ""),
                    p.get("content_type", ""),
                    p.get("year"),
                    p.get("language", ""),
                    p.get("duration_mins"),
                )
            )

        # Upsert into Meilisearch
        _push_to_meili(meili, live_index_name, docs)

        # Upsert into Postgres products table
        for r in pg_rows:
            cur.execute(
                """
                INSERT INTO products
                    (id, client_id, external_id, title, description, category,
                     tags, image_url, product_url,
                     actors, director, writer, content_type, year, language, duration_mins,
                     last_indexed_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                ON CONFLICT (client_id, external_id)
                DO UPDATE SET
                    title=EXCLUDED.title, description=EXCLUDED.description,
                    category=EXCLUDED.category,
                    tags=EXCLUDED.tags, image_url=EXCLUDED.image_url,
                    product_url=EXCLUDED.product_url,
                    actors=EXCLUDED.actors, director=EXCLUDED.director,
                    writer=EXCLUDED.writer, content_type=EXCLUDED.content_type,
                    year=EXCLUDED.year, language=EXCLUDED.language,
                    duration_mins=EXCLUDED.duration_mins,
                    last_indexed_at=NOW(), updated_at=NOW()
                """,
                r,
            )
        synced += len(batch)
        logger.info(
            "[db_sync] indexed batch %d/%d client=%s",
            i + _EMBED_BATCH,
            len(raw_products),
            client_id,
        )

    cur.execute(
        "UPDATE database_connections SET sync_status='done', product_count=%s, last_synced_at=NOW() WHERE client_id=%s",
        (synced, client_id),
    )
    cur.close()
    pg.close()
    _flush_cache(client_id, "db_sync_complete")
    logger.info("[db_sync] complete synced=%d client=%s", synced, client_id)
    return {"synced": synced}


@celery_app.task(name="sync_external_api_source", bind=True, max_retries=2)
def sync_external_api_source(self, client_id: str) -> dict:
    """Fetch products from a configured external JSON API and index them."""
    import uuid as _uuid
    import psycopg2

    from services.api_sync import decrypt_headers, fetch_products_from_api

    db_url = settings.database_url.replace("+asyncpg", "")
    pg = psycopg2.connect(db_url)
    pg.autocommit = True
    cur = pg.cursor()

    cur.execute(
        """
        SELECT source_url, headers_enc, items_path, field_mapping, sync_interval_mins
        FROM api_sync_connections
        WHERE client_id = %s
        """,
        (client_id,),
    )
    row = cur.fetchone()
    if not row:
        cur.close()
        pg.close()
        return {"error": "no_connection_found"}

    source_url, headers_enc, items_path, field_mapping, sync_interval_mins = row
    headers = decrypt_headers(headers_enc)

    cur.execute(
        """
        UPDATE api_sync_connections
        SET sync_status = 'syncing', error_message = NULL
        WHERE client_id = %s
        """,
        (client_id,),
    )

    try:
        raw_products = fetch_products_from_api(
            source_url, headers, items_path, field_mapping
        )
    except Exception as exc:
        cur.execute(
            """
            UPDATE api_sync_connections
            SET sync_status = 'failed', error_message = %s
            WHERE client_id = %s
            """,
            (str(exc)[:500], client_id),
        )
        cur.close()
        pg.close()
        logger.exception("[api_sync] fetch failed client_id=%s", client_id)
        raise

    meili = _get_meili()
    live_index_name = f"products_{client_id}"
    pending_index_name = f"products_{client_id}_pending"

    cur.execute("DELETE FROM products WHERE client_id = %s", (client_id,))
    _delete_index_if_exists(meili, live_index_name)
    _delete_index_if_exists(meili, pending_index_name)

    if not raw_products:
        cur.execute(
            """
            UPDATE api_sync_connections
            SET sync_status = 'done',
                product_count = 0,
                last_synced_at = NOW(),
                next_sync_at = NOW() + (%s || ' minutes')::interval
            WHERE client_id = %s
            """,
            (sync_interval_mins, client_id),
        )
        cur.close()
        pg.close()
        _flush_cache(client_id, "api_sync_complete")
        return {"synced": 0}

    _ensure_index(meili, live_index_name)
    index = meili.index(live_index_name)

    client_uuid = _uuid.UUID(client_id)
    synced = 0
    embed_fields = _get_embed_config(client_id)

    for i in range(0, len(raw_products), _EMBED_BATCH):
        batch = raw_products[i : i + _EMBED_BATCH]
        texts = [_build_embed_text(p, embed_fields) for p in batch]
        vectors = _embed_batch(texts)

        docs = []
        pg_rows = []
        for p, vec in zip(batch, vectors):
            ext_id = p.get("_external_id")
            fallback_external_id = _build_fallback_identity(
                title=p["title"],
                product_url=p.get("product_url", ""),
                year=p.get("year"),
                content_type=p.get("content_type", ""),
                language=p.get("language", ""),
            )
            external_id = (
                f"{PULL_ID_PREFIX}{ext_id}"
                if ext_id
                else f"{PULL_ID_PREFIX}{fallback_external_id}"
            )
            prod_uuid = str(_uuid.uuid4())
            p["id"] = external_id
            doc = _build_meilisearch_doc(p, vec)
            docs.append(doc)
            tags_str = (
                ", ".join(p["tags"]) if isinstance(p["tags"], list) else p["tags"]
            )
            pg_rows.append(
                (
                    prod_uuid,
                    str(client_uuid),
                    external_id,
                    p["title"],
                    p["description"],
                    p["category"],
                    tags_str,
                    p["image_url"],
                    p["product_url"],
                    p.get("actors", ""),
                    p.get("director", ""),
                    p.get("writer", ""),
                    p.get("content_type", ""),
                    p.get("year"),
                    p.get("language", ""),
                    p.get("duration_mins"),
                )
            )

        _push_to_meili(meili, live_index_name, docs)

        for r in pg_rows:
            cur.execute(
                """
                INSERT INTO products
                    (id, client_id, external_id, title, description, category,
                     tags, image_url, product_url,
                     actors, director, writer, content_type, year, language, duration_mins,
                     last_indexed_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                ON CONFLICT (client_id, external_id)
                DO UPDATE SET
                    title=EXCLUDED.title, description=EXCLUDED.description,
                    category=EXCLUDED.category,
                    tags=EXCLUDED.tags, image_url=EXCLUDED.image_url,
                    product_url=EXCLUDED.product_url,
                    actors=EXCLUDED.actors, director=EXCLUDED.director,
                    writer=EXCLUDED.writer, content_type=EXCLUDED.content_type,
                    year=EXCLUDED.year, language=EXCLUDED.language,
                    duration_mins=EXCLUDED.duration_mins,
                    last_indexed_at=NOW(), updated_at=NOW()
                """,
                r,
            )
        synced += len(batch)
        logger.info(
            "[api_sync] indexed batch %d/%d client=%s",
            min(i + _EMBED_BATCH, len(raw_products)),
            len(raw_products),
            client_id,
        )

    cur.execute(
        """
        UPDATE api_sync_connections
        SET sync_status = 'done',
            product_count = %s,
            last_synced_at = NOW(),
            next_sync_at = NOW() + (%s || ' minutes')::interval
        WHERE client_id = %s
        """,
        (synced, sync_interval_mins, client_id),
    )
    cur.close()
    pg.close()
    _flush_cache(client_id, "api_sync_complete")
    logger.info("[api_sync] complete synced=%d client=%s", synced, client_id)
    return {"synced": synced}


@celery_app.task(name="workers.tasks.sync_due_api_sources", bind=True)
def sync_due_api_sources(self) -> dict:
    """Queue pull-sync jobs that are due based on next_sync_at."""
    import psycopg2

    db_url = settings.database_url.replace("+asyncpg", "")
    conn = psycopg2.connect(db_url)
    cur = conn.cursor()
    cur.execute(
        """
        SELECT client_id
        FROM api_sync_connections
        WHERE next_sync_at IS NOT NULL
          AND next_sync_at <= NOW()
          AND sync_status <> 'syncing'
        """
    )
    client_ids = [str(row[0]) for row in cur.fetchall()]
    cur.close()
    conn.close()

    for client_id in client_ids:
        sync_external_api_source.delay(client_id)

    return {"queued": len(client_ids)}


@celery_app.task(name="workers.tasks.reindex_all_clients", bind=True)
def reindex_all_clients(self) -> dict:
    """
    Queue re-embed and re-index tasks for ALL clients.
    Called once after switching embedding model/dimensions.
    Dispatches a reindex_stale_products Celery task for each client.
    """
    import psycopg2

    db_url = settings.database_url.replace("+asyncpg", "").replace(
        "asyncpg://", "postgresql://"
    )
    try:
        conn = psycopg2.connect(db_url)
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM clients")
            client_ids = [row[0] for row in cur.fetchall()]
        conn.close()
    except Exception as exc:
        logger.error(f"[reindex_all] failed to fetch client list: {exc}")
        return {"error": str(exc)}

    logger.info(f"[reindex_all] dispatching {len(client_ids)} reindex tasks")
    dispatched = 0
    for cid in client_ids:
        reindex_stale_products.delay(str(cid))
        dispatched += 1

    logger.info(f"[reindex_all] dispatched {dispatched} reindex tasks")
    return {"total": len(client_ids), "dispatched": dispatched}
    normalized_mapping = _normalize_field_mapping(field_mapping)
    normalized_mapping = _normalize_field_mapping(field_mapping)
