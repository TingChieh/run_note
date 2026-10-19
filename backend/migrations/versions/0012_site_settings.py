"""Single-row site settings, owner-managed site images and per-user avatars."""

import sqlalchemy as sa
from alembic import op

revision = "0012_site_settings"
down_revision = "0011_admin_user_states"
branch_labels = None
depends_on = None

DEFAULTS = {
    "title": "RunNote",
    "subtitle": "跑步与足迹",
    "footer_tagline": "记录每一步，看见你的进步。",
    "description": "汇总你的跑步数据、活动日历与运动趋势，从这里探索记录、足迹和 AI 分析。",
    "default_theme": "system",
}


def timestamp():
    return sa.Column(
        "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )


def upgrade():
    op.create_table(
        "site_settings",
        sa.Column("id", sa.SmallInteger(), primary_key=True),
        sa.Column("title", sa.String(40), nullable=False, server_default=DEFAULTS["title"]),
        sa.Column("subtitle", sa.String(40), nullable=False, server_default=DEFAULTS["subtitle"]),
        sa.Column(
            "footer_tagline",
            sa.String(80),
            nullable=False,
            server_default=DEFAULTS["footer_tagline"],
        ),
        sa.Column(
            "description", sa.String(200), nullable=False, server_default=DEFAULTS["description"]
        ),
        sa.Column(
            "default_theme",
            sa.String(10),
            nullable=False,
            server_default=DEFAULTS["default_theme"],
        ),
        timestamp(),
        sa.CheckConstraint("id = 1", name=op.f("ck_site_settings_singleton")),
        sa.CheckConstraint(
            "char_length(btrim(title)) > 0", name=op.f("ck_site_settings_title_present")
        ),
        sa.CheckConstraint(
            "default_theme IN ('system','light','dark')",
            name=op.f("ck_site_settings_default_theme_valid"),
        ),
    )
    op.execute("INSERT INTO site_settings (id) VALUES (1)")
    op.create_table(
        "site_images",
        sa.Column("kind", sa.String(10), primary_key=True),
        sa.Column("png_bytes", sa.LargeBinary(), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        timestamp(),
        sa.CheckConstraint("kind IN ('favicon','logo')", name=op.f("ck_site_images_kind_valid")),
        sa.CheckConstraint("octet_length(png_bytes) > 0", name=op.f("ck_site_images_png_present")),
    )
    op.create_table(
        "user_avatars",
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey(
                "users.id", ondelete="CASCADE", name=op.f("fk_user_avatars_user_id_users")
            ),
            primary_key=True,
        ),
        sa.Column("png_bytes", sa.LargeBinary(), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        timestamp(),
        sa.CheckConstraint("octet_length(png_bytes) > 0", name=op.f("ck_user_avatars_png_present")),
    )
    op.add_column("users", sa.Column("avatar_version", sa.String(16), nullable=True))


def downgrade():
    customized = " OR ".join(f"{column} <> :{column}" for column in DEFAULTS)
    if (
        op.get_bind()
        .execute(
            sa.text(
                "SELECT EXISTS (SELECT 1 FROM site_images) "
                "OR EXISTS (SELECT 1 FROM user_avatars) "
                f"OR EXISTS (SELECT 1 FROM site_settings WHERE {customized})"
            ),
            DEFAULTS,
        )
        .scalar()
    ):
        raise RuntimeError("Cannot discard customized site settings, site images or avatars")
    op.drop_column("users", "avatar_version")
    op.drop_table("user_avatars")
    op.drop_table("site_images")
    op.drop_table("site_settings")
