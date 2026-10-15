from datetime import datetime
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import (
    CHAR,
    CheckConstraint,
    DateTime,
    ForeignKeyConstraint,
    Index,
    LargeBinary,
    Numeric,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class TcxImport(Base):
    __tablename__ = "tcx_imports"
    __table_args__ = (
        UniqueConstraint("activity_id"),
        UniqueConstraint("user_id", "raw_sha256", name="uq_tcx_imports_owner_raw"),
        ForeignKeyConstraint(
            ["activity_id", "user_id"], ["activities.id", "activities.user_id"], ondelete="CASCADE"
        ),
        CheckConstraint(
            "byte_size BETWEEN 1 AND 10485760 AND octet_length(raw_tcx) = byte_size",
            name="byte_size",
        ),
        CheckConstraint("time_mode IN ('absolute','local')", name="time_mode"),
        CheckConstraint(
            "route_distance_m >= 0 AND route_distance_m < 1000000000", name="route_distance_range"
        ),
        Index(
            "uq_tcx_imports_owner_canonical",
            "user_id",
            "fingerprint_version",
            "canonical_sha256",
            unique=True,
            postgresql_where=text("canonical_sha256 IS NOT NULL"),
        ),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    activity_id: Mapped[UUID] = mapped_column()
    user_id: Mapped[UUID] = mapped_column()
    original_filename: Mapped[str] = mapped_column(String(255))
    raw_tcx: Mapped[bytes] = mapped_column(LargeBinary, deferred=True)
    byte_size: Mapped[int] = mapped_column()
    raw_sha256: Mapped[str] = mapped_column(CHAR(64))
    canonical_sha256: Mapped[str | None] = mapped_column(CHAR(64))
    fingerprint_version: Mapped[str] = mapped_column(String(32))
    parser_version: Mapped[str] = mapped_column(String(32))
    time_mode: Mapped[str] = mapped_column(String(16))
    timezone: Mapped[str] = mapped_column(String(64))
    route_distance_m: Mapped[Decimal] = mapped_column(Numeric(12, 3))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
