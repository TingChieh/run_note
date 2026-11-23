"""Drop legacy ai_reports table after Phase 5 retirement of legacy AI reports."""

from alembic import op

revision = "0034_drop_ai_reports"
down_revision = "0033_ai_assistant"
branch_labels = None
depends_on = None


def upgrade():
    op.drop_index("uq_ai_reports_user_pending", table_name="ai_reports", if_exists=True)
    op.drop_index("ix_ai_reports_user_created", table_name="ai_reports", if_exists=True)
    op.drop_table("ai_reports")


def downgrade():
    raise RuntimeError(
        "Refusing to downgrade 0034_drop_ai_reports: dropped ai_reports data cannot be "
        "restored automatically; restore from a pre-migration backup instead."
    )
