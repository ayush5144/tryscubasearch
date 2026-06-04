"""add engagement to search_logs

Revision ID: d6e7f8a9b0c1
Revises: 14477339dbcf
Create Date: 2026-03-22 10:00:00.000000

Changes:
  search_logs:
    - add engagement (Boolean, NOT NULL, DEFAULT FALSE)

engagement = true means the user interacted with results (hover or scroll)
during the session before the settle signal fired.
Used to distinguish:
  settled=true, clicked=false, searched=false, engagement=true  → browsed
  settled=true, clicked=false, searched=false, engagement=false → abandoned
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d6e7f8a9b0c1"
down_revision: Union[str, Sequence[str], None] = "14477339dbcf"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "search_logs",
        sa.Column(
            "engagement",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    op.drop_column("search_logs", "engagement")
