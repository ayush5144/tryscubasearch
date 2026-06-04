from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from middleware.auth import APIKeyMiddleware
from middleware.rate_limit import RateLimitMiddleware
from routers.admin import router as admin_router
from routers.api_sync import router as api_sync_router
from routers.analytics import router as analytics_router
from routers.billing import router as billing_router
from routers.clients import router as clients_router
from routers.database_connect import router as database_router
from routers.ingest import products_router
from routers.ingest import router as ingest_router
from routers.products import router as products_mgmt_router
from routers.push import router as push_router
from routers.search import router as search_router

app = FastAPI(
    title="ScubaSearch API",
    version="0.1.0",
    docs_url="/docs" if settings.environment == "development" else None,
    redoc_url=None,
)

# TODO Phase 7: restrict non-widget routes to scubasearch.io only.
# Full per-route CORS in FastAPI requires a custom middleware; wildcard is
# acceptable pre-launch. Widget endpoints (/api/v1/search, /api/v1/search/click)
# must always allow all origins. All other routes should allow only
# https://scubasearch.io and http://localhost:3000 in production.
_CORS_ORIGINS = [o.strip() for o in settings.allowed_origins.split(",")]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)

# Middleware execution order (Starlette LIFO — last registered runs first):
#
#   1. APIKeyMiddleware   <- added last, so it runs outermost / first
#      Extracts Bearer token, validates key, sets request.state.client_id.
#
#   2. RateLimitMiddleware
#      Reads request.state.client_id set by auth. Must run after auth.
#
#   3. CORSMiddleware     <- added first, runs innermost / last
#
# To make auth run BEFORE rate-limiting, APIKeyMiddleware is added AFTER
# RateLimitMiddleware in this file.
app.add_middleware(RateLimitMiddleware)
app.add_middleware(APIKeyMiddleware)

app.include_router(admin_router)
app.include_router(api_sync_router)
app.include_router(search_router)
app.include_router(ingest_router)
app.include_router(products_router)
app.include_router(products_mgmt_router)
app.include_router(clients_router)
app.include_router(analytics_router)
app.include_router(billing_router)
app.include_router(database_router)
app.include_router(push_router)


@app.get("/health")
async def health():
    return {"status": "ok"}
