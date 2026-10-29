"""Sleep duration to two decimals, so a duration chosen in whole minutes is stored exactly."""

import sqlalchemy as sa
from alembic import op

revision = "0020_wellbeing_sleep_minutes"
down_revision = "0019_wellbeing_symptom_names"
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column(
        "wellbeing_daily_entries",
        "sleep_hours",
        existing_type=sa.Numeric(3, 1),
        type_=sa.Numeric(4, 2),
        existing_nullable=True,
    )


def downgrade():
    # Narrowing to one decimal would round recorded durations: refuse instead.
    if (
        op.get_bind()
        .execute(
            sa.text(
                "SELECT EXISTS (SELECT 1 FROM wellbeing_daily_entries "
                "WHERE sleep_hours IS NOT NULL AND sleep_hours <> round(sleep_hours, 1))"
            )
        )
        .scalar()
    ):
        raise RuntimeError("Cannot round recorded sleep durations")
    op.alter_column(
        "wellbeing_daily_entries",
        "sleep_hours",
        existing_type=sa.Numeric(4, 2),
        type_=sa.Numeric(3, 1),
        existing_nullable=True,
    )
