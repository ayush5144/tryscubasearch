"""
Clerk JWT authentication dependency for dashboard routes.

Uses PyJWT 2.x PyJWKClient which handles JWKS fetch + key caching natively.
Applied as a FastAPI dependency (not Starlette middleware) so it only affects
/api/v1/me/* and /api/v1/analytics/* routes — widget endpoints are untouched.

Sets on request.state:
    clerk_user_id  str        — Clerk user ID (sub claim)
    clerk_email    str|None   — email from JWT `email` claim, or None if absent
    client_id      str|None   — clients.id UUID string, or None if not provisioned yet
"""

import logging

import jwt
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from config import settings
from db.postgres import AsyncSessionLocal, get_client_by_clerk_user_id

logger = logging.getLogger(__name__)

# PyJWKClient fetches JWKS on first use and caches for lifespan seconds.
_jwks_client = jwt.PyJWKClient(
    settings.clerk_jwks_url,
    cache_jwk_set=True,
    lifespan=86400,  # 24 hours
)


def _err(status: int, error: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=status, detail={"error": error, "message": message}
    )


async def require_clerk_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(HTTPBearer(auto_error=False)),
) -> str:
    """Verify Clerk JWT and return clerk_user_id. Sets request.state."""
    if credentials is None:
        raise _err(401, "unauthorized", "Authorization: Bearer <token> required.")

    token = credentials.credentials

    # Dev bypass — accept a fixed token when running locally without Clerk keys.
    if settings.environment == "development" and token == "dev-token":
        request.state.clerk_user_id = "dev-user"
        request.state.clerk_email = "dev@local.dev"
        try:
            async with AsyncSessionLocal() as session:
                client = await get_client_by_clerk_user_id(session, "dev-user")
            request.state.client_id = str(client.id) if client else None
        except Exception:
            request.state.client_id = None
        return "dev-user"

    # Get signing key from JWKS (handles fetch + cache internally)
    try:
        signing_key = _jwks_client.get_signing_key_from_jwt(token)
    except jwt.exceptions.PyJWKClientError as exc:
        logger.warning("clerk_jwks_error: %s", exc)
        raise _err(
            401,
            "auth_service_unavailable",
            "Could not verify token at this time. Please retry.",
        )
    except jwt.exceptions.DecodeError:
        raise _err(
            401,
            "invalid_token",
            "Token could not be decoded. Ensure you are passing a valid Clerk JWT.",
        )

    # Verify signature + expiry
    try:
        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            options={"require": ["sub", "exp"]},
        )
    except jwt.ExpiredSignatureError:
        raise _err(401, "token_expired", "Your session has expired. Sign in again.")
    except jwt.InvalidTokenError as exc:
        logger.warning("clerk_jwt_invalid: %s", exc)
        raise _err(401, "invalid_token", "Token is invalid. Sign in again.")

    clerk_user_id: str = payload["sub"]
    request.state.clerk_user_id = clerk_user_id
    # Store email from JWT if Clerk's session template includes it.
    # Layer 2 fallback (Clerk REST API) runs in clients.py when this is None.
    request.state.clerk_email = payload.get("email") or None

    # Look up matching client row (None = new user, POST /me will provision)
    try:
        async with AsyncSessionLocal() as session:
            client = await get_client_by_clerk_user_id(session, clerk_user_id)
        request.state.client_id = str(client.id) if client else None
    except Exception:
        logger.exception("clerk_auth_db_error clerk_user_id=%s", clerk_user_id)
        request.state.client_id = None

    return clerk_user_id
