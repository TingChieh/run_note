"""Current owner, cross-worker lock, read-only computation, then one short write transaction."""

import hashlib
import re
from contextlib import contextmanager
from datetime import date
from decimal import Decimal
from uuid import uuid4

from sqlalchemy import insert, select, text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from app.core.errors import ApiError
from app.modules.activities.model import Activity
from app.modules.activities.schema import ImportView
from app.modules.activities.service import view
from app.modules.auth.service import require_identity
from app.modules.gpx.fingerprint import canonical_hash
from app.modules.gpx.metrics import pace, round_metric
from app.modules.gpx.model import ActivityPoint, ActivitySegment, GpxImport
from app.modules.gpx.normalization import derive, prepare_segments
from app.modules.gpx.queries import edge_distances, line_wkt, route_distance
from app.modules.gpx.worker import bounded_parse


def lock_key(owner):
    return int.from_bytes(
        hashlib.sha256(b"runnote-import\0" + owner.bytes).digest()[:8], "big", signed=True
    )


@contextmanager
def import_lock(engine, owner):
    # Dedicated connection, lock survives rollbacks but is never returned while still held.
    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as connection:
        acquired = False
        try:
            acquired = connection.scalar(
                text("SELECT pg_try_advisory_lock(:key)"), {"key": lock_key(owner)}
            )
            if not acquired:
                raise ApiError(429, "IMPORT_BUSY", "你的导入正在处理中，请稍后重试", retry_after=1)
            yield
        finally:
            if acquired:
                try:
                    if not connection.scalar(
                        text("SELECT pg_advisory_unlock(:key)"), {"key": lock_key(owner)}
                    ):
                        connection.invalidate()
                except SQLAlchemyError:
                    connection.invalidate()


def duplicate(db, owner, raw_hash, canonical=None):
    # Never disclose another owner's matching original file or resource ID.
    row = db.execute(
        select(GpxImport.activity_id).where(
            GpxImport.user_id == owner, GpxImport.raw_sha256 == raw_hash
        )
    ).first()
    kind = "raw"
    if row is None and canonical is not None:
        row = db.execute(
            select(GpxImport.activity_id).where(
                GpxImport.user_id == owner,
                GpxImport.fingerprint_version == "canonical-v1",
                GpxImport.canonical_sha256 == canonical,
            )
        ).first()
        kind = "canonical"
    if row:
        raise ApiError(
            409,
            "GPX_DUPLICATE",
            "此 GPX 已经导入",
            details=[{"existing_activity_id": str(row.activity_id), "duplicate_kind": kind}],
        )


def insert_points(db, rows):
    for start in range(0, len(rows), 1000):
        db.execute(insert(ActivityPoint), rows[start : start + 1000])


def safe_filename(name):
    base = (name or "activity.gpx").replace("\\", "/").split("/")[-1]
    return re.sub(r"[\x00-\x1f\x7f]", "_", base)[:255] or "activity.gpx"


