"""User-maintained medication list for the wellbeing journal (names and default doses)."""

import sqlalchemy as sa
from alembic import op

revision = "0018_wellbeing_medications"
down_revision = "0017_wellbeing_journal"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "wellbeing_medications",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("default_amount", sa.Numeric(9, 3), nullable=True),
        sa.Column("default_unit", sa.String(16), nullable=True),
        sa.Column("regimen", sa.String(12), nullable=False, server_default="scheduled"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("char_length(name) >= 1", name="name_present"),
        sa.CheckConstraint(
            "default_amount IS NULL OR (default_amount > 0 AND default_amount <= 100000)",
            name="amount_range",
        ),
        sa.CheckConstraint(
            "default_unit IS NULL OR char_length(default_unit) >= 1", name="unit_present"
        ),
        sa.CheckConstraint("regimen IN ('scheduled','as_needed')", name="regimen_values"),
    )
    op.create_index(
        "uq_wellbeing_medications_user_name",
        "wellbeing_medications",
        ["user_id", sa.text("lower(name)")],
        unique=True,
    )


def downgrade():
    # The list is the user's own setup; refuse instead of silently dropping it.
    if (
        op.get_bind()
        .execute(sa.text("SELECT EXISTS (SELECT 1 FROM wellbeing_medications)"))
        .scalar()
    ):
        raise RuntimeError("Cannot discard wellbeing medication list")
    op.drop_table("wellbeing_medications")
