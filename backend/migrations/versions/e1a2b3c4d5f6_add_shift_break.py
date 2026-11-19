"""scheduled breaks inside a shift

Revision ID: e1a2b3c4d5f6
Revises: d4e5f6a7b8c9
Create Date: 2026-10-26
"""
from alembic import op
import sqlalchemy as sa

revision = "e1a2b3c4d5f6"
down_revision = "d4e5f6a7b8c9"
branch_labels = None
depends_on = None


def upgrade():
    # The app's startup create_all() may already have made the table on a dev database.
    if "shift_break" in sa.inspect(op.get_bind()).get_table_names():
        return
    op.create_table(
        "shift_break",
        sa.Column("break_id", sa.BigInteger(), primary_key=True),
        sa.Column("shift_id", sa.BigInteger(), sa.ForeignKey("shift.shift_id", ondelete="CASCADE"), nullable=False),
        sa.Column("start_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("end_time", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_shift_break_shift_id", "shift_break", ["shift_id"])


def downgrade():
    op.drop_index("ix_shift_break_shift_id", table_name="shift_break")
    op.drop_table("shift_break")
