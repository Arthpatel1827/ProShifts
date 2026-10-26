"""everyone active at a location is in its #general

Revision ID: e3c4d5e6f7a8
Revises: e2b3c4d5e6f7
Create Date: 2026-10-26

General only had the people who were active when the channels were first set up:
new employees were never added. This adds every active employee to their location's
#general (managers as admins). Nobody is removed and no other channel changes.
"""
from alembic import op

revision = "e3c4d5e6f7a8"
down_revision = "e2b3c4d5e6f7"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        INSERT INTO channel_member (channel_id, user_id, is_admin, joined_at)
        SELECT DISTINCT ON (c.channel_id, e.user_id)
               c.channel_id, e.user_id,
               COALESCE(lower(r.name) IN ('owner', 'manager'), false),
               now() AT TIME ZONE 'utc'
        FROM channel c
        JOIN employment e ON e.location_id = c.location_id AND e.status = 'active'
        LEFT JOIN role r ON r.role_id = e.role_id
        WHERE c.channel_type = 'general'
          AND NOT EXISTS (
              SELECT 1 FROM channel_member m WHERE m.channel_id = c.channel_id AND m.user_id = e.user_id
          )
        ORDER BY c.channel_id, e.user_id, (lower(r.name) IN ('owner', 'manager')) DESC
    """)


def downgrade():
    # Data backfill: nothing to undo safely (people may have joined since).
    pass
