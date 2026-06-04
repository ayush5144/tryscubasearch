"""add settled to search_logs

Revision ID: b3e9f1a2c847
Revises: a1b2c3d4e5f6
Create Date: 2026-03-19 10:00:00.000000

Changes:
  search_logs:
    - add settled (Boolean, NOT NULL, DEFAULT FALSE)

settled = true means the query represents a completed user intent signal
(user paused, clicked a result, or explicitly called /search/settle).
Replaces the LENGTH(query) >= 4 heuristic in analytics queries.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "b3e9f1a2c847"
down_revision: Union[str, Sequence[str], None] = "a1b2c3d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add settled column to search_logs."""
    op.add_column(
        "search_logs",
        sa.Column(
            "settled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    """Remove settled column from search_logs."""
    op.drop_column("search_logs", "settled")
