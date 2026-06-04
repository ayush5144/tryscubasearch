from pathlib import Path
from pydantic_settings import BaseSettings

# .env lives in the project root (one level above backend/)
_ENV_FILE = Path(__file__).parent.parent / ".env"


class Settings(BaseSettings):
    # Meilisearch
    meilisearch_host: str = "http://localhost:7700"
    meilisearch_master_key: str = "local_dev_key"

    # Embeddings
    openai_api_key: str = ""
    jina_api_key: str = ""

    # PostgreSQL
    database_url: str = (
        "postgresql+asyncpg://postgres:postgres@localhost:5432/scubasearch"
    )

    # Redis
    redis_url: str = "redis://localhost:6379"

    # Clerk
    clerk_secret_key: str = ""
    clerk_publishable_key: str = ""
    clerk_jwks_url: str = (
        "https://national-cod-2.clerk.accounts.dev/.well-known/jwks.json"
    )

    # Stripe
    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""

    # DB Connect
    db_encryption_key: str = ""

    # Admin
    admin_clerk_user_ids: str = (
        ""  # comma-separated Clerk user IDs allowed to access /admin
    )

    # App
    environment: str = "development"
    api_base_url: str = "http://localhost:8000"
    allowed_origins: str = "*"

    class Config:
        env_file = str(_ENV_FILE)
        env_ignore_empty = True
        extra = "ignore"


settings = Settings()
