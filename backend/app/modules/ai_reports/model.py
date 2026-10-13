from datetime import date, datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
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


class AIReport(Base):
    __tablename__ = "ai_reports"
    __table_args__ = (
        UniqueConstraint("user_id", "request_key", name="uq_ai_reports_user_request"),
        CheckConstraint("status IN ('pending','succeeded','failed')", name="status"),
        CheckConstraint("date_to > date_from AND date_to - date_from <= 366", name="date_range"),
        CheckConstraint("source_data_version >= 0", name="version_nonnegative"),
        CheckConstraint(
            "(status='pending' AND finished_at IS NULL) "
            "OR (status!='pending' AND finished_at IS NOT NULL)",
            name="finished_state",
        ),
        CheckConstraint(
            "input_tokens IS NULL OR input_tokens >= 0", name="input_tokens_nonnegative"
        ),
        CheckConstraint(
            "output_tokens IS NULL OR output_tokens >= 0", name="output_tokens_nonnegative"
        ),
        CheckConstraint(
            "deleted_at IS NULL OR (status!='pending' AND report_text IS NULL "
            "AND stats_snapshot='{}'::jsonb)",
            name="deleted_content",
        ),
        CheckConstraint(
            "report_text IS NULL OR char_length(report_text) <= 10000", name="text_length"
        ),
        Index("ix_ai_reports_user_created", "user_id", text("created_at DESC")),
        Index(
            "uq_ai_reports_user_pending",
            "user_id",
            unique=True,
            postgresql_where=text("status='pending'"),
        ),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    request_key: Mapped[UUID] = mapped_column()
    date_from: Mapped[date] = mapped_column(Date)
    date_to: Mapped[date] = mapped_column(Date)
    source_data_version: Mapped[int] = mapped_column(BigInteger)
    status: Mapped[str] = mapped_column(String(16))
    stats_snapshot: Mapped[dict] = mapped_column(JSONB)
    model: Mapped[str] = mapped_column(String(100))
    prompt_version: Mapped[str] = mapped_column(String(32))
    report_text: Mapped[str | None] = mapped_column(Text)
    error_code: Mapped[str | None] = mapped_column(String(50))
    input_tokens: Mapped[int | None] = mapped_column(Integer)
    output_tokens: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
