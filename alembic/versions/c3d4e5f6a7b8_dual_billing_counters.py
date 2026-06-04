"""dual billing counters

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-03-28

Rename monthly_search_count → monthly_query_count and add monthly_session_count
to the subscriptions table.  Query count tracks every search request (including
cache hits).  Session count tracks settled widget sessions (one per settle call
that actually inserts/updates rows).
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "c3d4e5f6a7b8"
down_revision = "b2c3d4e5f6a7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "subscriptions",
        "monthly_search_count",
        new_column_name="monthly_query_count",
    )
    op.add_column(
        "subscriptions",
        sa.Column(
            "monthly_session_count",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )


def downgrade() -> None:
    op.drop_column("subscriptions", "monthly_session_count")
    op.alter_column(
        "subscriptions",
        "monthly_query_count",
        new_column_name="monthly_search_count",
    )
