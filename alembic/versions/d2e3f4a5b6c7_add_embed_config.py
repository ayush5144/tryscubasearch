"""add embed_config to clients and source_columns to database_connections

Revision ID: d2e3f4a5b6c7
Revises: c5d6e7f8a9b0
Create Date: 2026-04-27

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "d2e3f4a5b6c7"
down_revision = "c5d6e7f8a9b0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "clients",
        sa.Column(
            "embed_config",
            postgresql.JSONB(),
            nullable=False,
            server_default='["title","category","tags","description"]',
        ),
    )
    op.add_column(
        "database_connections",
        sa.Column("source_columns", postgresql.JSONB(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("clients", "embed_config")
    op.drop_column("database_connections", "source_columns")
