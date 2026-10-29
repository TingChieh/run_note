"""Side effects are noted without a score; a severity stays optional (and old scores are kept)."""

import sqlalchemy as sa
from alembic import op

revision = "0024_wellbeing_severity_null"
down_revision = "0023_wellbeing_mood_rename"
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column(
        "wellbeing_symptom_events", "severity", existing_type=sa.SmallInteger(), nullable=True
    )


def downgrade():
    # Defensive: unscored side effects cannot be given a made-up number.
    bind = op.get_bind()
    unscored = bind.execute(
        sa.text("SELECT count(*) FROM wellbeing_symptom_events WHERE severity IS NULL")
    ).scalar()
    if unscored:
        raise RuntimeError("Refusing to downgrade: side effects without a severity exist")
    op.alter_column(
        "wellbeing_symptom_events", "severity", existing_type=sa.SmallInteger(), nullable=False
    )
