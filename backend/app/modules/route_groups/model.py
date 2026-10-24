"""Replaceable derivatives that group an owner's runs along the same route."""

from datetime import datetime
from uuid import UUID, uuid4

from geoalchemy2 import Geometry, WKBElement
from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class RouteFingerprint(Base):
    """Simplified track of one activity; geom is NULL when it cannot take part in grouping."""

    __tablename__ = "route_fingerprints"
    __table_args__ = (
        UniqueConstraint("activity_id"),
        ForeignKeyConstraint(
            ["activity_id", "user_id"], ["activities.id", "activities.user_id"], ondelete="CASCADE"
        ),
        Index("ix_route_fingerprints_geom", "geom", postgresql_using="gist"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    activity_id: Mapped[UUID] = mapped_column()
    algorithm_version: Mapped[str] = mapped_column(String(32))
    geom: Mapped[WKBElement | None] = mapped_column(
        Geometry("MULTILINESTRING", srid=4326, spatial_index=False)
    )
    generated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class RouteGroup(Base):
    __tablename__ = "route_groups"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    algorithm_version: Mapped[str] = mapped_column(String(32))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class RouteGroupMember(Base):
    __tablename__ = "route_group_members"
    __table_args__ = (
        ForeignKeyConstraint(
            ["activity_id", "user_id"], ["activities.id", "activities.user_id"], ondelete="CASCADE"
        ),
        CheckConstraint("coverage >= 0 AND coverage <= 1", name="coverage_range"),
        Index("ix_route_group_members_group_id", "group_id"),
    )

    activity_id: Mapped[UUID] = mapped_column(primary_key=True)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    group_id: Mapped[UUID] = mapped_column(ForeignKey("route_groups.id", ondelete="CASCADE"))
    coverage: Mapped[float] = mapped_column(Float)
