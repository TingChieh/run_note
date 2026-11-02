"""Track the last self-service username change."""

import sqlalchemy as sa
from alembic import op

revision = "0027_username_changed_at"
down_revision = "0026_wellbeing_switches"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "users", sa.Column("username_changed_at", sa.DateTime(timezone=True), nullable=True)
    )


def downgrade():
    if (
        op.get_bind()
        .execute(sa.text("SELECT count(*) FROM users WHERE username_changed_at IS NOT NULL"))
        .scalar()
    ):
        raise RuntimeError("Refusing to discard username change history")
    op.drop_column("users", "username_changed_at")
