"""search_logs_created_at_clock_timestamp

Revision ID: d57f35acf05d
Revises: c3d4e5f6a7b8
Create Date: 2026-04-24 15:51:36.662330

Change search_logs.created_at server default from now() to clock_timestamp()
so rows inserted in the same transaction get distinct timestamps, preserving
intent order in analytics ORDER BY created_at DESC.
"""

from typing import Sequence, Union

from alembic import op


revision: str = "d57f35acf05d"
down_revision: Union[str, Sequence[str], None] = "c3d4e5f6a7b8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE search_logs ALTER COLUMN created_at SET DEFAULT clock_timestamp()"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE search_logs ALTER COLUMN created_at SET DEFAULT now()")
