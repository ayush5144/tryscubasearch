"""add shopify_connections and shopify_webhook_events tables

Revision ID: s1h2o3p4i5f6
Revises: adc91accff58
Create Date: 2026-03-27

Phase 8: Shopify integration tables.
shopify_connections stores OAuth tokens and sync state per store.
shopify_webhook_events provides idempotency for incoming webhook processing.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "s1h2o3p4i5f6"
down_revision = "adc91accff58"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # -- shopify_connections --
    op.create_table(
        "shopify_connections",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "client_id",
            UUID(as_uuid=True),
            sa.ForeignKey("clients.id"),
            nullable=False,
        ),
        sa.Column("shop_domain", sa.Text(), unique=True, nullable=False),
        sa.Column("access_token", sa.Text(), nullable=False),
        sa.Column("scopes", sa.Text(), nullable=False),
        sa.Column(
            "sync_status",
            sa.Text(),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("last_synced_at", sa.DateTime(), nullable=True),
        sa.Column("sync_error", sa.Text(), nullable=True),
        sa.Column("product_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_shopify_connections_client_id",
        "shopify_connections",
        ["client_id"],
    )

    # -- shopify_webhook_events --
    op.create_table(
        "shopify_webhook_events",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("shop_domain", sa.Text(), nullable=False),
        sa.Column("event_id", sa.Text(), nullable=False),
        sa.Column("topic", sa.Text(), nullable=False),
        sa.Column(
            "processed_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint(
            "shop_domain", "event_id", name="uq_shopify_webhook_shop_event"
        ),
    )
    op.create_index(
        "ix_shopify_webhook_events_shop_domain",
        "shopify_webhook_events",
        ["shop_domain"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_shopify_webhook_events_shop_domain", table_name="shopify_webhook_events"
    )
    op.drop_table("shopify_webhook_events")
    op.drop_index("ix_shopify_connections_client_id", table_name="shopify_connections")
    op.drop_table("shopify_connections")
