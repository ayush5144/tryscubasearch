"""
Seed two test clients and their API keys into Postgres.

Creates:
  - Client A: id=00000000-0000-0000-0000-000000000001, email=clienta@test.local
  - Client B: id=00000000-0000-0000-0000-000000000002, email=clientb@test.local

Each client gets one API key. Raw keys are printed once to stdout and written
to .test_keys.env in the project root. Idempotent — safe to run multiple times
(uses ON CONFLICT DO NOTHING for clients; skips key creation if client already
has an active key).

Run from project root:
    cd backend && ../.venv/bin/python seed_test_keys.py
"""

import asyncio
import os
import sys

# Allow imports from backend/ directory
sys.path.insert(0, os.path.dirname(__file__))

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from config import settings
from services.auth import generate_api_key

# ---------------------------------------------------------------------------
# DB setup (mirrors db/postgres.py but standalone — no ORM models needed)
# ---------------------------------------------------------------------------

db_url = settings.database_url
if db_url.startswith("postgresql://"):
    db_url = db_url.replace("postgresql://", "postgresql+asyncpg://", 1)
elif db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql+asyncpg://", 1)

engine = create_async_engine(db_url, echo=False)
SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

# ---------------------------------------------------------------------------
# Test client definitions
# ---------------------------------------------------------------------------

TEST_CLIENTS = [
    {
        "id": "00000000-0000-0000-0000-000000000001",
        "email": "clienta@test.local",
        "store_name": "Test Store A",
        "env_key": "CLIENT_A_KEY",
        "label": "Test Key A",
    },
    {
        "id": "00000000-0000-0000-0000-000000000002",
        "email": "clientb@test.local",
        "store_name": "Test Store B",
        "env_key": "CLIENT_B_KEY",
        "label": "Test Key B",
    },
]

# Path to .test_keys.env — one level up from backend/
PROJECT_ROOT = os.path.dirname(os.path.dirname(__file__))
TEST_KEYS_FILE = os.path.join(PROJECT_ROOT, ".test_keys.env")


async def upsert_client(session: AsyncSession, client: dict) -> None:
    """Insert client row if it does not already exist."""
    await session.execute(
        text(
            """
            INSERT INTO clients (id, email, store_name, plan, plan_status)
            VALUES (:id, :email, :store_name, 'starter', 'active')
            ON CONFLICT (id) DO NOTHING
            """
        ),
        {
            "id": client["id"],
            "email": client["email"],
            "store_name": client["store_name"],
        },
    )


async def get_active_key_hash(session: AsyncSession, client_id: str) -> str | None:
    """Return the key_hash of any existing active key for this client, or None."""
    result = await session.execute(
        text(
            """
            SELECT key_hash FROM api_keys
            WHERE client_id = :client_id AND is_active = TRUE
            LIMIT 1
            """
        ),
        {"client_id": client_id},
    )
    row = result.fetchone()
    return row[0] if row else None


async def create_key(session: AsyncSession, client_id: str, label: str) -> str:
    """Generate a new API key, persist the hash, return the raw key."""
    raw_key, key_hash = generate_api_key()
    key_prefix = raw_key[:8]

    await session.execute(
        text(
            """
            INSERT INTO api_keys (id, client_id, key_hash, key_prefix, label, is_active)
            VALUES (gen_random_uuid(), :client_id, :key_hash, :key_prefix, :label, TRUE)
            ON CONFLICT (key_hash) DO NOTHING
            """
        ),
        {
            "client_id": client_id,
            "key_hash": key_hash,
            "key_prefix": key_prefix,
            "label": label,
        },
    )
    return raw_key


async def main() -> None:
    raw_keys: dict[str, str] = {}

    async with SessionLocal() as session:
        async with session.begin():
            for client in TEST_CLIENTS:
                # 1. Ensure client row exists
                await upsert_client(session, client)

                # 2. Check for existing active key
                existing_hash = await get_active_key_hash(session, client["id"])
                if existing_hash:
                    # Key already exists — we cannot recover the raw value, so
                    # generate a fresh one and replace the old one.
                    print(
                        f"[{client['env_key']}] Active key already exists for "
                        f"{client['email']} — rotating to a new key."
                    )
                    # Deactivate old keys
                    await session.execute(
                        text(
                            "UPDATE api_keys SET is_active = FALSE "
                            "WHERE client_id = :client_id"
                        ),
                        {"client_id": client["id"]},
                    )

                raw_key = await create_key(session, client["id"], client["label"])
                raw_keys[client["env_key"]] = raw_key

    # Print raw keys to stdout (shown once, never stored in DB)
    print()
    print("=" * 60)
    print("RAW API KEYS — copy these now, they will not be shown again")
    print("=" * 60)
    for env_var, raw_key in raw_keys.items():
        print(f"  {env_var}={raw_key}")
    print("=" * 60)
    print()

    # Write .test_keys.env (overwrite each run)
    lines = [f"{k}={v}\n" for k, v in raw_keys.items()]
    with open(TEST_KEYS_FILE, "w") as f:
        f.writelines(lines)
    print(f"Keys written to: {TEST_KEYS_FILE}")

    # Verify by querying the DB
    async with SessionLocal() as session:
        print()
        print("DB verification:")
        for client in TEST_CLIENTS:
            result = await session.execute(
                text(
                    """
                    SELECT c.email, c.store_name, a.key_prefix, a.label, a.is_active
                    FROM clients c
                    JOIN api_keys a ON a.client_id = c.id
                    WHERE c.id = :client_id AND a.is_active = TRUE
                    """
                ),
                {"client_id": client["id"]},
            )
            row = result.fetchone()
            if row:
                email, store_name, prefix, label, is_active = row
                print(
                    f"  OK  {email} ({store_name}) → key_prefix={prefix}... "
                    f"label={label!r} active={is_active}"
                )
            else:
                print(f"  ERR  No active key found for client_id={client['id']}")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
