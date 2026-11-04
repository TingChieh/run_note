"""Add the number of times a person woke up during the night to a wellbeing day."""

import sqlalchemy as sa
from alembic import op

revision = "0029_wellbeing_sleep_wakeups"
down_revision = "0028_together_switches"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "wellbeing_daily_entries", sa.Column("sleep_wakeups", sa.SmallInteger(), nullable=True)
    )
    op.create_check_constraint(
        "sleep_wakeups_range",
        "wellbeing_daily_entries",
        "sleep_wakeups IS NULL OR sleep_wakeups BETWEEN 0 AND 10",
    )


def downgrade():
    if (
        op.get_bind()
        .execute(
            sa.text(
                "SELECT EXISTS (SELECT 1 FROM wellbeing_daily_entries "
                "WHERE sleep_wakeups IS NOT NULL)"
            )
        )
        .scalar()
    ):
        raise RuntimeError("Refusing to downgrade: recorded night wake-up counts would be lost")
    op.drop_constraint(
        op.f("ck_wellbeing_daily_entries_sleep_wakeups_range"),
        "wellbeing_daily_entries",
        type_="check",
    )
    op.drop_column("wellbeing_daily_entries", "sleep_wakeups")
