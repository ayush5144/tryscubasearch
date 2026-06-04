"""add phone to clients

Revision ID: a1b2c3d4e5f6
Revises: s1h2o3p4i5f6
Create Date: 2026-04-27
"""

from alembic import op
import sqlalchemy as sa

revision = "b4c5d6e7f8a9"
down_revision = "d57f35acf05d"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("clients", sa.Column("phone", sa.String(50), nullable=True))


def downgrade() -> None:
    op.drop_column("clients", "phone")
