"""
API key hashing and generation utilities.

Security rules enforced here:
- Raw keys are never logged or stored — only their SHA256 hash is persisted.
- Generated keys use cryptographically secure random bytes (secrets module).
- Key format: sk_live_<32 hex chars>  (40 chars total, prefix included)
"""

import hashlib
import secrets


def hash_key(raw_key: str) -> str:
    """Return the SHA256 hex digest of *raw_key*.

    This is the only representation of a key that is stored in the database
    or written to any log.  The raw key is shown to the user exactly once at
    creation time and never persisted.
    """
    return hashlib.sha256(raw_key.encode()).hexdigest()


def generate_api_key() -> tuple[str, str]:
    """Generate a new API key and return ``(raw_key, key_hash)``.

    The raw key is a ``sk_live_`` prefixed string followed by 32 cryptographically
    secure random hex characters (128 bits of entropy).

    Returns:
        (raw_key, key_hash) — raw_key must be shown to the user once and then
        discarded; key_hash is what gets stored in the database.
    """
    random_hex = secrets.token_hex(16)  # 16 bytes → 32 hex chars
    raw_key = f"sk_live_{random_hex}"
    key_hash = hash_key(raw_key)
    return raw_key, key_hash
