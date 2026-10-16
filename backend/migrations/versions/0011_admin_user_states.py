"""Explicit opt-in login and full showcase states for administrator-managed users."""

import sqlalchemy as sa
from alembic import op

revision = "0011_admin_user_states"
down_revision = "0010_footprint_snapshots"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "users", sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.false())
    )
    op.add_column(
        "users",
        sa.Column("showcase_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade():
    # Refuse every enabled/public row, including the owner: stricter than required,
    # avoiding dependence on runtime settings when invoking offline migrations.
    if (
        op.get_bind()
        .execute(sa.text("SELECT EXISTS (SELECT 1 FROM users WHERE is_active OR showcase_enabled)"))
        .scalar()
    ):
        raise RuntimeError("Cannot discard active or public user state")
    op.drop_column("users", "showcase_enabled")
    op.drop_column("users", "is_active")
