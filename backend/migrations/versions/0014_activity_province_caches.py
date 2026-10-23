"""Per-activity province derivatives for the cumulative province summary."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import ARRAY

revision = "0014_activity_province_caches"
down_revision = "0013_backfill_distance_category"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "activity_province_caches",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("activity_id", sa.Uuid(), nullable=False),
        sa.Column("atlas_version", sa.String(64), nullable=False),
        sa.Column("province_codes", ARRAY(sa.Integer()), nullable=False),
        sa.Column(
            "generated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint("activity_id"),
        sa.ForeignKeyConstraint(
            ["activity_id", "user_id"], ["activities.id", "activities.user_id"], ondelete="CASCADE"
        ),
    )
    op.create_index("ix_activity_province_caches_user_id", "activity_province_caches", ["user_id"])


def downgrade():
    if (
        op.get_bind().execute(sa.text("SELECT 1 FROM activity_province_caches LIMIT 1")).first()
        is not None
    ):
        raise RuntimeError("Refusing to drop province caches that already hold data")
    op.drop_index("ix_activity_province_caches_user_id", table_name="activity_province_caches")
    op.drop_table("activity_province_caches")
