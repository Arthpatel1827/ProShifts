"""manager corrections to worked time, with an audit trail

Revision ID: e2b3c4d5e6f7
Revises: e1a2b3c4d5f6
Create Date: 2026-10-26
"""
from alembic import op
import sqlalchemy as sa

revision = "e2b3c4d5e6f7"
down_revision = "e1a2b3c4d5f6"
branch_labels = None
depends_on = None


def upgrade():
    insp = sa.inspect(op.get_bind())
    cols = {c["name"] for c in insp.get_columns("time_entry")}
    if "corrected_at" not in cols:
        op.add_column("time_entry", sa.Column("corrected_at", sa.DateTime(), nullable=True))
    if "corrected_by" not in cols:
        op.add_column("time_entry", sa.Column("corrected_by", sa.BigInteger(),
                                              sa.ForeignKey("app_user.user_id", ondelete="SET NULL"), nullable=True))
    if "time_entry_audit" not in insp.get_table_names():
        op.create_table(
            "time_entry_audit",
            sa.Column("audit_id", sa.BigInteger(), primary_key=True),
            sa.Column("entry_id", sa.BigInteger(), sa.ForeignKey("time_entry.entry_id", ondelete="CASCADE"), nullable=False),
            sa.Column("break_id", sa.BigInteger(), nullable=True),
            sa.Column("changed_by", sa.BigInteger(), sa.ForeignKey("app_user.user_id", ondelete="SET NULL"), nullable=True),
            sa.Column("changed_at", sa.DateTime(), nullable=False),
            sa.Column("action", sa.Text(), nullable=False),
            sa.Column("old_value", sa.Text(), nullable=True),
            sa.Column("new_value", sa.Text(), nullable=True),
            sa.Column("reason", sa.Text(), nullable=False),
        )
        op.create_index("ix_time_entry_audit_entry_id", "time_entry_audit", ["entry_id"])


def downgrade():
    op.drop_index("ix_time_entry_audit_entry_id", table_name="time_entry_audit")
    op.drop_table("time_entry_audit")
    op.drop_column("time_entry", "corrected_by")
    op.drop_column("time_entry", "corrected_at")
