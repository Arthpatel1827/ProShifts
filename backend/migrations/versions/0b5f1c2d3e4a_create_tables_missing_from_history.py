"""create tables that were only ever made by db.create_all()

shift_swap, notification, time_entry and break_entry exist on databases that were
bootstrapped with db.create_all(), but no migration ever created them — later
migrations alter them, so `flask db upgrade` failed on a fresh database.

This revision is inserted *before* 72c06bf95b33 and creates each table in the shape
those later migrations expect. Databases that are already past this point never run
it, and every create is skipped if the table already exists.

Revision ID: 0b5f1c2d3e4a
Revises: 707f52f0a927
Create Date: 2026-10-23
"""
from alembic import op
import sqlalchemy as sa


revision = "0b5f1c2d3e4a"
down_revision = "707f52f0a927"
branch_labels = None
depends_on = None


def _has(table: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(table)


def upgrade():
    if not _has("shift_swap"):
        # offered_shift_id / swap_type are added later by b2c3d4e5f6a1.
        op.create_table(
            "shift_swap",
            sa.Column("swap_id", sa.BigInteger(), primary_key=True),
            sa.Column("shift_id", sa.BigInteger(), sa.ForeignKey("shift.shift_id", ondelete="CASCADE", name="fk_shift_swap_shift_id_shift"), nullable=False),
            sa.Column("requesting_user_id", sa.BigInteger(), sa.ForeignKey("app_user.user_id", ondelete="CASCADE", name="fk_shift_swap_requesting_user_id_app_user"), nullable=False),
            sa.Column("receiving_user_id", sa.BigInteger(), sa.ForeignKey("app_user.user_id", ondelete="CASCADE", name="fk_shift_swap_receiving_user_id_app_user"), nullable=True),
            sa.Column("reason", sa.Text(), nullable=True),
            sa.Column("status", sa.Text(), nullable=False, server_default="pending"),
            sa.Column("manager_approved", sa.Boolean(), nullable=True),
            sa.Column("ai_suggested", sa.Boolean(), nullable=False, server_default=sa.text("false")),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("NOW()")),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("NOW()")),
            sa.CheckConstraint("status IN ('pending','accepted','rejected','approved','cancelled')", name="ck_swap_status"),
            sa.PrimaryKeyConstraint("swap_id", name="pk_shift_swap"),
        )

    if not _has("notification"):
        op.create_table(
            "notification",
            sa.Column("notif_id", sa.BigInteger(), primary_key=True),
            sa.Column("user_id", sa.BigInteger(), sa.ForeignKey("app_user.user_id", ondelete="CASCADE", name="fk_notification_user_id_app_user"), nullable=False),
            sa.Column("notif_type", sa.Text(), nullable=False),
            sa.Column("title", sa.Text(), nullable=False),
            sa.Column("body", sa.Text(), nullable=False),
            sa.Column("data", sa.JSON(), nullable=True),
            sa.Column("is_read", sa.Boolean(), nullable=False, server_default=sa.text("false")),
            sa.Column("sent_push", sa.Boolean(), nullable=False, server_default=sa.text("false")),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("NOW()")),
            sa.PrimaryKeyConstraint("notif_id", name="pk_notification"),
        )
        op.create_index("ix_notification_user_id", "notification", ["user_id"])

    if not _has("time_entry"):
        # break_minutes is dropped later by b42f3b726200 in favour of break_entry rows.
        op.create_table(
            "time_entry",
            sa.Column("entry_id", sa.BigInteger(), primary_key=True),
            sa.Column("user_id", sa.BigInteger(), sa.ForeignKey("app_user.user_id", ondelete="CASCADE", name="fk_time_entry_user_id_app_user"), nullable=False),
            sa.Column("shift_id", sa.BigInteger(), sa.ForeignKey("shift.shift_id", ondelete="SET NULL", name="fk_time_entry_shift_id_shift"), nullable=True),
            sa.Column("clock_in", sa.DateTime(timezone=True), nullable=False),
            sa.Column("clock_out", sa.DateTime(timezone=True), nullable=True),
            sa.Column("break_minutes", sa.Integer(), nullable=True),
            sa.Column("total_minutes", sa.Integer(), nullable=True),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("NOW()")),
            sa.PrimaryKeyConstraint("entry_id", name="pk_time_entry"),
        )
        op.create_index("ix_time_entry_user_id", "time_entry", ["user_id"])

    if not _has("break_entry"):
        op.create_table(
            "break_entry",
            sa.Column("break_id", sa.BigInteger(), primary_key=True),
            sa.Column("entry_id", sa.BigInteger(), sa.ForeignKey("time_entry.entry_id", ondelete="CASCADE", name="fk_break_entry_entry_id_time_entry"), nullable=False),
            sa.Column("break_start", sa.DateTime(timezone=True), nullable=False),
            sa.Column("break_end", sa.DateTime(timezone=True), nullable=True),
            sa.Column("duration_minutes", sa.Integer(), nullable=True),
            sa.PrimaryKeyConstraint("break_id", name="pk_break_entry"),
        )
        op.create_index("ix_break_entry_entry_id", "break_entry", ["entry_id"])


def downgrade():
    # These tables pre-date this revision on most databases, so downgrading past it
    # must not drop data that this revision did not create.
    pass
