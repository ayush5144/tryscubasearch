"""add clerk_user_id to clients

Revision ID: 5ac3c42c7259
Revises: f7bb2e19a9c6
Create Date: 2026-03-18 15:12:42.553013

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "5ac3c42c7259"
down_revision: Union[str, Sequence[str], None] = "f7bb2e19a9c6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add clerk_user_id column to clients table (nullable, unique)."""
    op.add_column("clients", sa.Column("clerk_user_id", sa.Text(), nullable=True))
    op.create_unique_constraint(
        "uq_clients_clerk_user_id", "clients", ["clerk_user_id"]
    )


def downgrade() -> None:
    """Remove clerk_user_id column from clients table."""
    op.drop_constraint("uq_clients_clerk_user_id", "clients", type_="unique")
    op.drop_column("clients", "clerk_user_id")
