"""add skipped_count to ingest_jobs

Revision ID: f9b0c1d2e3f4
Revises: a2b3c4d5e6f7
Create Date: 2026-03-25

Tracks how many rows were skipped during ingest (e.g. missing title,
duplicate dedup, or malformed records). NULL means the job predates
this column; 0 means the job ran and nothing was skipped.
"""

from alembic import op
import sqlalchemy as sa

revision = "f9b0c1d2e3f4"
down_revision = "a2b3c4d5e6f7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "ingest_jobs",
        sa.Column("skipped_count", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("ingest_jobs", "skipped_count")
