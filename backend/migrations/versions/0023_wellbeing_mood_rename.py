"""Mood is recorded as how happy the day was (higher is better), not how low (higher is worse)."""

from alembic import op

revision = "0023_wellbeing_mood_rename"
down_revision = "0022_wellbeing_med_side_effects"
branch_labels = None
depends_on = None


def upgrade():
    # The scale flips with the name: an old "mood_low" of 7 (quite low) becomes a "mood" of 3.
    op.alter_column("wellbeing_daily_entries", "mood_low", new_column_name="mood")
    op.execute("UPDATE wellbeing_daily_entries SET mood = 10 - mood WHERE mood IS NOT NULL")
    op.execute(
        "ALTER TABLE wellbeing_daily_entries "
        "RENAME CONSTRAINT ck_wellbeing_daily_entries_mood_low_range "
        "TO ck_wellbeing_daily_entries_mood_range"
    )


def downgrade():
    # Lossless: the same flip and rename in reverse, so recorded days are kept.
    op.execute(
        "ALTER TABLE wellbeing_daily_entries "
        "RENAME CONSTRAINT ck_wellbeing_daily_entries_mood_range "
        "TO ck_wellbeing_daily_entries_mood_low_range"
    )
    op.execute("UPDATE wellbeing_daily_entries SET mood = 10 - mood WHERE mood IS NOT NULL")
    op.alter_column("wellbeing_daily_entries", "mood", new_column_name="mood_low")
