"""drop shopify_connections and shopify_webhook_events tables

Revision ID: x1y2z3w4v5u6
Revises: e1f2a3b4c5d6
Drop Date: 2026-04-30

Shopify integration was removed in May 2026 as part of OTT pivot.
These tables are no longer used - cleaning up dead code.
"""

from alembic import op

revision = "x1y2z3w4v5u6"
down_revision = "e1f2a3b4c5d6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_index(
        "ix_shopify_webhook_events_shop_domain", table_name="shopify_webhook_events"
    )
    op.drop_table("shopify_webhook_events")
    op.drop_index("ix_shopify_connections_client_id", table_name="shopify_connections")
    op.drop_table("shopify_connections")


def downgrade() -> None:
    pass
