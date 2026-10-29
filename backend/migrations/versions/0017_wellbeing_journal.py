"""Private wellbeing journal: daily state, dose events and side-effect events."""

import sqlalchemy as sa
from alembic import op

revision = "0017_wellbeing_journal"
down_revision = "0016_place_titles"
branch_labels = None
depends_on = None

RATINGS = ("mood_low", "anxiety", "energy", "focus", "functioning", "sleep_quality")
TABLES = ("wellbeing_symptom_events", "wellbeing_dose_events", "wellbeing_daily_entries")


def owner_column():
    return sa.Column(
        "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )


def timestamps():
    return [
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    ]


def upgrade():
    op.create_table(
        "wellbeing_daily_entries",
        sa.Column("id", sa.Uuid(), primary_key=True),
        owner_column(),
        sa.Column("entry_date", sa.Date(), nullable=False),
        *(sa.Column(name, sa.SmallInteger(), nullable=True) for name in RATINGS),
        sa.Column("sleep_hours", sa.Numeric(3, 1), nullable=True),
        sa.Column("self_harm_thoughts", sa.String(10), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        *timestamps(),
        sa.UniqueConstraint("user_id", "entry_date", name="uq_wellbeing_daily_entries_user_date"),
        *(
            sa.CheckConstraint(f"{name} IS NULL OR {name} BETWEEN 0 AND 10", name=f"{name}_range")
            for name in RATINGS
        ),
        sa.CheckConstraint(
            "sleep_hours IS NULL OR sleep_hours BETWEEN 0 AND 24", name="sleep_hours_range"
        ),
        sa.CheckConstraint(
            "self_harm_thoughts IS NULL OR "
            "self_harm_thoughts IN ('none','brief','persistent','intense')",
            name="self_harm_thoughts_values",
        ),
        sa.CheckConstraint("note IS NULL OR char_length(note) <= 2000", name="note_length"),
    )
    op.create_table(
        "wellbeing_dose_events",
        sa.Column("id", sa.Uuid(), primary_key=True),
        owner_column(),
        sa.Column("entry_date", sa.Date(), nullable=False),
        sa.Column("medication_name", sa.String(80), nullable=False),
        sa.Column("dose_amount", sa.Numeric(9, 3), nullable=False),
        sa.Column("dose_unit", sa.String(16), nullable=False),
        sa.Column("taken_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("regimen", sa.String(12), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        *timestamps(),
        sa.CheckConstraint("char_length(medication_name) >= 1", name="name_present"),
        sa.CheckConstraint("char_length(dose_unit) >= 1", name="unit_present"),
        sa.CheckConstraint("dose_amount > 0 AND dose_amount <= 100000", name="amount_range"),
        sa.CheckConstraint("regimen IN ('scheduled','as_needed')", name="regimen_values"),
        sa.CheckConstraint("note IS NULL OR char_length(note) <= 500", name="note_length"),
    )
    op.create_index(
        "ix_wellbeing_dose_events_user_date", "wellbeing_dose_events", ["user_id", "entry_date"]
    )
    op.create_table(
        "wellbeing_symptom_events",
        sa.Column("id", sa.Uuid(), primary_key=True),
        owner_column(),
        sa.Column("entry_date", sa.Date(), nullable=False),
        sa.Column("symptom", sa.String(40), nullable=False),
        sa.Column("severity", sa.SmallInteger(), nullable=False),
        sa.Column("onset_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("duration_minutes", sa.Integer(), nullable=True),
        sa.Column("affects_daily_life", sa.Boolean(), nullable=True),
        *timestamps(),
        sa.CheckConstraint("char_length(symptom) >= 1", name="symptom_present"),
        sa.CheckConstraint("severity BETWEEN 0 AND 10", name="severity_range"),
        sa.CheckConstraint(
            "duration_minutes IS NULL OR duration_minutes BETWEEN 1 AND 10080",
            name="duration_range",
        ),
    )
    op.create_index(
        "ix_wellbeing_symptom_events_user_date",
        "wellbeing_symptom_events",
        ["user_id", "entry_date"],
    )


def downgrade():
    # Real diary rows are personal health records: refuse instead of silently dropping them.
    bind = op.get_bind()
    for table in TABLES:
        if bind.execute(sa.text(f"SELECT EXISTS (SELECT 1 FROM {table})")).scalar():
            raise RuntimeError("Cannot discard wellbeing journal data")
    for table in TABLES:
        op.drop_table(table)
