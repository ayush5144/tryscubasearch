"""billing phase 6 — subscriptions overhaul + search count tracking

Revision ID: a1b2c3d4e5f6
Revises: 5ac3c42c7259
Create Date: 2026-03-18 18:00:00.000000

Changes:
  subscriptions:
    - rename stripe_sub_id → gateway_sub_id (nullable, still unique when set)
    - add monthly_search_count (Integer, default 0)
    - add search_count_reset_at (DateTime, nullable)
    - make plan default 'none', status default 'inactive'
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, Sequence[str], None] = "5ac3c42c7259"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Overhaul subscriptions table for gateway-agnostic billing."""

    # 1. Drop the old NOT-NULL unique constraint on stripe_sub_id
    op.drop_constraint(
        "subscriptions_stripe_sub_id_key", "subscriptions", type_="unique"
    )

    # 2. Rename stripe_sub_id → gateway_sub_id and make it nullable
    op.alter_column(
        "subscriptions",
        "stripe_sub_id",
        new_column_name="gateway_sub_id",
        existing_type=sa.Text(),
        nullable=True,
    )

    # 3. Re-create unique constraint (partial — only when non-null) via index
    #    Standard unique constraint allows multiple NULLs in Postgres natively,
    #    so a regular unique constraint on gateway_sub_id is correct.
    op.create_unique_constraint(
        "uq_subscriptions_gateway_sub_id", "subscriptions", ["gateway_sub_id"]
    )

    # 4. Add monthly_search_count column
    op.add_column(
        "subscriptions",
        sa.Column(
            "monthly_search_count",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )

    # 5. Add search_count_reset_at column
    op.add_column(
        "subscriptions",
        sa.Column("search_count_reset_at", sa.DateTime(), nullable=True),
    )

    # 6. Set server defaults for plan and status so new rows without explicit
    #    values get sensible defaults.
    op.alter_column(
        "subscriptions",
        "plan",
        existing_type=sa.Text(),
        server_default="none",
        nullable=False,
    )
    op.alter_column(
        "subscriptions",
        "status",
        existing_type=sa.Text(),
        server_default="inactive",
        nullable=False,
    )


def downgrade() -> None:
    """Revert subscriptions table to pre-Phase-6 shape."""
    op.drop_column("subscriptions", "search_count_reset_at")
    op.drop_column("subscriptions", "monthly_search_count")
    op.drop_constraint(
        "uq_subscriptions_gateway_sub_id", "subscriptions", type_="unique"
    )
    op.alter_column(
        "subscriptions",
        "gateway_sub_id",
        new_column_name="stripe_sub_id",
        existing_type=sa.Text(),
        nullable=False,
    )
    op.create_unique_constraint(
        "subscriptions_stripe_sub_id_key", "subscriptions", ["stripe_sub_id"]
    )
    op.alter_column(
        "subscriptions",
        "plan",
        existing_type=sa.Text(),
        server_default=None,
        nullable=False,
    )
    op.alter_column(
        "subscriptions",
        "status",
        existing_type=sa.Text(),
        server_default=None,
        nullable=False,
    )
