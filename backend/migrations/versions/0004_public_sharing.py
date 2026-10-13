"""Public profile biography and revocable summary sharing; private defaults unchanged."""

import sqlalchemy as sa
from alembic import op

revision = "0004_public_sharing"
down_revision = "0003_gpx_storage"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("bio", sa.String(500), nullable=False, server_default=""))
    op.create_check_constraint(op.f("ck_users_bio_length"), "users", "char_length(bio) <= 500")
    op.create_table(
        "activity_share_links",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "activity_id",
            sa.Uuid(),
            sa.ForeignKey("activities.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True)),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint(
            "expires_at IS NULL OR expires_at > created_at",
            name=op.f("ck_activity_share_links_expiry_order"),
        ),
    )
    op.create_index("ix_activity_share_links_activity", "activity_share_links", ["activity_id"])
    op.create_index(
        "ix_activities_public_owner_date",
        "activities",
        ["user_id", sa.text("activity_date DESC"), sa.text("id DESC")],
        postgresql_where=sa.text("visibility='public'"),
    )


def downgrade():
    op.drop_index("ix_activities_public_owner_date", table_name="activities")
    op.drop_table("activity_share_links")
    op.drop_constraint(op.f("ck_users_bio_length"), "users", type_="check")
    op.drop_column("users", "bio")
