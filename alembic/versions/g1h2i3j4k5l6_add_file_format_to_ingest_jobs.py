"""add file_format to ingest_jobs

Revision ID: g1h2i3j4k5l6
Revises: f9b0c1d2e3f4
Create Date: 2026-05-02 12:15:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "g1h2i3j4k5l6"
down_revision: Union[str, None] = "f9b0c1d2e3f4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("ingest_jobs", sa.Column("file_format", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("ingest_jobs", "file_format")
