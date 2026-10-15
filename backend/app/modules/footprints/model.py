"""Private, replaceable spatial derivatives; original activities remain authoritative."""

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class FootprintActivityCache(Base):
    __tablename__ = "footprint_activity_caches"
    __table_args__ = (
        UniqueConstraint("activity_id"),
        ForeignKeyConstraint(
            ["activity_id", "user_id"], ["activities.id", "activities.user_id"], ondelete="CASCADE"
        ),
        CheckConstraint("unsupported_segment_count >= 0", name="unsupported_nonnegative"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    activity_id: Mapped[UUID] = mapped_column()
    algorithm_version: Mapped[str] = mapped_column(String(32))
    tracks: Mapped[list] = mapped_column(JSONB)
    cells: Mapped[list] = mapped_column(JSONB)
    unsupported_segment_count: Mapped[int] = mapped_column(Integer)
    generated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class FootprintSnapshot(Base):
    __tablename__ = "footprint_snapshots"
    __table_args__ = (
        UniqueConstraint("user_id"),
        CheckConstraint("state IN ('idle','building','failed')", name="state"),
        CheckConstraint("failure_count >= 0", name="failure_nonnegative"),
        CheckConstraint("source_version >= 0 AND target_version >= 0", name="version_nonnegative"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    source_version: Mapped[int | None] = mapped_column(BigInteger)
    algorithm_version: Mapped[str | None] = mapped_column(String(32))
    generated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    tracks: Mapped[dict | None] = mapped_column(JSONB)
    heatmap: Mapped[dict | None] = mapped_column(JSONB)
    state: Mapped[str] = mapped_column(String(16), server_default="idle")
    target_version: Mapped[int | None] = mapped_column(BigInteger)
    failure_count: Mapped[int] = mapped_column(Integer, server_default="0")
    retry_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
