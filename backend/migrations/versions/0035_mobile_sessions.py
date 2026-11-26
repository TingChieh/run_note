"""Add 0035_mobile_sessions table and mobile-refresh-ip rate limit scope."""

import sqlalchemy as sa
from alembic import op

revision = "0035_mobile_sessions"
down_revision = "0034_drop_ai_reports"
branch_labels = None
depends_on = None

_OLD_SCOPES = "scope IN ('login-account','login-ip','register-ip','csrf-ip')"
_NEW_SCOPES = "scope IN ('login-account','login-ip','register-ip','csrf-ip','mobile-refresh-ip')"


def upgrade() -> None:
    op.create_table(
        "mobile_sessions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("token_family_id", sa.Uuid(), nullable=False),
        sa.Column("access_token_hash", sa.CHAR(length=64), nullable=False),
        sa.Column("refresh_token_hash", sa.CHAR(length=64), nullable=False),
        sa.Column("device_label", sa.String(length=80), server_default="", nullable=False),
        sa.Column("client_version", sa.String(length=32), server_default="", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "last_used_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("access_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("refresh_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("rotated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_mobile_sessions_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_mobile_sessions")),
        sa.UniqueConstraint("access_token_hash", name=op.f("uq_mobile_sessions_access_token_hash")),
        sa.UniqueConstraint(
            "refresh_token_hash", name=op.f("uq_mobile_sessions_refresh_token_hash")
        ),
    )
    op.create_index("ix_mobile_sessions_user_id", "mobile_sessions", ["user_id"], unique=False)
    op.create_index(
        "ix_mobile_sessions_token_family_id", "mobile_sessions", ["token_family_id"], unique=False
    )
    op.create_index(
        "ix_mobile_sessions_refresh_expires_at",
        "mobile_sessions",
        ["refresh_expires_at"],
        unique=False,
    )
    op.drop_constraint(op.f("ck_auth_rate_buckets_scope"), "auth_rate_buckets", type_="check")
    op.create_check_constraint(
        op.f("ck_auth_rate_buckets_scope"),
        "auth_rate_buckets",
        _NEW_SCOPES,
    )


def downgrade() -> None:
    connection = op.get_bind()
    has_sessions = connection.execute(
        sa.text("SELECT EXISTS (SELECT 1 FROM mobile_sessions)")
    ).scalar()
    has_buckets = connection.execute(
        sa.text("SELECT EXISTS (SELECT 1 FROM auth_rate_buckets WHERE scope = 'mobile-refresh-ip')")
    ).scalar()
    if has_sessions or has_buckets:
        raise RuntimeError(
            "Refusing to downgrade 0035_mobile_sessions while mobile session or rate bucket data "
            "exists; restore from a pre-migration backup instead."
        )
    op.drop_constraint(op.f("ck_auth_rate_buckets_scope"), "auth_rate_buckets", type_="check")
    op.create_check_constraint(
        op.f("ck_auth_rate_buckets_scope"),
        "auth_rate_buckets",
        _OLD_SCOPES,
    )
    op.drop_index("ix_mobile_sessions_refresh_expires_at", table_name="mobile_sessions")
    op.drop_index("ix_mobile_sessions_token_family_id", table_name="mobile_sessions")
    op.drop_index("ix_mobile_sessions_user_id", table_name="mobile_sessions")
    op.drop_table("mobile_sessions")
