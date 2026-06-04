"""add trigger to ingest_jobs

Revision ID: j2k3l4m5n6o7
Revises: h7i8j9k0l1m2
Create Date: 2026-05-02
"""

from alembic import op
import sqlalchemy as sa


revision = "j2k3l4m5n6o7"
down_revision = "h7i8j9k0l1m2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("ingest_jobs", sa.Column("trigger", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("ingest_jobs", "trigger")
