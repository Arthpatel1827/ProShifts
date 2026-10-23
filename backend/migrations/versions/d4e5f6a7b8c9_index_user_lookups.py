"""index notification.user_id and time_entry.user_id

Both tables are queried by user on every notifications list, timesheet and
team-status request. IF NOT EXISTS keeps this safe on databases where
0b5f1c2d3e4a already created the indexes.

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-10-23
"""
from alembic import op


revision = "d4e5f6a7b8c9"
down_revision = "c3d4e5f6a7b8"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("CREATE INDEX IF NOT EXISTS ix_notification_user_id ON notification (user_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_time_entry_user_id ON time_entry (user_id)")


def downgrade():
    op.execute("DROP INDEX IF EXISTS ix_time_entry_user_id")
    op.execute("DROP INDEX IF EXISTS ix_notification_user_id")
