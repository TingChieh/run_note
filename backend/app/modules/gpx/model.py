from datetime import datetime
from uuid import UUID, uuid4

from geoalchemy2 import Geometry, WKBElement
from sqlalchemy import (
    CHAR,
    CheckConstraint,
    DateTime,
    Double,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    LargeBinary,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class GpxImport(Base):
    __tablename__ = "gpx_imports"
    __table_args__ = (
        UniqueConstraint("activity_id"),
        UniqueConstraint("user_id", "raw_sha256", name="uq_gpx_imports_owner_raw"),
        ForeignKeyConstraint(
            ["activity_id", "user_id"], ["activities.id", "activities.user_id"], ondelete="CASCADE"
        ),
        CheckConstraint(
            "byte_size BETWEEN 1 AND 10485760 AND octet_length(raw_gpx) = byte_size",
            name="byte_size",
        ),
        Index(
            "uq_gpx_imports_owner_canonical",
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
    raw_gpx: Mapped[bytes] = mapped_column(LargeBinary, deferred=True)
    byte_size: Mapped[int] = mapped_column()
    raw_sha256: Mapped[str] = mapped_column(CHAR(64))
    canonical_sha256: Mapped[str | None] = mapped_column(CHAR(64))
    fingerprint_version: Mapped[str] = mapped_column(String(32))
    parser_version: Mapped[str] = mapped_column(String(32))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ActivitySegment(Base):
    __tablename__ = "activity_segments"
    __table_args__ = (
        UniqueConstraint(
            "activity_id", "segment_index", name="uq_activity_segments_activity_index"
        ),
        CheckConstraint(
            "segment_index >= 0 AND source_track_index >= 0 AND source_segment_index >= 0",
            name="indices_nonnegative",
        ),
        CheckConstraint("point_count >= 1", name="point_count"),
        CheckConstraint(
            "(point_count = 1 AND geom IS NULL) OR (point_count >= 2 AND geom IS NOT NULL)",
            name="geometry_presence",
        ),
        CheckConstraint(
            (
                "geom IS NULL OR (NOT ST_IsEmpty(geom) AND ST_NPoints(geom) = "
                "point_count AND ST_XMin(Box3D(geom)) >= -180 AND ST_XMax(Box3D(geom)) "
                "<= 180 AND ST_YMin(Box3D(geom)) >= -90 AND ST_YMax(Box3D(geom)) <= 90)"
            ),
            name="geometry_bounds",
        ),
        Index("ix_activity_segments_activity_id", "activity_id"),
        Index("ix_activity_segments_geom", "geom", postgresql_using="gist"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    activity_id: Mapped[UUID] = mapped_column(ForeignKey("activities.id", ondelete="CASCADE"))
    segment_index: Mapped[int] = mapped_column()
    source_track_index: Mapped[int] = mapped_column()
    source_segment_index: Mapped[int] = mapped_column()
    break_reason: Mapped[str] = mapped_column(String(32))
    point_count: Mapped[int] = mapped_column()
    geom: Mapped[WKBElement | None] = mapped_column(
        Geometry("LINESTRING", srid=4326, spatial_index=False)
    )


class ActivityPoint(Base):
    __tablename__ = "activity_points"
    __table_args__ = (
        CheckConstraint("point_index >= 0 AND source_point_index >= 0", name="indices_nonnegative"),
        CheckConstraint(
            (
                "NOT ST_IsEmpty(position) AND ST_X(position) >= -180 AND ST_X(position)"
                " <= 180 AND ST_Y(position) >= -90 AND ST_Y(position) <= 90"
            ),
            name="position_bounds",
        ),
        CheckConstraint(
            "elevation_m > '-Infinity'::float8 AND elevation_m < 'Infinity'::float8",
            name="elevation_finite",
        ),
    )

    segment_id: Mapped[UUID] = mapped_column(
        ForeignKey("activity_segments.id", ondelete="CASCADE"), primary_key=True
    )
    point_index: Mapped[int] = mapped_column(primary_key=True)
    source_point_index: Mapped[int] = mapped_column()
    position: Mapped[WKBElement] = mapped_column(Geometry("POINT", srid=4326, spatial_index=False))
    elevation_m: Mapped[float | None] = mapped_column(Double)
    recorded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
