"""A side effect belongs to the dose it was noted for (deleting the dose removes it)."""

import sqlalchemy as sa
from alembic import op

revision = "0025_wellbeing_effect_dose"
down_revision = "0024_wellbeing_severity_null"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("wellbeing_symptom_events", sa.Column("dose_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_wellbeing_symptom_events_dose_id_wellbeing_dose_events",
        "wellbeing_symptom_events",
        "wellbeing_dose_events",
        ["dose_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index("ix_wellbeing_symptom_events_dose", "wellbeing_symptom_events", ["dose_id"])
    # Side effects written before this change were only dated. Where the day has exactly one dose
    # it is the obvious owner; a day with several (or none) is left unlinked rather than guessed.
    op.execute(
        sa.text(
            """
            UPDATE wellbeing_symptom_events s
            SET dose_id = d.id
            FROM wellbeing_dose_events d
            WHERE d.user_id = s.user_id AND d.entry_date = s.entry_date
              AND (SELECT count(*) FROM wellbeing_dose_events x
                   WHERE x.user_id = s.user_id AND x.entry_date = s.entry_date) = 1
            """
        )
    )


def downgrade():
    # Defensive: dropping the column would forget which dose each side effect belongs to.
    bind = op.get_bind()
    linked = bind.execute(
        sa.text("SELECT count(*) FROM wellbeing_symptom_events WHERE dose_id IS NOT NULL")
    ).scalar()
    if linked:
        raise RuntimeError("Refusing to downgrade: side effects linked to doses exist")
    op.drop_index("ix_wellbeing_symptom_events_dose", table_name="wellbeing_symptom_events")
    op.drop_constraint(
        "fk_wellbeing_symptom_events_dose_id_wellbeing_dose_events",
        "wellbeing_symptom_events",
        type_="foreignkey",
    )
    op.drop_column("wellbeing_symptom_events", "dose_id")
