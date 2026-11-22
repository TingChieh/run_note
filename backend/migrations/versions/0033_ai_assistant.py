"""Add private AI assistant conversations, messages, and versioned user consents."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0033_ai_assistant"
down_revision = "0032_running_diary"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "ai_conversations",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("title", sa.String(120), server_default="", nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "last_message_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("id", "user_id", name="uq_ai_conversations_id_user_id"),
        sa.CheckConstraint(
            "char_length(title) <= 120", name=op.f("ck_ai_conversations_title_length")
        ),
    )
    op.create_index(
        "ix_ai_conversations_user_last_msg",
        "ai_conversations",
        ["user_id", sa.text("last_message_at DESC"), sa.text("id DESC")],
    )

    op.create_table(
        "ai_messages",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("conversation_id", sa.Uuid(), nullable=False),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("request_key", sa.Uuid()),
        sa.Column("role", sa.String(16), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("content", sa.Text()),
        sa.Column(
            "tool_calls_summary",
            postgresql.JSONB(),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "ui_blocks",
            postgresql.JSONB(),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column("model", sa.String(100)),
        sa.Column("prompt_version", sa.String(32)),
        sa.Column("error_code", sa.String(50)),
        sa.Column("input_tokens", sa.Integer()),
        sa.Column("output_tokens", sa.Integer()),
        sa.Column("cached_input_tokens", sa.Integer()),
        sa.Column("source_data_version", sa.BigInteger(), server_default="0", nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("finished_at", sa.DateTime(timezone=True)),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.ForeignKeyConstraint(
            ["conversation_id", "user_id"],
            ["ai_conversations.id", "ai_conversations.user_id"],
            ondelete="CASCADE",
            name="fk_ai_messages_conv_user",
        ),
        *[
            sa.CheckConstraint(expression, name=op.f("ck_ai_messages_" + name))
            for name, expression in [
                ("role", "role IN ('user','assistant')"),
                ("status", "status IN ('pending','streaming','succeeded','failed','cancelled')"),
                ("content_length", "content IS NULL OR char_length(content) <= 16000"),
                ("version_nonnegative", "source_data_version >= 0"),
                (
                    "finished_state",
                    "(status IN ('pending','streaming') AND finished_at IS NULL) "
                    "OR (status NOT IN ('pending','streaming') AND finished_at IS NOT NULL)",
                ),
                ("input_tokens_nonnegative", "input_tokens IS NULL OR input_tokens >= 0"),
                ("output_tokens_nonnegative", "output_tokens IS NULL OR output_tokens >= 0"),
                (
                    "cached_input_tokens_nonnegative",
                    "cached_input_tokens IS NULL OR cached_input_tokens >= 0",
                ),
                (
                    "deleted_content",
                    "deleted_at IS NULL OR (status NOT IN ('pending','streaming') "
                    "AND content IS NULL AND tool_calls_summary = '[]'::jsonb "
                    "AND ui_blocks = '[]'::jsonb)",
                ),
            ]
        ],
    )
    op.create_index(
        "ix_ai_messages_conv_created", "ai_messages", ["conversation_id", "created_at", "id"]
    )
    op.create_index(
        "ix_ai_messages_user_created", "ai_messages", ["user_id", sa.text("created_at DESC")]
    )
    op.create_index("ix_ai_messages_created_at", "ai_messages", ["created_at"])
    op.create_index(
        "uq_ai_messages_user_role_request",
        "ai_messages",
        ["user_id", "role", "request_key"],
        unique=True,
        postgresql_where=sa.text("request_key IS NOT NULL"),
    )
    op.create_index(
        "uq_ai_messages_user_active",
        "ai_messages",
        ["user_id"],
        unique=True,
        postgresql_where=sa.text("role = 'assistant' AND status IN ('pending','streaming')"),
    )

    op.create_table(
        "ai_user_consents",
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("consent_version", sa.String(32), nullable=False),
        sa.Column(
            "consented_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint(
            "char_length(consent_version) >= 1", name=op.f("ck_ai_user_consents_version_present")
        ),
        sa.CheckConstraint(
            "revoked_at IS NULL OR revoked_at >= consented_at",
            name=op.f("ck_ai_user_consents_revoked_after_consent"),
        ),
    )


def downgrade():
    bind = op.get_bind()
    for table in ("ai_messages", "ai_conversations", "ai_user_consents"):
        if bind.execute(sa.text(f"SELECT 1 FROM {table} LIMIT 1")).first() is not None:
            raise RuntimeError(
                f"Refusing to drop AI assistant tables because {table} already holds data"
            )
    op.drop_table("ai_user_consents")
    op.drop_index("uq_ai_messages_user_active", table_name="ai_messages")
    op.drop_index("uq_ai_messages_user_role_request", table_name="ai_messages")
    op.drop_index("ix_ai_messages_created_at", table_name="ai_messages")
    op.drop_index("ix_ai_messages_user_created", table_name="ai_messages")
    op.drop_index("ix_ai_messages_conv_created", table_name="ai_messages")
    op.drop_table("ai_messages")
    op.drop_index("ix_ai_conversations_user_last_msg", table_name="ai_conversations")
    op.drop_table("ai_conversations")
