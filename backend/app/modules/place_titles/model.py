"""Local place features and the naming queue; both are replaceable derivatives."""

from datetime import datetime
from uuid import UUID, uuid4

from geoalchemy2 import Geography, WKBElement
from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    String,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class PlaceFeature(Base):
    """Reference geometry from a locally imported OpenStreetMap region; no names or tags."""

    __tablename__ = "place_features"
    __table_args__ = (
        CheckConstraint("category IN ('lake','river','sea','park','stadium')", name="category"),
        Index("ix_place_features_geom", "geom", postgresql_using="gist"),
        Index("ix_place_features_region", "region"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    category: Mapped[str] = mapped_column(String(16))
    geom: Mapped[WKBElement] = mapped_column(Geography("GEOMETRY", srid=4326, spatial_index=False))
    region: Mapped[str] = mapped_column(String(64))
    imported_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class ActivityPlaceName(Base):
    __tablename__ = "activity_place_names"
    __table_args__ = (
        ForeignKeyConstraint(
            ["activity_id", "user_id"], ["activities.id", "activities.user_id"], ondelete="CASCADE"
        ),
        CheckConstraint("state IN ('pending','done','skipped')", name="state"),
        CheckConstraint("share IS NULL OR (share >= 0 AND share <= 1)", name="share_range"),
        Index("ix_activity_place_names_state", "state"),
    )

    activity_id: Mapped[UUID] = mapped_column(primary_key=True)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    state: Mapped[str] = mapped_column(String(10), server_default="pending")
    category: Mapped[str | None] = mapped_column(String(16))
    share: Mapped[float | None] = mapped_column(Float)
    applied_title: Mapped[str | None] = mapped_column(String(120))
    algorithm_version: Mapped[str] = mapped_column(String(32))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