def import_gpx(
    request,
    db,
    owner,
    raw: bytes,
    filename: str,
    title: str | None,
    timezone: str,
    activity_date: date | None,
):
    raw_hash = hashlib.sha256(raw).hexdigest()
    engine = db.get_bind()
    try:
        with import_lock(engine, owner):
            duplicate(db, owner, raw_hash)
            db.rollback()  # No pool slot or transaction held during the child parse.
            parsed = bounded_parse(raw)
            source = prepare_segments(parsed)
            derived = derive(parsed, source, edge_distances(db, source), timezone, activity_date)
            canonical = canonical_hash(parsed)
            duplicate(db, owner, raw_hash, canonical)
            exact_distance = route_distance(db, derived.segments)
            distance = round_metric(exact_distance)
            exact_elapsed = None
            if derived.temporal_quality == "complete":
                delta = derived.ended_at - derived.started_at
                exact_elapsed = (
                    Decimal(delta.days * 86400 + delta.seconds)
                    + Decimal(delta.microseconds) / 1000000
                )
            average = (
                pace(exact_elapsed, exact_distance)
                if distance > 0
                and derived.elapsed_seconds is not None
                and derived.elapsed_seconds > 0
                else None
            )
            warnings = derived.quality_summary["warnings"]
            if distance == 0:
                warnings.append("ZERO_DISTANCE")
            if average is None:
                warnings.append("PACE_UNAVAILABLE")
            db.rollback()  # End read-only metrics before the short atomic write.
            with db.begin():
                # Recheck the original session after parsing; serialize against password revocation.
                _, user = require_identity(db, request, request.app.state.clock())
                if user.id != owner:
                    raise ApiError(401, "AUTH_REQUIRED", "请重新登录")
                activity = Activity(
                    id=uuid4(),
                    user_id=owner,
                    source="gpx",
                    title=title or f"跑步 · {derived.activity_date}",
                    activity_date=derived.activity_date,
                    date_source=derived.date_source,
                    timezone=timezone,
                    started_at=derived.started_at,
                    ended_at=derived.ended_at,
                    distance_m=distance,
                    elapsed_seconds=derived.elapsed_seconds,
                    avg_pace_seconds_per_km=average,
                    temporal_quality=derived.temporal_quality,
                    quality_summary=derived.quality_summary,
                    metrics_version="gpx-v1",
                    visibility="private",
                    allow_shared_route=False,
                )
                db.add(activity)
                db.flush()
                imported = GpxImport(
                    id=uuid4(),
                    activity_id=activity.id,
                    user_id=owner,
                    original_filename=safe_filename(filename),
                    raw_gpx=raw,
                    byte_size=len(raw),
                    raw_sha256=raw_hash,
                    canonical_sha256=canonical,
                    fingerprint_version="canonical-v1",
                    parser_version="gpx-parser-v1",
                )
                db.add(imported)
                db.flush()
                segments, points = [], []
                for index, segment in enumerate(derived.segments):
                    sid = uuid4()
                    first = segment.points[0]
                    line = line_wkt(segment)
                    segments.append(
                        {
                            "id": sid,
                            "activity_id": activity.id,
                            "segment_index": index,
                            "source_track_index": first.track_index,
                            "source_segment_index": first.segment_index,
                            "break_reason": segment.break_reason,
                            "point_count": len(segment.points),
                            "geom": f"SRID=4326;{line}" if line else None,
                        }
                    )
                    for pi, p in enumerate(segment.points):
                        points.append(
                            {
                                "segment_id": sid,
                                "point_index": pi,
                                "source_point_index": p.source_index,
                                "position": f"SRID=4326;POINT({p.lon} {p.lat})",
                                "recorded_at": p.time,
                                "elevation_m": p.elevation,
                            }
                        )
                for start in range(0, len(segments), 1000):
                    db.execute(insert(ActivitySegment), segments[start : start + 1000])
                insert_points(db, points)
                user.activity_data_version += 1
                db.flush()
                response = ImportView(
                    activity=view(activity),
                    import_id=imported.id,
                    warnings=warnings,
                    point_count=len(points),
                    segment_count=len(segments),
                    metrics_version="gpx-v1",
                )
            return response
    except IntegrityError as error:
        db.rollback()
        name = getattr(getattr(error.orig, "diag", None), "constraint_name", "")
        if name in {"uq_gpx_imports_owner_raw", "uq_gpx_imports_owner_canonical"}:
            duplicate(db, owner, raw_hash, canonical)
        raise ApiError(503, "DEPENDENCY_UNAVAILABLE", "保存暂时失败，请稍后重试") from None
    except SQLAlchemyError:
        db.rollback()
        raise ApiError(503, "DEPENDENCY_UNAVAILABLE", "数据库暂时不可用，请稍后重试") from None
    finally:
        db.rollback()
