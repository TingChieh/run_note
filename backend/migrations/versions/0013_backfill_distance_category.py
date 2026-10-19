"""Backfill empty activity categories from standard race distances."""

from alembic import op

revision = "0013_backfill_distance_category"
down_revision = "0012_site_settings"
branch_labels = None
depends_on = None


def upgrade():
    # Only untouched (empty) categories are filled; manual categories are kept.
    op.execute("""
        UPDATE activities SET category = CASE
            WHEN distance_m >= 2500 AND distance_m < 4000 THEN '3km'
            WHEN distance_m >= 4000 AND distance_m <= 7500 THEN '5km'
            WHEN distance_m >= 9000 AND distance_m <= 12000 THEN '10km'
            WHEN distance_m >= 20000 AND distance_m <= 22500 THEN '半马'
            WHEN distance_m >= 41000 AND distance_m <= 44000 THEN '全马'
            ELSE category END
        WHERE category = ''
    """)


def downgrade():
    # Auto-assigned and manual categories are indistinguishable; never destroy data.
    pass
