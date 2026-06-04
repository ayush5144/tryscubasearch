import csv
import io
import json
from collections.abc import Mapping

import httpx
from cryptography.fernet import Fernet

from config import settings


def _fernet() -> Fernet:
    key = settings.db_encryption_key
    if not key:
        raise RuntimeError("DB_ENCRYPTION_KEY not set")
    return Fernet(key.encode() if isinstance(key, str) else key)


def encrypt_headers(headers: dict[str, str] | None) -> str | None:
    if not headers:
        return None
    payload = json.dumps(headers)
    return _fernet().encrypt(payload.encode()).decode()


def decrypt_headers(headers_enc: str | None) -> dict[str, str]:
    if not headers_enc:
        return {}
    payload = _fernet().decrypt(headers_enc.encode()).decode()
    raw = json.loads(payload)
    return raw if isinstance(raw, dict) else {}


def _extract_path(data: object, path: str | None) -> object:
    if not path:
        return data
    current = data
    for part in path.split("."):
        if not part:
            continue
        if isinstance(current, list):
            if not part.isdigit():
                raise ValueError(f"Path segment '{part}' is not a valid list index")
            idx = int(part)
            if idx >= len(current):
                raise ValueError(f"List index '{part}' is out of range")
            current = current[idx]
            continue
        if not isinstance(current, Mapping):
            raise ValueError(f"Could not resolve items_path at '{part}'")
        if part not in current:
            raise ValueError(f"Path segment '{part}' not found in API response")
        current = current[part]
    return current


def _flatten_sample(
    obj: Mapping[str, object], prefix: str = ""
) -> list[tuple[str, str]]:
    columns: list[tuple[str, str]] = []
    for key, value in obj.items():
        path = f"{prefix}.{key}" if prefix else key
        value_type = type(value).__name__
        columns.append((path, value_type))
        if isinstance(value, Mapping):
            columns.extend(_flatten_sample(value, path))
    return columns


def _normalize_text(value: object) -> str:
    if isinstance(value, list):
        return ", ".join(str(v).strip() for v in value if str(v).strip())
    return str(value or "").strip()


def _detect_format(url: str, content_type: str) -> str:
    ct = content_type.lower().split(";")[0].strip()
    if "text/csv" in ct or "application/csv" in ct:
        return "csv"
    if "ndjson" in ct or "x-ndjson" in ct:
        return "ndjson"
    url_path = url.lower().split("?")[0]
    if url_path.endswith(".ndjson"):
        return "ndjson"
    if url_path.endswith(".csv"):
        return "csv"
    return "json"


def _parse_csv_text(text: str) -> list[dict]:
    reader = csv.DictReader(io.StringIO(text))
    return [dict(row) for row in reader if any(v and v.strip() for v in row.values())]


def _parse_ndjson_text(text: str) -> list[dict]:
    items = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
            if isinstance(obj, dict):
                items.append(obj)
        except json.JSONDecodeError:
            continue
    return items


def fetch_remote_json(source_url: str, headers: dict[str, str] | None = None) -> object:
    with httpx.Client(timeout=20.0, follow_redirects=True) as client:
        resp = client.get(source_url, headers=headers or {})
        resp.raise_for_status()
        return resp.json()


def fetch_remote_source(
    source_url: str, headers: dict[str, str] | None = None
) -> tuple[object, str]:
    """Fetch a URL and return (parsed_data, format). Supports JSON, CSV, NDJSON."""
    with httpx.Client(timeout=20.0, follow_redirects=True) as client:
        resp = client.get(source_url, headers=headers or {})
        resp.raise_for_status()
        fmt = _detect_format(source_url, resp.headers.get("content-type", ""))
        if fmt == "csv":
            return _parse_csv_text(resp.text), "csv"
        if fmt == "ndjson":
            return _parse_ndjson_text(resp.text), "ndjson"
        return resp.json(), "json"


def preview_remote_source(
    source_url: str,
    headers: dict[str, str] | None = None,
    items_path: str | None = None,
) -> list[dict]:
    data, fmt = fetch_remote_source(source_url, headers)

    if fmt in ("csv", "ndjson"):
        # Both are flat lists — items_path is not applicable
        items = data
    else:
        items = _extract_path(data, items_path)

    if not isinstance(items, list):
        raise ValueError("Resolved payload is not a list of documents")
    if not items:
        return []
    first = items[0]
    if not isinstance(first, Mapping):
        raise ValueError("Resolved payload items must be JSON objects")
    return [{"name": name, "type": kind} for name, kind in _flatten_sample(first)]


def fetch_products_from_api(
    source_url: str,
    headers: dict[str, str] | None,
    items_path: str | None,
    mapping: dict,
) -> list[dict]:
    data, fmt = fetch_remote_source(source_url, headers)

    if fmt in ("csv", "ndjson"):
        items = data
    else:
        extracted = _extract_path(data, items_path)
        if not isinstance(extracted, list):
            raise ValueError("Resolved payload is not a list of documents")
        items = extracted

    products: list[dict] = []
    for item in items:
        if not isinstance(item, Mapping):
            continue

        def get(field: str):
            col = mapping.get(field)
            if not col:
                return None
            current: object = item
            for part in str(col).split("."):
                if not isinstance(current, Mapping):
                    return None
                current = current.get(part)
            return current

        title = get("title")
        if not title:
            continue

        tags_raw = get("tags")
        if isinstance(tags_raw, list):
            tags = [str(t).strip() for t in tags_raw if str(t).strip()]
        else:
            tags = [t.strip() for t in str(tags_raw).split(",")] if tags_raw else []

        ext_id_value = get("external_id")
        ext_id = str(ext_id_value).strip() if ext_id_value is not None else None

        mapped_cols = {str(v) for v in mapping.values() if v}
        extra = {
            col: str(val)
            for col, val in item.items()
            if col not in mapped_cols and val is not None and str(val).strip()
        }

        year_raw = get("year")
        duration_raw = get("duration_mins")

        products.append(
            {
                "title": _normalize_text(title),
                "description": _normalize_text(get("description")),
                "category": _normalize_text(get("category")),
                "tags": tags,
                "image_url": _normalize_text(get("image_url")),
                "product_url": _normalize_text(get("product_url")),
                "actors": _normalize_text(get("actors")),
                "director": _normalize_text(get("director")),
                "writer": _normalize_text(get("writer")),
                "content_type": _normalize_text(get("content_type")),
                "year": int(year_raw) if str(year_raw or "").isdigit() else None,
                "language": _normalize_text(get("language")),
                "duration_mins": int(duration_raw)
                if str(duration_raw or "").isdigit()
                else None,
                "_external_id": ext_id,
                "_extra": extra,
            }
        )

    return products
