"""Private TCX provenance and nullable device summaries; existing activities unchanged."""

import sqlalchemy as sa
from alembic import op

revision = "0007_tcx_imports"
down_revision = "0006_running_goals"
branch_labels = None
depends_on = None


TRACK_CONSTRAINTS = {
    "invalid_time_metrics": (
        "temporal_quality != 'invalid' OR (ended_at IS NULL AND elapsed_seconds IS NULL "
        "AND (avg_pace_seconds_per_km IS NULL OR "
        "(timer_seconds IS NOT NULL AND timer_seconds > 0)))"
    ),
    "incomplete_time_metrics": (
        "temporal_quality != 'incomplete' OR (elapsed_seconds IS NULL AND "
        "(avg_pace_seconds_per_km IS NULL OR (timer_seconds IS NOT NULL AND timer_seconds > 0)))"
    ),
    "pace_inputs": (
        "avg_pace_seconds_per_km IS NULL OR (distance_m > 0 AND "
        "COALESCE(timer_seconds,elapsed_seconds) > 0 AND "
        "COALESCE(timer_seconds,elapsed_seconds) IS NOT NULL)"
    ),
}
LEGACY_CONSTRAINTS = {
    "invalid_time_metrics": (
        "temporal_quality != 'invalid' OR (ended_at IS NULL AND elapsed_seconds IS NULL "
        "AND avg_pace_seconds_per_km IS NULL)"
    ),
    "incomplete_time_metrics": (
        "temporal_quality != 'incomplete' OR (elapsed_seconds IS NULL "
        "AND avg_pace_seconds_per_km IS NULL)"
    ),
    "pace_inputs": (
        "avg_pace_seconds_per_km IS NULL OR (distance_m > 0 AND elapsed_seconds > 0 "
        "AND elapsed_seconds IS NOT NULL)"
    ),
}


def metric_constraints(definitions):
    for name, expression in definitions.items():
        identifier = op.f("ck_activities_" + name)
        op.drop_constraint(identifier, "activities", type_="check")
        op.create_check_constraint(identifier, "activities", expression)


def upgrade():
    op.drop_constraint(op.f("ck_activities_source"), "activities", type_="check")
    op.create_check_constraint(
        op.f("ck_activities_source"), "activities", "source IN ('gpx','manual','tcx')"
    )
    for name, type_ in [
        ("timer_seconds", sa.Numeric(12, 3)),
        ("calories_kcal", sa.Integer()),
        ("steps", sa.Integer()),
        ("avg_heart_rate_bpm", sa.Integer()),
    ]:
        op.add_column("activities", sa.Column(name, type_, nullable=True))
    for name, expression in [
        ("timer_range", "timer_seconds >= 0 AND timer_seconds < 1000000000"),
        ("calories_range", "calories_kcal >= 0 AND calories_kcal < 1000000000"),
        ("steps_range", "steps >= 0 AND steps < 1000000000"),
        ("heart_rate_range", "avg_heart_rate_bpm BETWEEN 1 AND 300"),
    ]:
        op.create_check_constraint(op.f("ck_activities_" + name), "activities", expression)
    metric_constraints(TRACK_CONSTRAINTS)
    op.create_table(
        "tcx_imports",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("activity_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("original_filename", sa.String(255), nullable=False),
        sa.Column("raw_tcx", sa.LargeBinary(), nullable=False),
        sa.Column("byte_size", sa.Integer(), nullable=False),
        sa.Column("raw_sha256", sa.CHAR(64), nullable=False),
        sa.Column("canonical_sha256", sa.CHAR(64)),
        sa.Column("fingerprint_version", sa.String(32), nullable=False),
        sa.Column("parser_version", sa.String(32), nullable=False),
        sa.Column("time_mode", sa.String(16), nullable=False),
        sa.Column("timezone", sa.String(64), nullable=False),
        sa.Column("route_distance_m", sa.Numeric(12, 3), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint("activity_id", name=op.f("uq_tcx_imports_activity_id")),
        sa.UniqueConstraint("user_id", "raw_sha256", name=op.f("uq_tcx_imports_owner_raw")),
        sa.ForeignKeyConstraint(
            ["activity_id", "user_id"],
            ["activities.id", "activities.user_id"],
            ondelete="CASCADE",
            name=op.f("fk_tcx_imports_activity_id_activities"),
        ),
        sa.CheckConstraint(
            "byte_size BETWEEN 1 AND 10485760 AND octet_length(raw_tcx) = byte_size",
            name=op.f("ck_tcx_imports_byte_size"),
        ),
        sa.CheckConstraint(
            "time_mode IN ('absolute','local')", name=op.f("ck_tcx_imports_time_mode")
        ),
        sa.CheckConstraint(
            "route_distance_m >= 0 AND route_distance_m < 1000000000",
            name=op.f("ck_tcx_imports_route_distance_range"),
        ),
    )
    op.create_index(
        "uq_tcx_imports_owner_canonical",
        "tcx_imports",
        ["user_id", "fingerprint_version", "canonical_sha256"],
        unique=True,
        postgresql_where=sa.text("canonical_sha256 IS NOT NULL"),
    )


def downgrade():
    # Never silently delete imported activities or relabel their source to downgrade.
    connection = op.get_bind()
    if connection.execute(sa.text("SELECT 1 FROM activities WHERE source='tcx' LIMIT 1")).first():
        raise RuntimeError("Cannot downgrade while TCX activities exist; retain their source data")
    metric_constraints(LEGACY_CONSTRAINTS)
    op.drop_table("tcx_imports")
    for name in ("timer_range", "calories_range", "steps_range", "heart_rate_range"):
        op.drop_constraint(op.f("ck_activities_" + name), "activities", type_="check")
    for name in ("timer_seconds", "calories_kcal", "steps", "avg_heart_rate_bpm"):
        op.drop_column("activities", name)
    op.drop_constraint(op.f("ck_activities_source"), "activities", type_="check")
    op.create_check_constraint(
        op.f("ck_activities_source"), "activities", "source IN ('gpx','manual')"
    )
