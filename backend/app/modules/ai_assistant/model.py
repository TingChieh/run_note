"""Private AI assistant conversations, messages, and versioned user consent."""

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class AIConversation(Base):
    __tablename__ = "ai_conversations"
    __table_args__ = (
        UniqueConstraint("id", "user_id", name="uq_ai_conversations_id_user_id"),
        CheckConstraint("char_length(title) <= 120", name="title_length"),
        Index(
            "ix_ai_conversations_user_last_msg",
            "user_id",
            text("last_message_at DESC"),
            text("id DESC"),
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(120), server_default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    last_message_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AIMessage(Base):
    __tablename__ = "ai_messages"
    __table_args__ = (
        ForeignKeyConstraint(
            ["conversation_id", "user_id"],
            ["ai_conversations.id", "ai_conversations.user_id"],
            ondelete="CASCADE",
            name="fk_ai_messages_conv_user",
        ),
        CheckConstraint("role IN ('user','assistant')", name="role"),
        CheckConstraint(
            "status IN ('pending','streaming','succeeded','failed','cancelled')",
            name="status",
        ),
        CheckConstraint(
            "content IS NULL OR char_length(content) <= 16000",
            name="content_length",
        ),
        CheckConstraint("source_data_version >= 0", name="version_nonnegative"),
        CheckConstraint(
            "(status IN ('pending','streaming') AND finished_at IS NULL) "
            "OR (status NOT IN ('pending','streaming') AND finished_at IS NOT NULL)",
            name="finished_state",
        ),
        CheckConstraint(
            "input_tokens IS NULL OR input_tokens >= 0", name="input_tokens_nonnegative"
        ),
        CheckConstraint(
            "output_tokens IS NULL OR output_tokens >= 0", name="output_tokens_nonnegative"
        ),
        CheckConstraint(
            "cached_input_tokens IS NULL OR cached_input_tokens >= 0",
            name="cached_input_tokens_nonnegative",
        ),
        CheckConstraint(
            "deleted_at IS NULL OR (status NOT IN ('pending','streaming') "
            "AND content IS NULL AND tool_calls_summary = '[]'::jsonb "
            "AND ui_blocks = '[]'::jsonb)",
            name="deleted_content",
        ),
        Index("ix_ai_messages_conv_created", "conversation_id", "created_at", "id"),
        Index("ix_ai_messages_user_created", "user_id", text("created_at DESC")),
        Index("ix_ai_messages_created_at", "created_at"),
        Index(
            "uq_ai_messages_user_role_request",
            "user_id",
            "role",
            "request_key",
            unique=True,
            postgresql_where=text("request_key IS NOT NULL"),
        ),
        Index(
            "uq_ai_messages_user_active",
            "user_id",
            unique=True,
            postgresql_where=text("role = 'assistant' AND status IN ('pending','streaming')"),
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    conversation_id: Mapped[UUID] = mapped_column()
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    request_key: Mapped[UUID | None] = mapped_column()
    role: Mapped[str] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(String(16))
    content: Mapped[str | None] = mapped_column(Text)
    tool_calls_summary: Mapped[list] = mapped_column(JSONB, server_default=text("'[]'::jsonb"))
    ui_blocks: Mapped[list] = mapped_column(JSONB, server_default=text("'[]'::jsonb"))
    model: Mapped[str | None] = mapped_column(String(100))
    prompt_version: Mapped[str | None] = mapped_column(String(32))
    error_code: Mapped[str | None] = mapped_column(String(50))
    input_tokens: Mapped[int | None] = mapped_column(Integer)
    output_tokens: Mapped[int | None] = mapped_column(Integer)
    cached_input_tokens: Mapped[int | None] = mapped_column(Integer)
    source_data_version: Mapped[int] = mapped_column(BigInteger, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AIUserConsent(Base):
    __tablename__ = "ai_user_consents"
    __table_args__ = (
        CheckConstraint("char_length(consent_version) >= 1", name="version_present"),
        CheckConstraint(
            "revoked_at IS NULL OR revoked_at >= consented_at",
            name="revoked_after_consent",
        ),
    )

    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    consent_version: Mapped[str] = mapped_column(String(32))
    consented_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
