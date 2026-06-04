import uuid

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase

from config import settings

# Convert postgres:// to postgresql+asyncpg://
db_url = settings.database_url
if db_url.startswith("postgresql://"):
    db_url = db_url.replace("postgresql://", "postgresql+asyncpg://", 1)
elif db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql+asyncpg://", 1)

engine = create_async_engine(
    db_url,
    pool_size=5,
    max_overflow=10,
    echo=settings.environment == "development",
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    pass


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session


# ---------------------------------------------------------------------------
# Auth query helpers
# ---------------------------------------------------------------------------


async def get_client_by_key_hash(session: AsyncSession, key_hash: str):
    """Return the Client whose active API key matches *key_hash*, or None.

    Joins api_keys → clients so the caller receives a fully-populated Client
    ORM object without an extra round-trip.  Returns None if the key does not
    exist or is inactive.

    Imported inline to avoid a circular-import between postgres.py and
    models.py (both need Base, which lives here).
    """
    # Inline import avoids circular dependency: models imports Base from here.
    from db.models import ApiKey, Client  # noqa: PLC0415

    stmt = (
        select(Client)
        .join(ApiKey, ApiKey.client_id == Client.id)
        .where(ApiKey.key_hash == key_hash, ApiKey.is_active.is_(True))
        .limit(1)
    )
    result = await session.execute(stmt)
    return result.scalar_one_or_none()


# ---------------------------------------------------------------------------
# Clerk / dashboard query helpers
# ---------------------------------------------------------------------------


async def get_client_by_clerk_user_id(session: AsyncSession, clerk_user_id: str):
    """Return Client WHERE clerk_user_id = ?, or None."""
    from db.models import Client  # noqa: PLC0415

    stmt = select(Client).where(Client.clerk_user_id == clerk_user_id).limit(1)
    result = await session.execute(stmt)
    return result.scalar_one_or_none()


async def create_client(
    session: AsyncSession,
    *,
    clerk_user_id: str,
    email: str,
) -> object:
    """Insert a new Client row for a first-time Clerk user and return it."""
    from db.models import Client  # noqa: PLC0415

    client = Client(
        email=email,
        clerk_user_id=clerk_user_id,
    )
    session.add(client)
    await session.flush()  # assigns client.id without committing outer txn
    return client


async def list_api_keys_for_client(session: AsyncSession, client_id: uuid.UUID):
    """Return all ApiKey rows for the given client, newest first."""
    from db.models import ApiKey  # noqa: PLC0415

    stmt = (
        select(ApiKey)
        .where(ApiKey.client_id == client_id)
        .order_by(ApiKey.created_at.desc())
    )
    result = await session.execute(stmt)
    return result.scalars().all()


async def deactivate_api_key(
    session: AsyncSession,
    key_id: uuid.UUID,
    client_id: uuid.UUID,
) -> bool:
    """Set is_active=False on an ApiKey owned by client_id.

    Returns True if a row was updated, False if not found or ownership mismatch.
    """
    from sqlalchemy import update  # noqa: PLC0415
    from db.models import ApiKey  # noqa: PLC0415

    result = await session.execute(
        update(ApiKey)
        .where(ApiKey.id == key_id, ApiKey.client_id == client_id)
        .values(is_active=False, raw_key=None)
    )
    return result.rowcount > 0


async def create_api_key(
    session: AsyncSession,
    client_id: uuid.UUID,
    label: str,
) -> tuple[str, object]:
    """Generate a new API key, persist the hash, and return ``(raw_key, ApiKey)``.

    The raw key is returned to the caller so it can be shown to the user once.
    Only the SHA256 hash is written to the database — the raw key never touches
    persistent storage.

    Args:
        session:   An open AsyncSession (caller is responsible for commit/rollback).
        client_id: UUID of the owning client row.
        label:     Human-readable label shown in the dashboard (e.g. "Production").

    Returns:
        (raw_key, ApiKey) — raw_key must be forwarded to the user immediately
        and not stored anywhere.
    """
    from db.models import ApiKey  # noqa: PLC0415
    from services.auth import generate_api_key  # noqa: PLC0415

    raw_key, key_hash = generate_api_key()

    # Revoke all existing active keys for this client before creating the new one.
    await session.execute(
        update(ApiKey)
        .where(ApiKey.client_id == client_id, ApiKey.is_active == True)  # noqa: E712
        .values(is_active=False, raw_key=None)
    )

    # key_prefix: first 8 chars of the raw key — shown in the dashboard so
    # owners can identify which key is which without exposing the secret.
    key_prefix = raw_key[:8]

    api_key = ApiKey(
        client_id=client_id,
        key_hash=key_hash,
        key_prefix=key_prefix,
        raw_key=raw_key,
        label=label,
        is_active=True,
    )
    session.add(api_key)
    await session.flush()  # assigns api_key.id without committing the outer txn
    return raw_key, api_key
