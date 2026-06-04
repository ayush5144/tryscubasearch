"""
Tests for services/auth.py and the DB query functions in db/postgres.py.

Coverage:
  1. hash_key — determinism, correct algorithm, length, no raw key leakage
  2. generate_api_key — format, entropy, uniqueness, hash consistency
  3. get_client_by_key_hash — happy path, inactive key, unknown hash
  4. create_api_key — row created, raw key never stored, prefix correct

DB tests use an in-process SQLite database (via aiosqlite) so they run
without a live Postgres server.  The schema is created from the same
SQLAlchemy models used in production, so the test is not mocked away from
reality.
"""

import hashlib
import uuid

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker

# ---------------------------------------------------------------------------
# Helpers — import the modules under test
# ---------------------------------------------------------------------------
from services.auth import hash_key, generate_api_key


# ---------------------------------------------------------------------------
# Unit tests — no DB, no I/O
# ---------------------------------------------------------------------------


class TestHashKey:
    def test_returns_sha256_hex(self):
        raw = "sk_live_abc123"
        result = hash_key(raw)
        expected = hashlib.sha256(raw.encode()).hexdigest()
        assert result == expected

    def test_length_is_64_chars(self):
        assert len(hash_key("anything")) == 64

    def test_deterministic(self):
        raw = "sk_live_deterministic_test"
        assert hash_key(raw) == hash_key(raw)

    def test_different_inputs_different_hashes(self):
        assert hash_key("sk_live_aaaa") != hash_key("sk_live_bbbb")

    def test_empty_string_does_not_raise(self):
        result = hash_key("")
        assert len(result) == 64

    def test_raw_key_not_in_digest(self):
        raw = "sk_live_supersecret"
        digest = hash_key(raw)
        assert raw not in digest


class TestGenerateApiKey:
    def test_prefix(self):
        raw_key, _ = generate_api_key()
        assert raw_key.startswith("sk_live_")

    def test_total_length(self):
        # "sk_live_" (8) + 32 hex chars = 40 chars
        raw_key, _ = generate_api_key()
        assert len(raw_key) == 40

    def test_random_part_is_hex(self):
        raw_key, _ = generate_api_key()
        random_part = raw_key[len("sk_live_") :]
        assert all(c in "0123456789abcdef" for c in random_part)

    def test_returns_correct_hash(self):
        raw_key, key_hash = generate_api_key()
        assert key_hash == hash_key(raw_key)

    def test_uniqueness(self):
        keys = {generate_api_key()[0] for _ in range(100)}
        assert len(keys) == 100, "Duplicate keys generated — entropy failure"

    def test_raw_key_not_equal_to_hash(self):
        raw_key, key_hash = generate_api_key()
        assert raw_key != key_hash


# ---------------------------------------------------------------------------
# DB integration tests — SQLite in-process, same ORM models
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def event_loop_policy():
    """Use the default asyncio policy (required by pytest-asyncio)."""
    import asyncio

    return asyncio.DefaultEventLoopPolicy()


@pytest_asyncio.fixture(scope="function")
async def db_session():
    """Yield an AsyncSession backed by an in-memory SQLite database.

    The schema is created from the production SQLAlchemy models so there is no
    gap between test and production structure.
    """
    from db.postgres import Base
    import db.models  # noqa: F401 — ensure all models are registered on Base

    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )
    async with session_factory() as session:
        yield session

    await engine.dispose()


async def _seed_client(session: AsyncSession):
    """Insert a test Client row and return it."""
    from db.models import Client

    client = Client(
        id=uuid.uuid4(),
        email=f"test_{uuid.uuid4().hex[:8]}@example.com",
        store_name="Test Store",
    )
    session.add(client)
    await session.flush()
    return client


class TestGetClientByKeyHash:
    @pytest.mark.asyncio
    async def test_happy_path_returns_client(self, db_session):
        from db.postgres import create_api_key, get_client_by_key_hash

        client = await _seed_client(db_session)
        raw_key, _ = await create_api_key(db_session, client.id, "Production")
        await db_session.commit()

        found = await get_client_by_key_hash(db_session, hash_key(raw_key))
        assert found is not None
        assert found.id == client.id

    @pytest.mark.asyncio
    async def test_unknown_hash_returns_none(self, db_session):
        from db.postgres import get_client_by_key_hash

        result = await get_client_by_key_hash(db_session, "a" * 64)
        assert result is None

    @pytest.mark.asyncio
    async def test_inactive_key_returns_none(self, db_session):
        from db.models import ApiKey
        from db.postgres import create_api_key, get_client_by_key_hash
        from sqlalchemy import update

        client = await _seed_client(db_session)
        raw_key, api_key = await create_api_key(db_session, client.id, "Deactivated")

        # Deactivate the key
        await db_session.execute(
            update(ApiKey).where(ApiKey.id == api_key.id).values(is_active=False)
        )
        await db_session.commit()

        result = await get_client_by_key_hash(db_session, hash_key(raw_key))
        assert result is None

    @pytest.mark.asyncio
    async def test_cross_tenant_isolation(self, db_session):
        """Key belonging to client A must not return client B."""
        from db.postgres import create_api_key, get_client_by_key_hash

        client_a = await _seed_client(db_session)
        client_b = await _seed_client(db_session)

        raw_key_a, _ = await create_api_key(db_session, client_a.id, "Client A key")
        await db_session.commit()

        found = await get_client_by_key_hash(db_session, hash_key(raw_key_a))
        assert found is not None
        assert found.id != client_b.id
        assert found.id == client_a.id


class TestCreateApiKey:
    @pytest.mark.asyncio
    async def test_returns_raw_key_and_api_key_object(self, db_session):
        from db.postgres import create_api_key

        client = await _seed_client(db_session)
        raw_key, api_key = await create_api_key(db_session, client.id, "Test key")

        assert isinstance(raw_key, str)
        assert raw_key.startswith("sk_live_")
        assert api_key.id is not None
        assert api_key.client_id == client.id

    @pytest.mark.asyncio
    async def test_hash_stored_not_raw_key(self, db_session):
        """The value in key_hash must be the SHA256 digest, not the raw key."""
        from db.postgres import create_api_key

        client = await _seed_client(db_session)
        raw_key, api_key = await create_api_key(db_session, client.id, "Hash check")

        assert api_key.key_hash != raw_key
        assert api_key.key_hash == hash_key(raw_key)

    @pytest.mark.asyncio
    async def test_key_prefix_is_first_8_chars(self, db_session):
        from db.postgres import create_api_key

        client = await _seed_client(db_session)
        raw_key, api_key = await create_api_key(db_session, client.id, "Prefix check")

        assert api_key.key_prefix == raw_key[:8]
        assert api_key.key_prefix == "sk_live_"

    @pytest.mark.asyncio
    async def test_key_is_active_by_default(self, db_session):
        from db.postgres import create_api_key

        client = await _seed_client(db_session)
        _, api_key = await create_api_key(db_session, client.id, "Active check")

        assert api_key.is_active is True

    @pytest.mark.asyncio
    async def test_label_stored(self, db_session):
        from db.postgres import create_api_key

        client = await _seed_client(db_session)
        _, api_key = await create_api_key(db_session, client.id, "My Label")

        assert api_key.label == "My Label"

    @pytest.mark.asyncio
    async def test_two_keys_for_same_client_have_different_hashes(self, db_session):
        from db.postgres import create_api_key

        client = await _seed_client(db_session)
        _, key1 = await create_api_key(db_session, client.id, "Key 1")
        _, key2 = await create_api_key(db_session, client.id, "Key 2")
        await db_session.commit()

        assert key1.key_hash != key2.key_hash
