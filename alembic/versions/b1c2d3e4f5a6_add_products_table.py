"""add products table

Revision ID: b1c2d3e4f5a6
Revises: f9b0c1d2e3f4
Create Date: 2026-03-25

Adds the products table as the Postgres source of truth for all product
catalog data. Meilisearch remains the search index, populated from this table.

last_indexed_at tracks sync state:
  - NULL          → never indexed; needs embed + index
  - < updated_at  → edited since last index; needs re-embed
  - >= updated_at → fresh; skip on next reindex run
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "b1c2d3e4f5a6"
down_revision = "f9b0c1d2e3f4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "products",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
        ),
        sa.Column(
            "client_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("clients.id"),
            nullable=False,
        ),
        sa.Column("external_id", sa.Text, nullable=True),
        sa.Column("title", sa.Text, nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("price", sa.Float, nullable=True),
        sa.Column("category", sa.Text, nullable=True),
        sa.Column("tags", sa.Text, nullable=True),
        sa.Column("image_url", sa.Text, nullable=True),
        sa.Column("product_url", sa.Text, nullable=True),
        sa.Column("in_stock", sa.Boolean, server_default="true", nullable=False),
        sa.Column("last_indexed_at", sa.DateTime, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime,
            server_default=sa.text("NOW()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime,
            server_default=sa.text("NOW()"),
            nullable=False,
        ),
    )

    # Index for all queries scoped to client_id (list, reindex, etc.)
    op.create_index("ix_products_client_id", "products", ["client_id"])

    # Index for upsert lookups by external_id within a client's scope
    op.create_index(
        "ix_products_client_external_id", "products", ["client_id", "external_id"]
    )

    # Index for stale-detection queries:
    #   WHERE client_id = X AND (last_indexed_at IS NULL OR last_indexed_at < updated_at)
    op.create_index(
        "ix_products_stale",
        "products",
        ["client_id", "last_indexed_at", "updated_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_products_stale", table_name="products")
    op.drop_index("ix_products_client_external_id", table_name="products")
    op.drop_index("ix_products_client_id", table_name="products")
    op.drop_table("products")
