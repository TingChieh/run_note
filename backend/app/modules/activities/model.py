from datetime import date, datetime
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Activity(Base):
    __tablename__ = "activities"
    __table_args__ = (
        UniqueConstraint("id", "user_id", name="uq_activities_id_user_id"),
        CheckConstraint("source IN ('gpx','manual')", name="source"),
        CheckConstraint("date_source IN ('timestamp','manual')", name="date_source"),
        CheckConstraint(
            "temporal_quality IN ('complete','incomplete','invalid','manual')",
            name="temporal_quality",
        ),
        CheckConstraint("visibility IN ('private','unlisted','public')", name="visibility"),
        CheckConstraint("char_length(notes) <= 5000", name="notes_length"),
        CheckConstraint(
            "ended_at IS NULL OR started_at IS NULL OR ended_at >= started_at", name="time_order"
        ),
        CheckConstraint(
            (
                "temporal_quality != 'invalid' OR (ended_at IS NULL AND elapsed_seconds"
                " IS NULL AND avg_pace_seconds_per_km IS NULL)"
            ),
            name="invalid_time_metrics",
        ),
        CheckConstraint(
            (
                "temporal_quality != 'incomplete' OR (elapsed_seconds IS NULL AND "
                "avg_pace_seconds_per_km IS NULL)"
            ),
            name="incomplete_time_metrics",
        ),
        CheckConstraint(
            (
                "avg_pace_seconds_per_km IS NULL OR (distance_m > 0 AND elapsed_seconds"
                " > 0 AND elapsed_seconds IS NOT NULL)"
            ),
            name="pace_inputs",
        ),
        *(
            CheckConstraint(f"{field} >= 0 AND {field} < 1000000000", name=f"{field}_finite_range")
            for field in ("distance_m", "elapsed_seconds", "avg_pace_seconds_per_km")
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    source: Mapped[str] = mapped_column(String(10))
    title: Mapped[str] = mapped_column(String(120))
    notes: Mapped[str] = mapped_column(Text, server_default="")
    activity_date: Mapped[date] = mapped_column(Date)
    date_source: Mapped[str] = mapped_column(String(16))
    timezone: Mapped[str] = mapped_column(String(64))
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    distance_m: Mapped[Decimal] = mapped_column(Numeric(12, 3))
    elapsed_seconds: Mapped[Decimal | None] = mapped_column(Numeric(12, 3))
    avg_pace_seconds_per_km: Mapped[Decimal | None] = mapped_column(Numeric(12, 3))
    temporal_quality: Mapped[str] = mapped_column(String(16))
    quality_summary: Mapped[dict] = mapped_column(JSONB)
    metrics_version: Mapped[str] = mapped_column(String(32))
    visibility: Mapped[str] = mapped_column(String(10), server_default="private")
    allow_shared_route: Mapped[bool] = mapped_column(Boolean, server_default="false")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


Index(
    "ix_activities_owner_date_id",
    Activity.user_id,
    Activity.activity_date.desc(),
    Activity.id.desc(),
)

Index(
    "ix_activities_public_owner_date",
    Activity.user_id,
    Activity.activity_date.desc(),
    Activity.id.desc(),
    postgresql_where=Activity.visibility == "public",
)
