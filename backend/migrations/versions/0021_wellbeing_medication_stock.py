"""Medication stock: box size, strength per pill, usual pills, a stock ledger, pills on doses."""

import sqlalchemy as sa
from alembic import op

revision = "0021_wellbeing_medication_stock"
down_revision = "0020_wellbeing_sleep_minutes"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "wellbeing_medications",
        sa.Column("count_unit", sa.String(8), nullable=False, server_default="颗"),
    )
    op.add_column("wellbeing_medications", sa.Column("pills_per_box", sa.Integer(), nullable=True))
    op.add_column(
        "wellbeing_medications", sa.Column("strength_amount", sa.Numeric(9, 3), nullable=True)
    )
    op.add_column("wellbeing_medications", sa.Column("strength_unit", sa.String(16), nullable=True))
    op.add_column(
        "wellbeing_medications", sa.Column("default_pills", sa.Numeric(6, 2), nullable=True)
    )
    # The earlier "usual dose" becomes the strength of one pill.
    # Only complete pairs carry over (a lone unit or amount cannot describe a strength).
    op.execute(
        "UPDATE wellbeing_medications SET strength_amount = default_amount, "
        "strength_unit = default_unit "
        "WHERE default_amount IS NOT NULL AND default_unit IS NOT NULL"
    )
    op.drop_column("wellbeing_medications", "default_amount")
    op.drop_column("wellbeing_medications", "default_unit")
    op.create_check_constraint(
        "count_unit_present", "wellbeing_medications", "char_length(count_unit) >= 1"
    )
    op.create_check_constraint(
        "box_size_range",
        "wellbeing_medications",
        "pills_per_box IS NULL OR (pills_per_box >= 1 AND pills_per_box <= 10000)",
    )
    op.create_check_constraint(
        "strength_range",
        "wellbeing_medications",
        "strength_amount IS NULL OR (strength_amount > 0 AND strength_amount <= 100000)",
    )
    op.create_check_constraint(
        "strength_pair",
        "wellbeing_medications",
        "(strength_amount IS NULL) = (strength_unit IS NULL)",
    )
    op.create_check_constraint(
        "default_pills_range",
        "wellbeing_medications",
        "default_pills IS NULL OR (default_pills > 0 AND default_pills <= 1000)",
    )

    op.create_table(
        "wellbeing_stock_movements",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "medication_id",
            sa.Uuid(),
            sa.ForeignKey("wellbeing_medications.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(8), nullable=False),
        sa.Column("pills", sa.Numeric(9, 2), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("kind IN ('restock','adjust')", name="kind_values"),
        sa.CheckConstraint("pills <> 0", name="pills_nonzero"),
    )
    op.create_index(
        "ix_wellbeing_stock_movements_medication", "wellbeing_stock_movements", ["medication_id"]
    )

    op.add_column("wellbeing_dose_events", sa.Column("pills", sa.Numeric(6, 2), nullable=True))
    op.add_column(
        "wellbeing_dose_events",
        sa.Column(
            "medication_id",
            sa.Uuid(),
            sa.ForeignKey("wellbeing_medications.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.alter_column("wellbeing_dose_events", "dose_amount", nullable=True)
    op.alter_column("wellbeing_dose_events", "dose_unit", nullable=True)
    op.create_check_constraint(
        "pills_range", "wellbeing_dose_events", "pills IS NULL OR (pills > 0 AND pills <= 1000)"
    )
    op.create_check_constraint(
        "has_quantity",
        "wellbeing_dose_events",
        "pills IS NOT NULL OR (dose_amount IS NOT NULL AND dose_unit IS NOT NULL)",
    )
    op.create_index(
        "ix_wellbeing_dose_events_medication", "wellbeing_dose_events", ["medication_id"]
    )


def downgrade():
    # Stock counts and pill-based doses have no older form: refuse instead of dropping them.
    bind = op.get_bind()
    for query in (
        "SELECT EXISTS (SELECT 1 FROM wellbeing_stock_movements)",
        "SELECT EXISTS (SELECT 1 FROM wellbeing_dose_events WHERE pills IS NOT NULL "
        "OR dose_amount IS NULL)",
    ):
        if bind.execute(sa.text(query)).scalar():
            raise RuntimeError("Cannot discard wellbeing medication stock data")
    op.drop_index("ix_wellbeing_dose_events_medication", table_name="wellbeing_dose_events")
    op.drop_constraint("ck_wellbeing_dose_events_has_quantity", "wellbeing_dose_events", "check")
    op.drop_constraint("ck_wellbeing_dose_events_pills_range", "wellbeing_dose_events", "check")
    op.alter_column("wellbeing_dose_events", "dose_unit", nullable=False)
    op.alter_column("wellbeing_dose_events", "dose_amount", nullable=False)
    op.drop_column("wellbeing_dose_events", "medication_id")
    op.drop_column("wellbeing_dose_events", "pills")
    op.drop_table("wellbeing_stock_movements")
    op.add_column("wellbeing_medications", sa.Column("default_amount", sa.Numeric(9, 3)))
    op.add_column("wellbeing_medications", sa.Column("default_unit", sa.String(16)))
    op.execute(
        "UPDATE wellbeing_medications SET default_amount = strength_amount, "
        "default_unit = strength_unit"
    )
    for column in (
        "default_pills",
        "strength_unit",
        "strength_amount",
        "pills_per_box",
        "count_unit",
    ):
        op.drop_column("wellbeing_medications", column)
