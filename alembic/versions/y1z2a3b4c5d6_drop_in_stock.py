"""drop in_stock column from products table

Revision ID: y1z2a3b4c5d6
Revises: x1y2z3w4v5u6
Drop Date: 2026-04-30

Remove in_stock field - not needed for OTT/content platform.
All content in catalog is assumed available.
"""

from alembic import op
import sqlalchemy as sa

revision = "y1z2a3b4c5d6"
down_revision = "x1y2z3w4v5u6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("products", "in_stock")


def downgrade() -> None:
    op.add_column(
        "products",
        op.add_column(
            "products",
            sa.Column("in_stock", sa.Boolean(), server_default="true", nullable=False),
        ),
    )
