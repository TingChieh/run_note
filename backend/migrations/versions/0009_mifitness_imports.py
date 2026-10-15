"""Private Mi Fitness source records and nullable device estimates; no historical backfill."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0009_mifitness_imports"
down_revision = "0008_activity_labels"
branch_labels = None
depends_on = None

METRIC_COLUMNS = (
    ("max_heart_rate_bpm", sa.Integer()),
    ("min_heart_rate_bpm", sa.Integer()),
    ("avg_cadence_spm", sa.Numeric(12, 3)),
    ("max_cadence_spm", sa.Numeric(12, 3)),
    ("vo2_max_ml_kg_min", sa.Numeric(12, 3)),
    ("training_load", sa.Numeric(12, 3)),
    ("aerobic_training_effect", sa.Numeric(12, 3)),
    ("anaerobic_training_effect", sa.Numeric(12, 3)),
)
METRIC_CONSTRAINTS = {
    "max_heart_rate_range": "max_heart_rate_bpm BETWEEN 1 AND 300",
    "min_heart_rate_range": "min_heart_rate_bpm BETWEEN 1 AND 300",
    "heart_rate_order": (
        "min_heart_rate_bpm <= avg_heart_rate_bpm AND "
        "avg_heart_rate_bpm <= max_heart_rate_bpm AND min_heart_rate_bpm <= max_heart_rate_bpm"
    ),
    "cadence_order": "avg_cadence_spm <= max_cadence_spm",
    "avg_cadence_spm_range": "avg_cadence_spm > 0 AND avg_cadence_spm <= 400",
    "max_cadence_spm_range": "max_cadence_spm > 0 AND max_cadence_spm <= 400",
    "vo2_max_ml_kg_min_range": "vo2_max_ml_kg_min > 0 AND vo2_max_ml_kg_min <= 150",
    "training_load_range": "training_load >= 0 AND training_load < 1000000000",
    "aerobic_training_effect_range": "aerobic_training_effect BETWEEN 0 AND 5",
    "anaerobic_training_effect_range": "anaerobic_training_effect BETWEEN 0 AND 5",
}


def upgrade():
    op.drop_constraint(op.f("ck_activities_source"), "activities", type_="check")
    op.create_check_constraint(
        op.f("ck_activities_source"), "activities", "source IN ('gpx','manual','tcx','mifitness')"
    )
    for name, type_ in METRIC_COLUMNS:
        op.add_column("activities", sa.Column(name, type_, nullable=True))
    for name, expression in METRIC_CONSTRAINTS.items():
        op.create_check_constraint(op.f("ck_activities_" + name), "activities", expression)
    op.create_table(
        "mifitness_imports",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("activity_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("record_fingerprint", sa.CHAR(64), nullable=False),
        sa.Column("source_summary", JSONB(), nullable=False),
        sa.Column("raw_gpx", sa.LargeBinary(), nullable=True),
        sa.Column("byte_size", sa.Integer(), nullable=False),
        sa.Column("raw_sha256", sa.CHAR(64), nullable=True),
        sa.Column("canonical_sha256", sa.CHAR(64), nullable=True),
        sa.Column("fingerprint_version", sa.String(32), nullable=False),
        sa.Column("parser_version", sa.String(32), nullable=False),
        sa.Column("route_distance_m", sa.Numeric(12, 3), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint("activity_id", name=op.f("uq_mifitness_imports_activity_id")),
        sa.UniqueConstraint(
            "user_id", "record_fingerprint", name=op.f("uq_mifitness_imports_owner_record")
        ),
        sa.UniqueConstraint("user_id", "raw_sha256", name=op.f("uq_mifitness_imports_owner_raw")),
        sa.ForeignKeyConstraint(
            ["activity_id", "user_id"],
            ["activities.id", "activities.user_id"],
            ondelete="CASCADE",
            name=op.f("fk_mifitness_imports_activity_id_activities"),
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            ondelete="CASCADE",
            name=op.f("fk_mifitness_imports_user_id_users"),
        ),
        sa.CheckConstraint(
            "(byte_size = 0 AND raw_gpx IS NULL AND raw_sha256 IS NULL "
            "AND canonical_sha256 IS NULL AND route_distance_m IS NULL) OR "
            "(byte_size BETWEEN 1 AND 10485760 AND raw_gpx IS NOT NULL "
            "AND octet_length(raw_gpx) = byte_size AND raw_sha256 IS NOT NULL "
            "AND route_distance_m IS NOT NULL)",
            name=op.f("ck_mifitness_imports_raw_presence"),
        ),
        sa.CheckConstraint(
            "route_distance_m >= 0 AND route_distance_m < 1000000000",
            name=op.f("ck_mifitness_imports_route_distance_range"),
        ),
    )
    op.create_index(
        "uq_mifitness_imports_owner_canonical",
        "mifitness_imports",
        ["user_id", "fingerprint_version", "canonical_sha256"],
        unique=True,
        postgresql_where=sa.text("canonical_sha256 IS NOT NULL"),
    )


def downgrade():
    # Any source record or nullable metric (including valid zero effects) blocks data loss.
    metric_presence = " OR ".join(name + " IS NOT NULL" for name, _ in METRIC_COLUMNS)
    if (
        op.get_bind()
        .execute(
            sa.text(
                "SELECT 1 FROM activities WHERE source='mifitness' OR "
                + metric_presence
                + " UNION ALL SELECT 1 FROM mifitness_imports LIMIT 1"
            )
        )
        .first()
    ):
        raise RuntimeError("Cannot downgrade while Mi Fitness or device metrics exist; retain data")
    op.drop_table("mifitness_imports")
    for name in METRIC_CONSTRAINTS:
        op.drop_constraint(op.f("ck_activities_" + name), "activities", type_="check")
    for name, _ in reversed(METRIC_COLUMNS):
        op.drop_column("activities", name)
    op.drop_constraint(op.f("ck_activities_source"), "activities", type_="check")
    op.create_check_constraint(
        op.f("ck_activities_source"), "activities", "source IN ('gpx','manual','tcx')"
    )
