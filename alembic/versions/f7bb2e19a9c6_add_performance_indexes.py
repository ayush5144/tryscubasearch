"""add performance indexes

Revision ID: f7bb2e19a9c6
Revises: ebaf0c953172
Create Date: 2026-03-17 22:40:48.621517

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f7bb2e19a9c6'
down_revision: Union[str, Sequence[str], None] = 'ebaf0c953172'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Analytics queries filter search_logs by client_id + time
    op.create_index("ix_search_logs_client_created", "search_logs", ["client_id", "created_at"])
    # Top queries aggregation
    op.create_index("ix_search_logs_client_query", "search_logs", ["client_id", "query"])
    # Auth lookup on every request — must be fast
    op.create_index("ix_api_keys_key_hash", "api_keys", ["key_hash"])
    # Dashboard polling for ingest progress
    op.create_index("ix_ingest_jobs_client_status", "ingest_jobs", ["client_id", "status"])


def downgrade() -> None:
    op.drop_index("ix_ingest_jobs_client_status", table_name="ingest_jobs")
    op.drop_index("ix_api_keys_key_hash", table_name="api_keys")
    op.drop_index("ix_search_logs_client_query", table_name="search_logs")
    op.drop_index("ix_search_logs_client_created", table_name="search_logs")
