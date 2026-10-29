"""Side effects the user associates with each medicine."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0022_wellbeing_med_side_effects"
down_revision = "0021_wellbeing_medication_stock"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "wellbeing_medications",
        sa.Column(
            "side_effects",
            postgresql.ARRAY(sa.String(40)),
            nullable=False,
            server_default="{}",
        ),
    )
    op.create_check_constraint(
        "side_effects_count", "wellbeing_medications", "cardinality(side_effects) <= 20"
    )


def downgrade():
    # The lists are the user's own notes: refuse instead of dropping them.
    if (
        op.get_bind()
        .execute(
            sa.text(
                "SELECT EXISTS (SELECT 1 FROM wellbeing_medications "
                "WHERE cardinality(side_effects) > 0)"
            )
        )
        .scalar()
    ):
        raise RuntimeError("Cannot discard wellbeing medication side effects")
    op.drop_constraint(
        "ck_wellbeing_medications_side_effects_count", "wellbeing_medications", "check"
    )
    op.drop_column("wellbeing_medications", "side_effects")
