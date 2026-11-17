"""Per-activity global region and city footprint derivatives."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import ARRAY

revision = "0030_global_footprint_caches"
down_revision = "0029_wellbeing_sleep_wakeups"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "activity_global_footprint_caches",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("activity_id", sa.Uuid(), nullable=False),
        sa.Column("atlas_version", sa.String(64), nullable=False),
        sa.Column("region_codes", ARRAY(sa.String(32)), nullable=False),
        sa.Column("city_codes", ARRAY(sa.String(32)), nullable=False),
        sa.Column(
            "generated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint("activity_id"),
        sa.ForeignKeyConstraint(
            ["activity_id", "user_id"], ["activities.id", "activities.user_id"], ondelete="CASCADE"
        ),
    )
    op.create_index(
        "ix_activity_global_footprint_caches_user_id",
        "activity_global_footprint_caches",
        ["user_id"],
    )


def downgrade():
    if (
        op.get_bind()
        .execute(sa.text("SELECT 1 FROM activity_global_footprint_caches LIMIT 1"))
        .first()
        is not None
    ):
        raise RuntimeError("Refusing to drop global footprint caches that already hold data")
    op.drop_index(
        "ix_activity_global_footprint_caches_user_id",
        table_name="activity_global_footprint_caches",
    )
    op.drop_table("activity_global_footprint_caches")
