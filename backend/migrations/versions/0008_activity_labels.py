"""Private activity classification; existing records receive empty labels."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import ARRAY

revision = "0008_activity_labels"
down_revision = "0007_tcx_imports"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "activities", sa.Column("category", sa.String(30), nullable=False, server_default="")
    )
    op.add_column(
        "activities", sa.Column("tags", ARRAY(sa.String(30)), nullable=False, server_default="{}")
    )
    op.create_check_constraint(
        op.f("ck_activities_tags_valid"),
        "activities",
        "cardinality(tags) <= 10 AND array_position(tags, NULL) IS NULL",
    )


def downgrade():
    if (
        op.get_bind()
        .execute(
            sa.text(
                "SELECT 1 FROM activities WHERE category != '' OR cardinality(tags) > 0 LIMIT 1"
            )
        )
        .first()
    ):
        raise RuntimeError("Cannot downgrade while activity labels exist; retain private metadata")
    op.drop_constraint(op.f("ck_activities_tags_valid"), "activities", type_="check")
    op.drop_column("activities", "tags")
    op.drop_column("activities", "category")
