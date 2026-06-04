"""add_raw_key_to_api_keys

Revision ID: 14477339dbcf
Revises: c4d5e6f7a8b9
Create Date: 2026-03-20 10:17:50.383706

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "14477339dbcf"
down_revision: Union[str, Sequence[str], None] = "c4d5e6f7a8b9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("api_keys", sa.Column("raw_key", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("api_keys", "raw_key")
