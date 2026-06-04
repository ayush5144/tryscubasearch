import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from db.postgres import Base


class Client(Base):
    __tablename__ = "clients"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    email: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    store_name: Mapped[str | None] = mapped_column(Text)
    store_url: Mapped[str | None] = mapped_column(Text)
    plan: Mapped[str | None] = mapped_column(Text)  # starter/growth/scale/none
    plan_status: Mapped[str | None] = mapped_column(Text)  # active/inactive/past_due
    clerk_user_id: Mapped[str | None] = mapped_column(Text, unique=True, nullable=True)
    store_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    onboarding_complete: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false", default=False
    )
    embed_config: Mapped[list | None] = mapped_column(
        JSONB,
        nullable=True,
        server_default='["title", "category", "tags", "description"]',
    )
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())

    api_keys: Mapped[list["ApiKey"]] = relationship(back_populates="client")
    ingest_jobs: Mapped[list["IngestJob"]] = relationship(back_populates="client")
    products: Mapped[list["Product"]] = relationship(back_populates="client")


class ApiKey(Base):
    __tablename__ = "api_keys"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    client_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("clients.id"), nullable=False
    )
    key_hash: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    key_prefix: Mapped[str] = mapped_column(
        Text, nullable=False
    )  # first 8 chars, shown in dashboard
    raw_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    label: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())

    client: Mapped["Client"] = relationship(back_populates="api_keys")


class SearchLog(Base):
    __tablename__ = "search_logs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    client_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("clients.id"), nullable=False
    )
    query: Mapped[str] = mapped_column(Text, nullable=False)
    result_count: Mapped[int] = mapped_column(Integer, default=0)
    cache_hit: Mapped[bool] = mapped_column(Boolean, default=False)
    response_ms: Mapped[int | None] = mapped_column(Integer)
    clicked: Mapped[bool] = mapped_column(Boolean, default=False)
    settled: Mapped[bool] = mapped_column(Boolean, default=False)
    searched: Mapped[bool] = mapped_column(Boolean, default=False)
    engagement: Mapped[bool] = mapped_column(Boolean, default=False)
    session_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    signal: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        server_default=text("clock_timestamp()")
    )


class IngestJob(Base):
    __tablename__ = "ingest_jobs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    client_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("clients.id"), nullable=False
    )
    status: Mapped[str] = mapped_column(
        Text, default="queued"
    )  # queued/processing/done/failed
    total: Mapped[int] = mapped_column(Integer, default=0)
    processed: Mapped[int] = mapped_column(Integer, default=0)
    added_count: Mapped[int | None] = mapped_column(Integer, nullable=True, default=0)
    updated_count: Mapped[int | None] = mapped_column(Integer, nullable=True, default=0)
    file_format: Mapped[str | None] = mapped_column(Text, nullable=True)
    trigger: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_log: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())

    client: Mapped["Client"] = relationship(back_populates="ingest_jobs")


class Subscription(Base):
    __tablename__ = "subscriptions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    client_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("clients.id"), nullable=False
    )
    # gateway_sub_id is nullable — rows exist for all clients regardless of
    # whether they have an active payment gateway subscription.
    gateway_sub_id: Mapped[str | None] = mapped_column(Text, unique=True, nullable=True)
    plan: Mapped[str] = mapped_column(Text, nullable=False, server_default="none")
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default="inactive")
    period_end: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    monthly_query_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    monthly_session_count: Mapped[int] = mapped_column(
        Integer, default=0, nullable=False
    )
    search_count_reset_at: Mapped[datetime | None] = mapped_column(
        DateTime, nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class Product(Base):
    """Postgres source of truth for all products.

    Meilisearch is the search index — populated from this table, not from CSV
    directly. last_indexed_at tracks sync state:
      - NULL          → never indexed; needs embed + index
      - < updated_at  → edited since last index; needs re-embed
      - >= updated_at → fresh; skip on next reindex run
    """

    __tablename__ = "products"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    client_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("clients.id"), nullable=False
    )
    # The id from their CSV file — stored separately from our internal UUID.
    external_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    price: Mapped[float | None] = mapped_column(Float, nullable=True)
    category: Mapped[str | None] = mapped_column(Text, nullable=True)
    tags: Mapped[str | None] = mapped_column(Text, nullable=True)  # comma-separated
    image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    product_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    # OTT-specific fields
    actors: Mapped[str | None] = mapped_column(Text, nullable=True)
    director: Mapped[str | None] = mapped_column(Text, nullable=True)
    writer: Mapped[str | None] = mapped_column(Text, nullable=True)
    content_type: Mapped[str | None] = mapped_column(Text, nullable=True)
    year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    language: Mapped[str | None] = mapped_column(Text, nullable=True)
    duration_mins: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # NULL = never indexed. Stale when last_indexed_at < updated_at.
    # onupdate is NOT set here — asyncpg does not support it cleanly.
    # All UPDATE queries must explicitly SET updated_at = NOW().
    last_indexed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    client: Mapped["Client"] = relationship(back_populates="products")


class ApiSyncConnection(Base):
    __tablename__ = "api_sync_connections"

    client_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("clients.id"), primary_key=True
    )
    source_url: Mapped[str] = mapped_column(Text, nullable=False)
    headers_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    items_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    field_mapping: Mapped[dict] = mapped_column(JSONB, nullable=False)
    sync_status: Mapped[str] = mapped_column(
        Text, nullable=False, server_default="pending"
    )
    product_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    next_sync_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    sync_interval_mins: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="15"
    )
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_columns: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
