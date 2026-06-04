"""Add OTT content fields to products table

Revision ID: e1f2a3b4c5d6
Revises: d2e3f4a5b6c7
Create Date: 2026-05-01 00:00:00.000000

Adds: actors, director, writer, content_type, year, language, duration_mins
Updates embed_config default on clients to OTT field order.
"""

from alembic import op
import sqlalchemy as sa

revision = "e1f2a3b4c5d6"
down_revision = "d2e3f4a5b6c7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("products", sa.Column("actors", sa.Text(), nullable=True))
    op.add_column("products", sa.Column("director", sa.Text(), nullable=True))
    op.add_column("products", sa.Column("writer", sa.Text(), nullable=True))
    op.add_column("products", sa.Column("content_type", sa.Text(), nullable=True))
    op.add_column("products", sa.Column("year", sa.Integer(), nullable=True))
    op.add_column("products", sa.Column("language", sa.Text(), nullable=True))
    op.add_column("products", sa.Column("duration_mins", sa.Integer(), nullable=True))

    # Update default embed_config for any new clients
    op.execute(
        """
        ALTER TABLE clients
        ALTER COLUMN embed_config
        SET DEFAULT '["title","actors","director","writer","tags","description"]'::jsonb
        """
    )

    # Migrate existing clients that still have the old e-commerce default
    op.execute(
        """
        UPDATE clients
        SET embed_config = '["title","actors","director","writer","tags","description"]'::jsonb
        WHERE embed_config = '["title","category","tags","description"]'::jsonb
        """
    )


def downgrade() -> None:
    op.drop_column("products", "duration_mins")
    op.drop_column("products", "language")
    op.drop_column("products", "year")
    op.drop_column("products", "content_type")
    op.drop_column("products", "writer")
    op.drop_column("products", "director")
    op.drop_column("products", "actors")

    op.execute(
        """
        ALTER TABLE clients
        ALTER COLUMN embed_config
        SET DEFAULT '["title","category","tags","description"]'::jsonb
        """
    )
