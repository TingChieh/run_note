"""Enable PostGIS without creating phase-two business tables."""

from alembic import op

revision = "0001_postgis"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis")


def downgrade() -> None:
    # PostGIS can predate Alembic (including the development image).
    # Do not destroy a shared extension or its data when rolling back the baseline.
    pass
