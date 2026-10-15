"""Private per-activity derivatives and atomic all-record footprint snapshots."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0010_footprint_snapshots"
down_revision = "0009_mifitness_imports"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "footprint_activity_caches",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("activity_id", sa.Uuid(), nullable=False),
        sa.Column("algorithm_version", sa.String(32), nullable=False),
        sa.Column("tracks", JSONB(), nullable=False),
        sa.Column("cells", JSONB(), nullable=False),
        sa.Column("unsupported_segment_count", sa.Integer(), nullable=False),
        sa.Column(
            "generated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint("activity_id"),
        sa.ForeignKeyConstraint(
            ["activity_id", "user_id"], ["activities.id", "activities.user_id"], ondelete="CASCADE"
        ),
        sa.CheckConstraint("unsupported_segment_count >= 0", name="unsupported_nonnegative"),
    )
    op.create_index(
        "ix_footprint_activity_caches_user_id", "footprint_activity_caches", ["user_id"]
    )
    op.create_table(
        "footprint_snapshots",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("source_version", sa.BigInteger(), nullable=True),
        sa.Column("algorithm_version", sa.String(32), nullable=True),
        sa.Column("generated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("tracks", JSONB(), nullable=True),
        sa.Column("heatmap", JSONB(), nullable=True),
        sa.Column("state", sa.String(16), server_default="idle", nullable=False),
        sa.Column("target_version", sa.BigInteger(), nullable=True),
        sa.Column("failure_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("retry_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("attempt_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint("user_id"),
        sa.CheckConstraint("state IN ('idle','building','failed')", name="state"),
        sa.CheckConstraint("failure_count >= 0", name="failure_nonnegative"),
        sa.CheckConstraint(
            "source_version >= 0 AND target_version >= 0", name="version_nonnegative"
        ),
    )


def downgrade():
    if (
        op.get_bind()
        .execute(
            sa.text(
                "SELECT 1 FROM footprint_snapshots UNION ALL "
                "SELECT 1 FROM footprint_activity_caches LIMIT 1"
            )
        )
        .first()
    ):
        raise RuntimeError("Cannot downgrade while footprint derivatives exist; retain data")
    op.drop_table("footprint_snapshots")
    op.drop_table("footprint_activity_caches")
