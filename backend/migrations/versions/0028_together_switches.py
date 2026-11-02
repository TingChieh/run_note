"""Add administrator and personal together switches."""

import sqlalchemy as sa
from alembic import op

revision = "0028_together_switches"
down_revision = "0027_username_changed_at"
branch_labels = None
depends_on = None


def upgrade():
    for name in ("together_allowed", "together_enabled"):
        op.add_column(
            "users", sa.Column(name, sa.Boolean(), nullable=False, server_default=sa.false())
        )


def downgrade():
    if (
        op.get_bind()
        .execute(
            sa.text(
                "SELECT EXISTS (SELECT 1 FROM users WHERE together_allowed OR together_enabled)"
            )
        )
        .scalar()
    ):
        raise RuntimeError("Refusing to downgrade: together switch settings would be lost")
    op.drop_column("users", "together_enabled")
    op.drop_column("users", "together_allowed")
