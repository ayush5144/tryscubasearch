"""add searched to search_logs

Revision ID: c4d5e6f7a8b9
Revises: b3e9f1a2c847
Create Date: 2026-03-19 11:00:00.000000

Changes:
  search_logs:
    - add searched (Boolean, NOT NULL, DEFAULT FALSE)

searched = true means the query was settled via Enter / Go (explicit search intent).
Combined with settled and clicked:
  settled=true, clicked=true,    searched=false  → click settle
  settled=true, clicked=false,   searched=true   → Enter/Go settle
  settled=true, clicked=false,   searched=false  → idle 2s settle
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c4d5e6f7a8b9"
down_revision: Union[str, Sequence[str], None] = "b3e9f1a2c847"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "search_logs",
        sa.Column(
            "searched",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    op.drop_column("search_logs", "searched")
