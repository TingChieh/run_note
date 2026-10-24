"""Local place features and the queue that names runs after nearby places."""

import geoalchemy2
import sqlalchemy as sa
from alembic import op

revision = "0016_place_titles"
down_revision = "0015_route_groups"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "place_features",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("category", sa.String(16), nullable=False),
        sa.Column(
            "geom",
            geoalchemy2.types.Geography(
                geometry_type="GEOMETRY",
                srid=4326,
                dimension=2,
                spatial_index=False,
                from_text="ST_GeogFromText",
                name="geography",
            ),
            nullable=False,
        ),
        sa.Column("region", sa.String(64), nullable=False),
        sa.Column(
            "imported_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("category IN ('lake','river','sea','park','stadium')", name="category"),
    )
    op.create_index("ix_place_features_geom", "place_features", ["geom"], postgresql_using="gist")
    op.create_index("ix_place_features_region", "place_features", ["region"])
    op.create_table(
        "activity_place_names",
        sa.Column("activity_id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("state", sa.String(10), server_default="pending", nullable=False),
        sa.Column("category", sa.String(16), nullable=True),
        sa.Column("share", sa.Float(), nullable=True),
        sa.Column("applied_title", sa.String(120), nullable=True),
        sa.Column("algorithm_version", sa.String(32), nullable=False),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("state IN ('pending','done','skipped')", name="state"),
        sa.CheckConstraint("share IS NULL OR (share >= 0 AND share <= 1)", name="share_range"),
        sa.ForeignKeyConstraint(
            ["activity_id", "user_id"], ["activities.id", "activities.user_id"], ondelete="CASCADE"
        ),
    )
    op.create_index("ix_activity_place_names_user_id", "activity_place_names", ["user_id"])
    op.create_index("ix_activity_place_names_state", "activity_place_names", ["state"])


def downgrade():
    bind = op.get_bind()
    for table in ("activity_place_names", "place_features"):
        if bind.execute(sa.text(f"SELECT 1 FROM {table} LIMIT 1")).first() is not None:
            raise RuntimeError(f"Refusing to drop {table} that already holds data")
    op.drop_table("activity_place_names")
    op.drop_table("place_features")
