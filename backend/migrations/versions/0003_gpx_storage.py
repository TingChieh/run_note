"""Add 0003_gpx_storage tables; upgrade only adds release-owned objects."""

import geoalchemy2
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0003_gpx_storage"
down_revision = "0002_auth"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "activities",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("source", sa.String(length=10), nullable=False),
        sa.Column("title", sa.String(length=120), nullable=False),
        sa.Column("notes", sa.Text(), server_default="", nullable=False),
        sa.Column("activity_date", sa.Date(), nullable=False),
        sa.Column("date_source", sa.String(length=16), nullable=False),
        sa.Column("timezone", sa.String(length=64), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("distance_m", sa.Numeric(precision=12, scale=3), nullable=False),
        sa.Column("elapsed_seconds", sa.Numeric(precision=12, scale=3), nullable=True),
        sa.Column("avg_pace_seconds_per_km", sa.Numeric(precision=12, scale=3), nullable=True),
        sa.Column("temporal_quality", sa.String(length=16), nullable=False),
        sa.Column("quality_summary", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("metrics_version", sa.String(length=32), nullable=False),
        sa.Column("visibility", sa.String(length=10), server_default="private", nullable=False),
        sa.Column("allow_shared_route", sa.Boolean(), server_default="false", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "date_source IN ('timestamp','manual')", name=op.f("ck_activities_date_source")
        ),
        sa.CheckConstraint("source IN ('gpx','manual')", name=op.f("ck_activities_source")),
        sa.CheckConstraint(
            (
                "temporal_quality != 'incomplete' OR (elapsed_seconds IS NULL AND "
                "avg_pace_seconds_per_km IS NULL)"
            ),
            name=op.f("ck_activities_incomplete_time_metrics"),
        ),
        sa.CheckConstraint(
            (
                "temporal_quality != 'invalid' OR (ended_at IS NULL AND elapsed_seconds"
                " IS NULL AND avg_pace_seconds_per_km IS NULL)"
            ),
            name=op.f("ck_activities_invalid_time_metrics"),
        ),
        sa.CheckConstraint(
            "temporal_quality IN ('complete','incomplete','invalid','manual')",
            name=op.f("ck_activities_temporal_quality"),
        ),
        sa.CheckConstraint(
            "visibility IN ('private','unlisted','public')", name=op.f("ck_activities_visibility")
        ),
        sa.CheckConstraint(
            "avg_pace_seconds_per_km >= 0 AND avg_pace_seconds_per_km < 1000000000",
            name=op.f("ck_activities_avg_pace_seconds_per_km_finite_range"),
        ),
        sa.CheckConstraint(
            (
                "avg_pace_seconds_per_km IS NULL OR (distance_m > 0 AND elapsed_seconds"
                " > 0 AND elapsed_seconds IS NOT NULL)"
            ),
            name=op.f("ck_activities_pace_inputs"),
        ),
        sa.CheckConstraint("char_length(notes) <= 5000", name=op.f("ck_activities_notes_length")),
        sa.CheckConstraint(
            "distance_m >= 0 AND distance_m < 1000000000",
            name=op.f("ck_activities_distance_m_finite_range"),
        ),
        sa.CheckConstraint(
            "elapsed_seconds >= 0 AND elapsed_seconds < 1000000000",
            name=op.f("ck_activities_elapsed_seconds_finite_range"),
        ),
        sa.CheckConstraint(
            "ended_at IS NULL OR started_at IS NULL OR ended_at >= started_at",
            name=op.f("ck_activities_time_order"),
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_activities_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_activities")),
        sa.UniqueConstraint("id", "user_id", name="uq_activities_id_user_id"),
    )
    op.create_index(
        "ix_activities_owner_date_id",
        "activities",
        ["user_id", sa.literal_column("activity_date DESC"), sa.literal_column("id DESC")],
        unique=False,
    )
    op.create_table(
        "activity_segments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("activity_id", sa.Uuid(), nullable=False),
        sa.Column("segment_index", sa.Integer(), nullable=False),
        sa.Column("source_track_index", sa.Integer(), nullable=False),
        sa.Column("source_segment_index", sa.Integer(), nullable=False),
        sa.Column("break_reason", sa.String(length=32), nullable=False),
        sa.Column("point_count", sa.Integer(), nullable=False),
        sa.Column(
            "geom",
            geoalchemy2.types.Geometry(
                geometry_type="LINESTRING",
                srid=4326,
                dimension=2,
                spatial_index=False,
                from_text="ST_GeomFromEWKT",
                name="geometry",
            ),
            nullable=True,
        ),
        sa.CheckConstraint(
            "(point_count = 1 AND geom IS NULL) OR (point_count >= 2 AND geom IS NOT NULL)",
            name=op.f("ck_activity_segments_geometry_presence"),
        ),
        sa.CheckConstraint(
            (
                "geom IS NULL OR (NOT ST_IsEmpty(geom) AND ST_NPoints(geom) = "
                "point_count AND ST_XMin(Box3D(geom)) >= -180 AND ST_XMax(Box3D(geom)) "
                "<= 180 AND ST_YMin(Box3D(geom)) >= -90 AND ST_YMax(Box3D(geom)) <= 90)"
            ),
            name=op.f("ck_activity_segments_geometry_bounds"),
        ),
        sa.CheckConstraint("point_count >= 1", name=op.f("ck_activity_segments_point_count")),
        sa.CheckConstraint(
            "segment_index >= 0 AND source_track_index >= 0 AND source_segment_index >= 0",
            name=op.f("ck_activity_segments_indices_nonnegative"),
        ),
        sa.ForeignKeyConstraint(
            ["activity_id"],
            ["activities.id"],
            name=op.f("fk_activity_segments_activity_id_activities"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_activity_segments")),
        sa.UniqueConstraint(
            "activity_id", "segment_index", name="uq_activity_segments_activity_index"
        ),
    )
    op.create_index(
        "ix_activity_segments_activity_id", "activity_segments", ["activity_id"], unique=False
    )
    op.create_index(
        "ix_activity_segments_geom",
        "activity_segments",
        ["geom"],
        unique=False,
        postgresql_using="gist",
    )
    op.create_table(
        "gpx_imports",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("activity_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("original_filename", sa.String(length=255), nullable=False),
        sa.Column("raw_gpx", sa.LargeBinary(), nullable=False),
        sa.Column("byte_size", sa.Integer(), nullable=False),
        sa.Column("raw_sha256", sa.CHAR(length=64), nullable=False),
        sa.Column("canonical_sha256", sa.CHAR(length=64), nullable=True),
        sa.Column("fingerprint_version", sa.String(length=32), nullable=False),
        sa.Column("parser_version", sa.String(length=32), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "byte_size BETWEEN 1 AND 10485760 AND octet_length(raw_gpx) = byte_size",
            name=op.f("ck_gpx_imports_byte_size"),
        ),
        sa.ForeignKeyConstraint(
            ["activity_id", "user_id"],
            ["activities.id", "activities.user_id"],
            name=op.f("fk_gpx_imports_activity_id_activities"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_gpx_imports")),
        sa.UniqueConstraint("activity_id", name=op.f("uq_gpx_imports_activity_id")),
        sa.UniqueConstraint("user_id", "raw_sha256", name="uq_gpx_imports_owner_raw"),
    )
    op.create_index(
        "uq_gpx_imports_owner_canonical",
        "gpx_imports",
        ["user_id", "fingerprint_version", "canonical_sha256"],
        unique=True,
        postgresql_where=sa.text("canonical_sha256 IS NOT NULL"),
    )
    op.create_table(
        "activity_points",
        sa.Column("segment_id", sa.Uuid(), nullable=False),
        sa.Column("point_index", sa.Integer(), nullable=False),
        sa.Column("source_point_index", sa.Integer(), nullable=False),
        sa.Column(
            "position",
            geoalchemy2.types.Geometry(
                geometry_type="POINT",
                srid=4326,
                dimension=2,
                spatial_index=False,
                from_text="ST_GeomFromEWKT",
                name="geometry",
                nullable=False,
            ),
            nullable=False,
        ),
        sa.Column("elevation_m", sa.Double(), nullable=True),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "elevation_m > '-Infinity'::float8 AND elevation_m < 'Infinity'::float8",
            name=op.f("ck_activity_points_elevation_finite"),
        ),
        sa.CheckConstraint(
            (
                "NOT ST_IsEmpty(position) AND ST_X(position) >= -180 AND ST_X(position)"
                " <= 180 AND ST_Y(position) >= -90 AND ST_Y(position) <= 90"
            ),
            name=op.f("ck_activity_points_position_bounds"),
        ),
        sa.CheckConstraint(
            "point_index >= 0 AND source_point_index >= 0",
            name=op.f("ck_activity_points_indices_nonnegative"),
        ),
        sa.ForeignKeyConstraint(
            ["segment_id"],
            ["activity_segments.id"],
            name=op.f("fk_activity_points_segment_id_activity_segments"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("segment_id", "point_index", name=op.f("pk_activity_points")),
    )


def downgrade() -> None:
    # Deletes phase-two data; never use as a default production rollback.
    op.drop_table("activity_points")
    op.drop_table("gpx_imports")
    op.drop_table("activity_segments")
    op.drop_table("activities")
