"""add signal to search_logs

Revision ID: f8a9b0c1d2e3
Revises: e7e9f9ab3035
Create Date: 2026-03-22

Stores the settle signal (idle/hover/scroll/enter/click/visibilitychange)
on each settled search_log row so the analytics dashboard can show
sub-type badges (Hover, Idle, Scroll, Tab Switch) instead of a generic
Browsed label.
"""

from alembic import op
import sqlalchemy as sa

revision = "f8a9b0c1d2e3"
down_revision = "e7e9f9ab3035"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "search_logs",
        sa.Column("signal", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("search_logs", "signal")
