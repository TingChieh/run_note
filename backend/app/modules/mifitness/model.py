from datetime import datetime
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import (
    CHAR,
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    LargeBinary,
    Numeric,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class MifitnessImport(Base):
    __tablename__ = "mifitness_imports"
    __table_args__ = (
        UniqueConstraint("activity_id"),
        UniqueConstraint("user_id", "record_fingerprint", name="uq_mifitness_imports_owner_record"),
        UniqueConstraint("user_id", "raw_sha256", name="uq_mifitness_imports_owner_raw"),
        ForeignKeyConstraint(
            ["activity_id", "user_id"], ["activities.id", "activities.user_id"], ondelete="CASCADE"
        ),
        CheckConstraint(
            "(byte_size = 0 AND raw_gpx IS NULL AND raw_sha256 IS NULL "
            "AND canonical_sha256 IS NULL AND route_distance_m IS NULL) OR "
            "(byte_size BETWEEN 1 AND 10485760 AND raw_gpx IS NOT NULL "
            "AND octet_length(raw_gpx) = byte_size AND raw_sha256 IS NOT NULL "
            "AND route_distance_m IS NOT NULL)",
            name="raw_presence",
        ),
        CheckConstraint(
            "route_distance_m >= 0 AND route_distance_m < 1000000000", name="route_distance_range"
        ),
        Index(
            "uq_mifitness_imports_owner_canonical",
            "user_id",
            "fingerprint_version",
            "canonical_sha256",
            unique=True,
            postgresql_where=text("canonical_sha256 IS NOT NULL"),
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    activity_id: Mapped[UUID] = mapped_column()
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    record_fingerprint: Mapped[str] = mapped_column(CHAR(64))
    source_summary: Mapped[dict] = mapped_column(JSONB)
    raw_gpx: Mapped[bytes | None] = mapped_column(LargeBinary, deferred=True)
    byte_size: Mapped[int] = mapped_column()
    raw_sha256: Mapped[str | None] = mapped_column(CHAR(64))
    canonical_sha256: Mapped[str | None] = mapped_column(CHAR(64))
    fingerprint_version: Mapped[str] = mapped_column(String(32))
    parser_version: Mapped[str] = mapped_column(String(32))
    route_distance_m: Mapped[Decimal | None] = mapped_column(Numeric(12, 3))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
