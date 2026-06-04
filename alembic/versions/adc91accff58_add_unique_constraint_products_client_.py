"""add unique constraint on products(client_id, external_id)

Revision ID: adc91accff58
Revises: b1c2d3e4f5a6
Create Date: 2026-03-25

The ON CONFLICT (client_id, external_id) clause in _bulk_upsert_products requires
a unique constraint, not just an index. The previous migration only created a plain
index, causing every upsert to fail silently. This migration drops the plain index
and creates a unique constraint (which implicitly creates a unique index).
"""

from alembic import op

revision = "adc91accff58"
down_revision = "b1c2d3e4f5a6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_index("ix_products_client_external_id", table_name="products")
    op.create_unique_constraint(
        "uq_products_client_external_id",
        "products",
        ["client_id", "external_id"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_products_client_external_id", "products", type_="unique")
    op.create_index(
        "ix_products_client_external_id", "products", ["client_id", "external_id"]
    )
