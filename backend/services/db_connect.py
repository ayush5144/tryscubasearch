"""
External database connection service.

Handles encryption/decryption plus connector-specific table discovery and row
fetching for supported customer databases.
"""

import json
import logging
import re
from typing import Any
from urllib.parse import urlparse

import psycopg2
import psycopg2.extras
from cryptography.fernet import Fernet

from config import settings

logger = logging.getLogger(__name__)

SUPPORTED_TYPES = {"postgres", "mysql"}
MYSQL_SCHEMES = ("mysql://", "mysql+pymysql://", "mariadb://", "mariadb+pymysql://")
POSTGRES_SCHEMES = ("postgres://", "postgresql://", "postgresql+asyncpg://")
SAFE_IDENTIFIER_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
INTERNAL_APP_TABLES = {
    "alembic_version",
    "api_keys",
    "clients",
    "database_connections",
    "ingest_jobs",
    "products",
    "search_logs",
    "subscriptions",
}


def _fernet() -> Fernet:
    key = settings.db_encryption_key
    if not key:
        raise RuntimeError("DB_ENCRYPTION_KEY not set")
    return Fernet(key.encode() if isinstance(key, str) else key)


def encrypt_connection_string(conn_str: str) -> str:
    return _fernet().encrypt(conn_str.encode()).decode()


def decrypt_connection_string(enc: str) -> str:
    return _fernet().decrypt(enc.encode()).decode()


def normalize_db_type(db_type: str | None) -> str:
    normalized = (db_type or "postgres").strip().lower()
    if normalized not in SUPPORTED_TYPES:
        raise ValueError(f"Unsupported database type: {db_type}")
    return normalized


def _require_safe_identifier(name: str) -> str:
    cleaned = (name or "").strip()
    if not SAFE_IDENTIFIER_RE.match(cleaned):
        raise ValueError("Table name contains unsupported characters")
    return cleaned


def _normalize_postgres_url(conn_str: str) -> tuple[str, int, str]:
    parsed = urlparse(conn_str.replace("+asyncpg", ""))
    host = (parsed.hostname or "").strip().lower()
    port = parsed.port or 5432
    database = parsed.path.lstrip("/").strip().lower()
    return host, port, database


def _normalize_mysql_url(conn_str: str) -> tuple[str, int, str]:
    parsed = urlparse(
        conn_str.replace("+pymysql", "").replace("mariadb://", "mysql://", 1)
    )
    host = (parsed.hostname or "").strip().lower()
    port = parsed.port or 3306
    database = parsed.path.lstrip("/").strip().lower()
    return host, port, database


def _connect_postgres(conn_str: str, timeout: int):
    return psycopg2.connect(conn_str, connect_timeout=timeout)


def _connect_mysql(conn_str: str, timeout: int):
    import pymysql

    parsed = urlparse(
        conn_str.replace("+pymysql", "").replace("mariadb://", "mysql://", 1)
    )
    return pymysql.connect(
        host=parsed.hostname,
        port=parsed.port or 3306,
        user=parsed.username,
        password=parsed.password,
        database=parsed.path.lstrip("/"),
        connect_timeout=timeout,
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=True,
    )


def _connect(conn_str: str, db_type: str, timeout: int):
    normalized = normalize_db_type(db_type)
    if normalized == "postgres":
        return _connect_postgres(conn_str, timeout)
    return _connect_mysql(conn_str, timeout)


def test_connection(conn_str: str, db_type: str = "postgres") -> None:
    """Raise if connection fails. Uses a short timeout."""
    conn = _connect(conn_str, db_type, timeout=5)
    conn.close()


def is_internal_app_table(
    conn_str: str,
    table_name: str,
    db_type: str = "postgres",
) -> bool:
    """
    True only when the selected table is one of ScubaSearch's own internal
    tables on the same application database.
    """
    normalized_type = normalize_db_type(db_type)
    normalized_table = table_name.strip().lower()
    if normalized_type != "postgres":
        return False
    if normalized_table not in INTERNAL_APP_TABLES:
        return False

    try:
        return _normalize_postgres_url(conn_str) == _normalize_postgres_url(
            settings.database_url
        )
    except Exception:
        return False


def filter_connectable_tables(
    conn_str: str,
    tables: list[str],
    db_type: str = "postgres",
) -> list[str]:
    """Hide ScubaSearch internal tables when browsing the app database."""
    return [
        table
        for table in tables
        if not is_internal_app_table(conn_str, table, db_type=db_type)
    ]


