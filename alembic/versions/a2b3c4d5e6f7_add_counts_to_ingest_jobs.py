"""add added_count and updated_count to ingest_jobs

Revision ID: a2b3c4d5e6f7
Revises: f8a9b0c1d2e3
Create Date: 2026-03-24

Tracks how many products were net-new (added_count) vs updated in-place
(updated_count) for append-mode ingest jobs. Replace-mode sets added_count
to total products indexed and updated_count to 0.
"""

from alembic import op
import sqlalchemy as sa

revision = "a2b3c4d5e6f7"
down_revision = "f8a9b0c1d2e3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "ingest_jobs",
        sa.Column("added_count", sa.Integer(), nullable=True, server_default="0"),
    )
    op.add_column(
        "ingest_jobs",
        sa.Column("updated_count", sa.Integer(), nullable=True, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("ingest_jobs", "updated_count")
    op.drop_column("ingest_jobs", "added_count")
