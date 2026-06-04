"""Admin auth dependency — wraps require_clerk_user + checks admin allowlist."""

from fastapi import Depends, HTTPException, Request

from config import settings
from middleware.clerk_auth import require_clerk_user


async def require_admin(
    request: Request,
    clerk_user_id: str = Depends(require_clerk_user),
) -> str:
    """Return clerk_user_id if in admin allowlist, else 403."""
    allowed = [
        uid.strip() for uid in settings.admin_clerk_user_ids.split(",") if uid.strip()
    ]
    if not allowed or clerk_user_id not in allowed:
        raise HTTPException(
            status_code=403,
            detail={"error": "forbidden", "message": "Admin access only."},
        )
    return clerk_user_id
