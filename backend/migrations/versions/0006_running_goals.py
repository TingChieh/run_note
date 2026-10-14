"""Persist private per-account calendar goal settings."""

import sqlalchemy as sa
from alembic import op

revision = "0006_running_goals"
down_revision = "0005_ai_reports"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "running_goals",
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("period", sa.String(5), primary_key=True),
        sa.Column("target_km", sa.Numeric(7, 1), nullable=False),
        sa.CheckConstraint(
            "period IN ('week','month','year')", name=op.f("ck_running_goals_period")
        ),
        sa.CheckConstraint(
            "target_km > 0 AND target_km <= 100000", name=op.f("ck_running_goals_target_range")
        ),
    )


def downgrade():
    op.drop_table("running_goals")
