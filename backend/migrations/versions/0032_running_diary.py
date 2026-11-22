"""Private running diaries and transactional photo storage."""

import sqlalchemy as sa
from alembic import op

revision = "0032_running_diary"
down_revision = "0031_shoes"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "activity_diaries",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("activity_id", sa.Uuid(), nullable=False),
        sa.Column("mood", sa.String(32), nullable=True),
        sa.Column("rpe", sa.SmallInteger(), nullable=True),
        sa.Column("weather", sa.String(64), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint("activity_id", name=op.f("uq_activity_diaries_activity_id")),
        sa.UniqueConstraint("id", "user_id", name="uq_activity_diaries_id_user_id"),
        sa.ForeignKeyConstraint(
            ["activity_id", "user_id"],
            ["activities.id", "activities.user_id"],
            name=op.f("fk_activity_diaries_activity_id_activities"),
            ondelete="CASCADE",
        ),
        sa.CheckConstraint(
            "mood IN ('very_bad', 'bad', 'neutral', 'good', 'very_good')",
            name=op.f("ck_activity_diaries_mood_valid"),
        ),
        sa.CheckConstraint("rpe BETWEEN 1 AND 10", name=op.f("ck_activity_diaries_rpe_range")),
        sa.CheckConstraint(
            "weather IN ('clear', 'cloudy', 'rain', 'snow', 'windy', 'other')",
            name=op.f("ck_activity_diaries_weather_valid"),
        ),
        sa.CheckConstraint(
            "char_length(notes) <= 5000", name=op.f("ck_activity_diaries_notes_length")
        ),
    )
    op.create_index("ix_activity_diaries_user_id", "activity_diaries", ["user_id"])

    op.create_table(
        "activity_diary_photos",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("diary_id", sa.Uuid(), nullable=False),
        sa.Column("png", sa.LargeBinary(), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["diary_id", "user_id"],
            ["activity_diaries.id", "activity_diaries.user_id"],
            name=op.f("fk_activity_diary_photos_diary_id_activity_diaries"),
            ondelete="CASCADE",
        ),
        sa.CheckConstraint(
            "octet_length(png) BETWEEN 1 AND 5242880",
            name=op.f("ck_activity_diary_photos_png_size"),
        ),
        sa.CheckConstraint(
            "width BETWEEN 1 AND 1100", name=op.f("ck_activity_diary_photos_width_range")
        ),
        sa.CheckConstraint(
            "height BETWEEN 1 AND 1100", name=op.f("ck_activity_diary_photos_height_range")
        ),
    )
    op.create_index("ix_activity_diary_photos_user_id", "activity_diary_photos", ["user_id"])
    op.create_index(
        "ix_activity_diary_photos_diary_id_created_at",
        "activity_diary_photos",
        ["diary_id", "created_at", "id"],
    )


def downgrade():
    # Keep writes out between the guard and DROP TABLE in the same transaction.
    op.execute("LOCK TABLE activity_diaries, activity_diary_photos IN ACCESS EXCLUSIVE MODE")
    has_data = op.get_bind().scalar(
        sa.text(
            "SELECT EXISTS (SELECT 1 FROM activity_diary_photos) OR "
            "EXISTS (SELECT 1 FROM activity_diaries)"
        )
    )
    if has_data:
        raise RuntimeError("Refusing to drop running diaries or photos that already hold data")
    op.drop_table("activity_diary_photos")
    op.drop_table("activity_diaries")
