"""personal clock-in PINs and punch-in tablets

Revision ID: e4d5e6f7a8b9
Revises: e3c4d5e6f7a8
Create Date: 2026-10-26
"""
from alembic import op
import sqlalchemy as sa

revision = "e4d5e6f7a8b9"
down_revision = "e3c4d5e6f7a8"
branch_labels = None
depends_on = None


def upgrade():
    insp = sa.inspect(op.get_bind())
    cols = {c["name"] for c in insp.get_columns("employment")}
    if "kiosk_pin_hash" not in cols:
        op.add_column("employment", sa.Column("kiosk_pin_hash", sa.Text(), nullable=True))
        op.create_index("ix_employment_kiosk_pin_hash", "employment", ["kiosk_pin_hash"])
    if "kiosk_pin_set_at" not in cols:
        op.add_column("employment", sa.Column("kiosk_pin_set_at", sa.DateTime(), nullable=True))
    if "kiosk_device" not in insp.get_table_names():
        op.create_table(
            "kiosk_device",
            sa.Column("device_id", sa.BigInteger(), primary_key=True),
            sa.Column("location_id", sa.BigInteger(), sa.ForeignKey("location.loc_id", ondelete="CASCADE"), nullable=False),
            sa.Column("name", sa.Text(), nullable=False),
            sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
            sa.Column("created_by", sa.BigInteger(), sa.ForeignKey("app_user.user_id", ondelete="SET NULL"), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("last_seen_at", sa.DateTime(), nullable=True),
            sa.Column("revoked_at", sa.DateTime(), nullable=True),
            sa.Column("failed_attempts", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("locked_until", sa.DateTime(), nullable=True),
        )
        op.create_index("ix_kiosk_device_location_id", "kiosk_device", ["location_id"])


def downgrade():
    op.drop_index("ix_kiosk_device_location_id", table_name="kiosk_device")
    op.drop_table("kiosk_device")
    op.drop_column("employment", "kiosk_pin_set_at")
    op.drop_index("ix_employment_kiosk_pin_hash", table_name="employment")
    op.drop_column("employment", "kiosk_pin_hash")
