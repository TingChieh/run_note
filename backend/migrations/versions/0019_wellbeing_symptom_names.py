"""Wellbeing journal: side-effect names; the self-report thoughts item is removed."""

import sqlalchemy as sa
from alembic import op

revision = "0019_wellbeing_symptom_names"
down_revision = "0018_wellbeing_medications"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "wellbeing_symptom_names",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("name", sa.String(40), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("char_length(name) >= 1", name="name_present"),
    )
    op.create_index(
        "uq_wellbeing_symptom_names_user_name",
        "wellbeing_symptom_names",
        ["user_id", sa.text("lower(name)")],
        unique=True,
    )
    # The item was never shown in a release; dropping the column also drops its CHECK constraint.
    op.drop_column("wellbeing_daily_entries", "self_harm_thoughts")


def downgrade():
    if (
        op.get_bind()
        .execute(sa.text("SELECT EXISTS (SELECT 1 FROM wellbeing_symptom_names)"))
        .scalar()
    ):
        raise RuntimeError("Cannot discard wellbeing side-effect list")
    op.drop_table("wellbeing_symptom_names")
    op.add_column("wellbeing_daily_entries", sa.Column("self_harm_thoughts", sa.String(10)))
    op.create_check_constraint(
        "self_harm_thoughts_values",
        "wellbeing_daily_entries",
        "self_harm_thoughts IS NULL OR "
        "self_harm_thoughts IN ('none','brief','persistent','intense')",
    )
