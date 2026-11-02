"""Add administrator and personal wellbeing switches."""

import sqlalchemy as sa
from alembic import op

revision = "0026_wellbeing_switches"
down_revision = "0025_wellbeing_effect_dose"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "users",
        sa.Column("wellbeing_allowed", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.add_column(
        "users",
        sa.Column("wellbeing_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
    )


def downgrade():
    if (
        op.get_bind()
        .execute(
            sa.text(
                "SELECT EXISTS (SELECT 1 FROM users "
                "WHERE NOT wellbeing_allowed OR NOT wellbeing_enabled)"
            )
        )
        .scalar()
    ):
        raise RuntimeError("Refusing to downgrade: wellbeing switch settings would be lost")
    op.drop_column("users", "wellbeing_enabled")
    op.drop_column("users", "wellbeing_allowed")
