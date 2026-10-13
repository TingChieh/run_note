"""Add private AI report snapshots and cross-worker request constraints."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0005_ai_reports"
down_revision = "0004_public_sharing"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "ai_reports",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("request_key", sa.Uuid(), nullable=False),
        sa.Column("date_from", sa.Date(), nullable=False),
        sa.Column("date_to", sa.Date(), nullable=False),
        sa.Column("source_data_version", sa.BigInteger(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("stats_snapshot", postgresql.JSONB(), nullable=False),
        sa.Column("model", sa.String(100), nullable=False),
        sa.Column("prompt_version", sa.String(32), nullable=False),
        sa.Column("report_text", sa.Text()),
        sa.Column("error_code", sa.String(50)),
        sa.Column("input_tokens", sa.Integer()),
        sa.Column("output_tokens", sa.Integer()),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("finished_at", sa.DateTime(timezone=True)),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("user_id", "request_key", name="uq_ai_reports_user_request"),
        *[
            sa.CheckConstraint(expression, name=op.f("ck_ai_reports_" + name))
            for name, expression in [
                ("status", "status IN ('pending','succeeded','failed')"),
                ("date_range", "date_to > date_from AND date_to - date_from <= 366"),
                ("version_nonnegative", "source_data_version >= 0"),
                (
                    "finished_state",
                    "(status='pending' AND finished_at IS NULL) "
                    "OR (status!='pending' AND finished_at IS NOT NULL)",
                ),
                ("input_tokens_nonnegative", "input_tokens IS NULL OR input_tokens >= 0"),
                ("output_tokens_nonnegative", "output_tokens IS NULL OR output_tokens >= 0"),
                (
                    "deleted_content",
                    "deleted_at IS NULL OR (status!='pending' AND report_text IS NULL "
                    "AND stats_snapshot='{}'::jsonb)",
                ),
                ("text_length", "report_text IS NULL OR char_length(report_text) <= 10000"),
            ]
        ],
    )
    op.create_index(
        "ix_ai_reports_user_created", "ai_reports", ["user_id", sa.text("created_at DESC")]
    )
    op.create_index(
        "uq_ai_reports_user_pending",
        "ai_reports",
        ["user_id"],
        unique=True,
        postgresql_where=sa.text("status='pending'"),
    )


def downgrade():
    op.drop_table("ai_reports")
