"""Private shoes and owner-scoped activity bindings."""

import sqlalchemy as sa
from alembic import op

revision = "0031_shoes"
down_revision = "0030_global_footprint_caches"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "shoes",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("brand", sa.String(60)),
        sa.Column("model", sa.String(60)),
        sa.Column("notes", sa.Text()),
        sa.Column("purchased_on", sa.Date()),
        sa.Column("retired_on", sa.Date()),
        sa.Column("initial_distance_m", sa.Numeric(12, 3), server_default="0", nullable=False),
        sa.Column("replacement_distance_m", sa.Numeric(12, 3)),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint("id", "user_id", name="uq_shoes_id_user_id"),
        sa.CheckConstraint("char_length(btrim(name)) BETWEEN 1 AND 80", name="name_length"),
        sa.CheckConstraint("char_length(notes) <= 1000", name="notes_length"),
        sa.CheckConstraint(
            "initial_distance_m >= 0 AND initial_distance_m < 1000000000", name="initial_range"
        ),
        sa.CheckConstraint(
            "replacement_distance_m > 0 AND replacement_distance_m < 1000000000",
            name="replacement_range",
        ),
        sa.CheckConstraint("retired_on >= purchased_on", name="date_order"),
    )
    op.create_index("ix_shoes_user_id", "shoes", ["user_id"])
    op.add_column("activities", sa.Column("shoe_id", sa.Uuid()))
    op.create_foreign_key(
        "fk_activities_shoe_id_shoes",
        "activities",
        "shoes",
        ["shoe_id", "user_id"],
        ["id", "user_id"],
        ondelete="RESTRICT",
    )
    op.create_index(
        "ix_activities_owner_shoe_date_id",
        "activities",
        ["user_id", "shoe_id", sa.text("activity_date DESC"), sa.text("id DESC")],
        postgresql_where=sa.text("shoe_id IS NOT NULL"),
    )


def downgrade():
    has_data = op.get_bind().scalar(
        sa.text(
            "SELECT EXISTS (SELECT 1 FROM shoes) OR "
            "EXISTS (SELECT 1 FROM activities WHERE shoe_id IS NOT NULL)"
        )
    )
    if has_data:
        raise RuntimeError("Refusing to drop shoes or existing activity bindings")
    op.drop_index("ix_activities_owner_shoe_date_id", table_name="activities")
    op.drop_constraint("fk_activities_shoe_id_shoes", "activities", type_="foreignkey")
    op.drop_column("activities", "shoe_id")
    op.drop_index("ix_shoes_user_id", table_name="shoes")
    op.drop_table("shoes")
