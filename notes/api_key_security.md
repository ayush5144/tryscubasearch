# API Key Security — Storage Decision

## Current State (as of 2026-03-20)

Raw API keys are stored in plaintext in the `api_keys.raw_key` column. This was added to fix the UX problem of "shown once" keys confusing non-technical store owners. It works, but it is **not production-grade**.

## Why Plaintext Storage Is a Real Risk

If the database is ever dumped — SQL injection, backup leak, compromised VPS — every customer's key is immediately usable. An attacker can hit their search index, burn their rate limits, or query their product data. That is a breach you would have to disclose.

## Two Legitimate Patterns Used by Serious Products

**1. Show once, store hash only** (Stripe, GitHub)
The original design. User must copy at creation. If lost, revoke and regenerate. More secure, slightly worse UX. Non-technical users struggle with this.

**2. Encrypt at rest, decrypt on demand**
Store the key encrypted with a server-side secret. Decrypt only when displaying in the dashboard. If the DB leaks, keys are useless without the encryption secret. This gives you "copy anytime" UX without plaintext storage.

## The Right Fix Before Production

Encrypt `raw_key` with Fernet (symmetric encryption) before storing. Decrypt only in the `list_keys` endpoint.

```python
from cryptography.fernet import Fernet

# In .env:
# FERNET_SECRET=<base64 key — generate with Fernet.generate_key()>

fernet = Fernet(settings.fernet_secret)

# At key creation:
api_key.raw_key = fernet.encrypt(raw_key.encode()).decode()

# At list_keys:
decrypted = fernet.decrypt(k.raw_key.encode()).decode()
```

DB dump = useless ciphertext. Only if attacker gets both the DB **and** the env vars (full VPS compromise) are keys exposed — but that is true of any approach short of HSM.

## Current Risk Acceptance

Plaintext storage is acceptable for:
- Local development
- Pre-launch testing
- Single-tenant / personal use

It is **not acceptable** for:
- Any paying customer
- Any production deployment
- Any enterprise conversation

## Action Items

- [ ] Add `FERNET_SECRET` to `.env` and DO App Platform env vars
- [ ] Encrypt `raw_key` at creation in `db/postgres.py`
- [ ] Decrypt in `clients.py` `list_keys` endpoint before returning
- [ ] Backfill existing plaintext rows (or just revoke + recreate — simpler)
- [ ] Add `cryptography` to `requirements.txt` if not already present (it is — used by Clerk JWT)
