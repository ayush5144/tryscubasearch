"""add onboarding fields to clients

Revision ID: b2c3d4e5f6a7
Revises: s1h2o3p4i5f6
Create Date: 2026-03-28

Adds two columns to the clients table to support the onboarding flow:
  - store_description TEXT: free-text description of the store (RAG context)
  - onboarding_complete BOOLEAN NOT NULL DEFAULT FALSE: tracks if the user
    has finished the onboarding wizard
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "b2c3d4e5f6a7"
down_revision = "s1h2o3p4i5f6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("clients", sa.Column("store_description", sa.Text(), nullable=True))
    op.add_column(
        "clients",
        sa.Column(
            "onboarding_complete",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("clients", "onboarding_complete")
    op.drop_column("clients", "store_description")
