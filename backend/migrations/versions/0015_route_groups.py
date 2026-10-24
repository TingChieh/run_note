"""Route fingerprints and groups for the frequent-routes summary."""

import geoalchemy2
import sqlalchemy as sa
from alembic import op

revision = "0015_route_groups"
down_revision = "0014_activity_province_caches"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "route_fingerprints",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("activity_id", sa.Uuid(), nullable=False),
        sa.Column("algorithm_version", sa.String(32), nullable=False),
        sa.Column(
            "geom",
            geoalchemy2.types.Geometry(
                geometry_type="MULTILINESTRING",
                srid=4326,
                dimension=2,
                spatial_index=False,
                from_text="ST_GeomFromEWKT",
                name="geometry",
            ),
            nullable=True,
        ),
        sa.Column(
            "generated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint("activity_id"),
        sa.ForeignKeyConstraint(
            ["activity_id", "user_id"], ["activities.id", "activities.user_id"], ondelete="CASCADE"
        ),
    )
    op.create_index("ix_route_fingerprints_user_id", "route_fingerprints", ["user_id"])
    op.create_index(
        "ix_route_fingerprints_geom", "route_fingerprints", ["geom"], postgresql_using="gist"
    )
    op.create_table(
        "route_groups",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("algorithm_version", sa.String(32), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_route_groups_user_id", "route_groups", ["user_id"])
    op.create_table(
        "route_group_members",
        sa.Column("activity_id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "group_id",
            sa.Uuid(),
            sa.ForeignKey("route_groups.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("coverage", sa.Float(), nullable=False),
        sa.CheckConstraint("coverage >= 0 AND coverage <= 1", name="coverage_range"),
        sa.ForeignKeyConstraint(
            ["activity_id", "user_id"], ["activities.id", "activities.user_id"], ondelete="CASCADE"
        ),
    )
    op.create_index("ix_route_group_members_user_id", "route_group_members", ["user_id"])
    op.create_index("ix_route_group_members_group_id", "route_group_members", ["group_id"])


def downgrade():
    bind = op.get_bind()
    for table in ("route_group_members", "route_groups", "route_fingerprints"):
        if bind.execute(sa.text(f"SELECT 1 FROM {table} LIMIT 1")).first() is not None:
            raise RuntimeError(f"Refusing to drop {table} that already holds data")
    op.drop_table("route_group_members")
    op.drop_table("route_groups")
    op.drop_table("route_fingerprints")