def get_tables(conn_str: str, db_type: str = "postgres") -> list[str]:
    """Return all connectable tables for the selected source database."""
    normalized = normalize_db_type(db_type)
    conn = _connect(conn_str, normalized, timeout=5)
    try:
        cur = conn.cursor()
        if normalized == "postgres":
            cur.execute(
                """
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
                ORDER BY table_name
                """
            )
            rows = [r[0] for r in cur.fetchall()]
        else:
            cur.execute(
                """
                SELECT table_name
                FROM information_schema.tables
                WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'
                ORDER BY table_name
                """
            )
            rows = [r["table_name"] for r in cur.fetchall()]
        return filter_connectable_tables(conn_str, rows, normalized)
    finally:
        conn.close()


def get_table_columns(
    conn_str: str,
    table_name: str,
    db_type: str = "postgres",
) -> list[dict]:
    """Return column names and types for the given table."""
    normalized = normalize_db_type(db_type)
    safe_table = _require_safe_identifier(table_name)
    conn = _connect(conn_str, normalized, timeout=5)
    try:
        cur = conn.cursor()
        if normalized == "postgres":
            cur.execute(
                """
                SELECT column_name, data_type
                FROM information_schema.columns
                WHERE table_name = %s
                  AND table_schema = 'public'
                ORDER BY ordinal_position
                """,
                (safe_table,),
            )
            rows = cur.fetchall()
            cols = [{"name": r[0], "type": r[1]} for r in rows]
        else:
            cur.execute(
                """
                SELECT column_name, data_type
                FROM information_schema.columns
                WHERE table_schema = DATABASE()
                  AND table_name = %s
                ORDER BY ordinal_position
                """,
                (safe_table,),
            )
            rows = cur.fetchall()
            cols = [{"name": r["column_name"], "type": r["data_type"]} for r in rows]
        if not cols:
            raise ValueError(f"Table '{safe_table}' not found or has no columns")
        return cols
    finally:
        conn.close()


def _json_like(value: Any) -> Any:
    if isinstance(value, (dict, list)):
        return value
    if not isinstance(value, str):
        return value
    text = value.strip()
    if not text or text[0] not in "{[":
        return value
    try:
        return json.loads(text)
    except Exception:
        return value


def _resolve_path(value: Any, path: str) -> Any:
    current = _json_like(value)
    for part in path.split("."):
        current = _json_like(current)
        if isinstance(current, dict):
            current = current.get(part)
            continue
        return None
    return current


def _coerce_tags(tags_raw: Any) -> list[str]:
    if tags_raw is None:
        return []
    parsed = _json_like(tags_raw)
    if isinstance(parsed, list):
        return [str(tag).strip() for tag in parsed if str(tag).strip()]
    return [tag.strip() for tag in str(parsed).split(",") if tag.strip()]


def _fetch_rows(conn_str: str, table_name: str, db_type: str) -> list[dict]:
    normalized = normalize_db_type(db_type)
    safe_table = _require_safe_identifier(table_name)
    conn = _connect(conn_str, normalized, timeout=10)
    try:
        if normalized == "postgres":
            cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
            cur.execute(f'SELECT * FROM "{safe_table}"')
            return [dict(row) for row in cur.fetchall()]

        cur = conn.cursor()
        cur.execute(f"SELECT * FROM `{safe_table}`")
        return list(cur.fetchall())
    finally:
        conn.close()


def fetch_products(
    conn_str: str,
    table_name: str,
    mapping: dict,
    db_type: str = "postgres",
) -> list[dict]:
    """
    Fetch all rows and map to ScubaSearch document shape.

    mapping keys (all optional except title):
        title, description, category, tags,
        image_url, product_url, external_id,
        actors, director, writer, content_type, year, language, duration_mins
    """
    rows = _fetch_rows(conn_str, table_name, db_type)
    products: list[dict] = []

    for row_dict in rows:

        def get(field: str):
            column = mapping.get(field)
            if not column:
                return None
            if "." in column:
                root, remainder = column.split(".", 1)
                return _resolve_path(row_dict.get(root), remainder)
            return row_dict.get(column)

        title = get("title")
        if not title:
            continue

        ext_id = get("external_id")
        mapped_cols = {value.split(".", 1)[0] for value in mapping.values() if value}
        extra = {
            col: str(val)
            for col, val in row_dict.items()
            if col not in mapped_cols and val is not None and str(val).strip()
        }

        year = get("year")
        duration = get("duration_mins")

        products.append(
            {
                "title": str(title),
                "description": str(get("description") or ""),
                "category": str(get("category") or ""),
                "tags": _coerce_tags(get("tags")),
                "image_url": str(get("image_url") or ""),
                "product_url": str(get("product_url") or ""),
                "actors": str(get("actors") or ""),
                "director": str(get("director") or ""),
                "writer": str(get("writer") or ""),
                "content_type": str(get("content_type") or ""),
                "year": int(year) if str(year or "").isdigit() else None,
                "language": str(get("language") or ""),
                "duration_mins": int(duration)
                if str(duration or "").isdigit()
                else None,
                "_external_id": str(ext_id) if ext_id else None,
                "_extra": extra,
            }
        )

    return products
