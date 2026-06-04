"""add database_connections table

Revision ID: c5d6e7f8a9b0
Revises: b4c5d6e7f8a9
Create Date: 2026-04-27
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision = "c5d6e7f8a9b0"
down_revision = "b4c5d6e7f8a9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "database_connections",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "client_id",
            UUID(as_uuid=True),
            sa.ForeignKey("clients.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("db_type", sa.String(20), nullable=False, server_default="postgres"),
        sa.Column("connection_string_enc", sa.Text, nullable=False),
        sa.Column("table_name", sa.String(255), nullable=False),
        sa.Column("field_mapping", JSONB, nullable=False, server_default="{}"),
        sa.Column(
            "sync_status", sa.String(20), nullable=False, server_default="pending"
        ),
        sa.Column("product_count", sa.Integer, nullable=True),
        sa.Column("last_synced_at", sa.DateTime, nullable=True),
        sa.Column("error_message", sa.Text, nullable=True),
        sa.Column(
            "created_at", sa.DateTime, server_default=sa.text("NOW()"), nullable=False
        ),
    )


def downgrade() -> None:
    op.drop_table("database_connections")
