from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    LargeBinary,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.modules.running_diary.schema import Mood, Weather


class ActivityDiary(Base):
    __tablename__ = "activity_diaries"
    __table_args__ = (
        UniqueConstraint("activity_id"),
        UniqueConstraint("id", "user_id", name="uq_activity_diaries_id_user_id"),
        ForeignKeyConstraint(
            ["activity_id", "user_id"], ["activities.id", "activities.user_id"], ondelete="CASCADE"
        ),
        CheckConstraint(
            "mood IN ('very_bad', 'bad', 'neutral', 'good', 'very_good')", name="mood_valid"
        ),
        CheckConstraint("rpe BETWEEN 1 AND 10", name="rpe_range"),
        CheckConstraint(
            "weather IN ('clear', 'cloudy', 'rain', 'snow', 'windy', 'other')", name="weather_valid"
        ),
        CheckConstraint("char_length(notes) <= 5000", name="notes_length"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    activity_id: Mapped[UUID]
    mood: Mapped[Mood | None] = mapped_column(String(32))
    rpe: Mapped[int | None] = mapped_column(SmallInteger)
    weather: Mapped[Weather | None] = mapped_column(String(64))
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ActivityDiaryPhoto(Base):
    __tablename__ = "activity_diary_photos"
    __table_args__ = (
        ForeignKeyConstraint(
            ["diary_id", "user_id"],
            ["activity_diaries.id", "activity_diaries.user_id"],
            ondelete="CASCADE",
        ),
        CheckConstraint("octet_length(png) BETWEEN 1 AND 5242880", name="png_size"),
        CheckConstraint("width BETWEEN 1 AND 1100", name="width_range"),
        CheckConstraint("height BETWEEN 1 AND 1100", name="height_range"),
        Index("ix_activity_diary_photos_diary_id_created_at", "diary_id", "created_at", "id"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    diary_id: Mapped[UUID]
    png: Mapped[bytes] = mapped_column(LargeBinary, deferred=True)
    width: Mapped[int]
    height: Mapped[int]
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
