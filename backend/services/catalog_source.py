import uuid

from sqlalchemy import text as sql_text

from db.postgres import AsyncSessionLocal
from services.meilisearch import clear_client_indexes

CSV_ID_PREFIX = "csv_"


def prefix_csv_id(raw_id: str) -> str:
    return raw_id if raw_id.startswith(CSV_ID_PREFIX) else f"{CSV_ID_PREFIX}{raw_id}"


async def has_database_connection(client_id: str) -> bool:
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            sql_text(
                "SELECT 1 FROM database_connections WHERE client_id = :cid LIMIT 1"
            ),
            {"cid": uuid.UUID(client_id)},
        )
        return result.first() is not None


async def has_api_sync_connection(client_id: str) -> bool:
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            sql_text(
                "SELECT 1 FROM api_sync_connections WHERE client_id = :cid LIMIT 1"
            ),
            {"cid": uuid.UUID(client_id)},
        )
        return result.first() is not None


async def switch_client_to_csv_source(client_id: str) -> bool:
    """Switch a client from DB mode to CSV/manual mode.

    Returns True when an active DB source was found and cleared.
    """
    async with AsyncSessionLocal() as session:
        db_result = await session.execute(
            sql_text(
                "SELECT 1 FROM database_connections WHERE client_id = :cid LIMIT 1"
            ),
            {"cid": uuid.UUID(client_id)},
        )
        api_result = await session.execute(
            sql_text(
                "SELECT 1 FROM api_sync_connections WHERE client_id = :cid LIMIT 1"
            ),
            {"cid": uuid.UUID(client_id)},
        )
        had_db = db_result.first() is not None
        had_api_sync = api_result.first() is not None
        if not had_db and not had_api_sync:
            return False

        await session.execute(
            sql_text("DELETE FROM database_connections WHERE client_id = :cid"),
            {"cid": uuid.UUID(client_id)},
        )
        await session.execute(
            sql_text("DELETE FROM api_sync_connections WHERE client_id = :cid"),
            {"cid": uuid.UUID(client_id)},
        )
        await session.execute(
            sql_text("DELETE FROM products WHERE client_id = :cid"),
            {"cid": uuid.UUID(client_id)},
        )
        await session.commit()

    await clear_client_indexes(client_id)
    return True
