"""Persisted, version-checked all-record footprints; GET never rebuilds geometry."""

import hashlib
import json
import logging
from collections import Counter
from datetime import timedelta
from time import monotonic
from uuid import uuid4

from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import load_only

from app.modules.activities.model import Activity
from app.modules.footprints.model import FootprintActivityCache, FootprintSnapshot
from app.modules.footprints.service import (
    GEOMETRIES,
    GRID_SIZE,
    MAX_CANDIDATES,
    MAX_CELLS,
    SELECTED,
    TRACKS,
)
from app.modules.users.model import User

ALGORITHM_VERSION = "footprints-all-v1"
REFRESH_INTERVAL = timedelta(hours=24)
MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024
MAX_SNAPSHOT_CELLS = 200000
BUILD_TIMEOUT_SECONDS = 120
BATCH_SIZE = 32
logger = logging.getLogger(__name__)

# Retain the existing spatial pipeline verbatim, selecting one owned activity at a time.
ACTIVITY_SELECTED = SELECTED.replace(
    "a.activity_date>=:start AND a.activity_date<:end", "a.id=:activity"
)
ACTIVITY_TRACKS = TRACKS.replace(SELECTED, ACTIVITY_SELECTED, 1)
ACTIVITY_GEOMETRIES = GEOMETRIES.replace(SELECTED, ACTIVITY_SELECTED, 1)
ACTIVITY_CELLS = (
    ACTIVITY_GEOMETRIES
    + """, pieces AS (
    SELECT activity_id,d.geom FROM usable CROSS JOIN LATERAL ST_Dump(geom) d
), short_edges AS (
    SELECT activity_id,e.geom FROM pieces p
    CROSS JOIN LATERAL ST_DumpSegments(ST_Segmentize(p.geom,500)) e
    WHERE GeometryType(p.geom)='LINESTRING'
    UNION ALL SELECT activity_id,geom FROM pieces WHERE GeometryType(geom)='POINT'
), hits AS MATERIALIZED (
    SELECT g.i,g.j FROM short_edges e
    CROSS JOIN LATERAL ST_SquareGrid(:size,CASE WHEN GeometryType(e.geom)='POINT'
        THEN e.geom ELSE ST_Expand(e.geom,0.000001) END) g
    WHERE ST_Intersects(e.geom,g.geom) LIMIT :candidates
), distinct_cells AS (SELECT DISTINCT i,j FROM hits)
SELECT i,j,ST_AsGeoJSON(ST_Transform(ST_MakeEnvelope(
    i*:size,j*:size,(i+1)*:size,(j+1)*:size,3857),4326),9)::json AS geometry,
    (SELECT count(*) FROM hits) AS candidates
FROM distinct_cells ORDER BY i,j LIMIT :cells"""
)


class SnapshotBuildStopped(Exception):
    """Cooperative shutdown or data-version change; never publishes partial data."""


def retry_delay(failures):
    return timedelta(seconds=min(3600, 60 * 2 ** min(max(failures - 1, 0), 6)))


def refresh_due(snapshot, version, now):
    if snapshot is None:
        return True
    if snapshot.target_version != version:
        return True
    if snapshot.state == "failed" and snapshot.retry_at is not None:
        return snapshot.retry_at <= now
    return (
        snapshot.state == "building"
        or snapshot.source_version != version
        or snapshot.algorithm_version != ALGORITHM_VERSION
        or snapshot.generated_at is None
        or snapshot.generated_at <= now - REFRESH_INTERVAL
    )


def snapshot_view(snapshot, version, mode):
    current = (
        snapshot is not None
        and snapshot.source_version == version
        and snapshot.algorithm_version == ALGORITHM_VERSION
        and snapshot.generated_at is not None
    )
    result = getattr(snapshot, mode) if current else None
    return dict(
        status="ready"
        if result is not None
        else (
            "failed"
            if snapshot is not None
            and snapshot.state == "failed"
            and snapshot.target_version == version
            else "pending"
        ),
        generated_at=snapshot.generated_at if snapshot is not None else None,
        refreshing=snapshot is not None and snapshot.state == "building",
        refresh_failed=result is not None
        and snapshot.state == "failed"
        and snapshot.target_version == version,
        result=result,
    )


def read_all_footprints(db, owner, mode):
    # Re-read the authoritative version in the same statement as the snapshot: an
    # authentication identity may have been loaded before a concurrent deletion committed.
    row = db.execute(
        select(User.activity_data_version, FootprintSnapshot)
        .options(
            load_only(
                FootprintSnapshot.source_version,
                FootprintSnapshot.algorithm_version,
                FootprintSnapshot.generated_at,
                FootprintSnapshot.state,
                FootprintSnapshot.target_version,
                getattr(FootprintSnapshot, mode),
                raiseload=True,
            )
        )
        .outerjoin(FootprintSnapshot, FootprintSnapshot.user_id == User.id)
        .where(User.id == owner)
        .execution_options(populate_existing=True)
    ).one()
    return snapshot_view(row[1], row[0], mode)


def task_lock_key(owner):
    # Separate namespace from GPX/TCX import locks, including for the same user.
    return int.from_bytes(
        hashlib.sha256(b"footprints-all:" + owner.bytes).digest()[:8], "big", signed=True
    )


def build_activity_cache(db, owner, activity_id, now):
    """Generate only one activity's immutable spatial derivative, with explicit bounds."""
    db.execute(text("SET LOCAL statement_timeout = '5000ms'"))
    params = dict(
        owner=owner,
        activity=activity_id,
        size=GRID_SIZE,
        candidates=MAX_CANDIDATES + 1,
        cells=MAX_CELLS + 1,
    )
    tracks = [
        dict(segment_index=r["segment_index"], geometry=r["geometry"])
        for r in db.execute(text(ACTIVITY_TRACKS), params).mappings()
    ]
    cells = list(db.execute(text(ACTIVITY_CELLS), params).mappings())
    if len(cells) > MAX_CELLS or cells and cells[0]["candidates"] > MAX_CANDIDATES:
        raise ValueError("Activity exceeds footprint spatial resource budget")
    unsupported = db.execute(
        text("""SELECT count(*) FROM activity_segments s
        JOIN activities a ON a.id=s.activity_id
        LEFT JOIN activity_points p ON p.segment_id=s.id AND s.point_count=1 AND p.point_index=0
        WHERE a.user_id=:owner AND a.id=:activity AND
        (ST_YMin(Box3D(COALESCE(s.geom,p.position))) < -85.0511287798
         OR ST_YMax(Box3D(COALESCE(s.geom,p.position))) > 85.0511287798)"""),
        params,
    ).scalar_one()
    values = dict(
        id=uuid4(),
        user_id=owner,
        activity_id=activity_id,
        algorithm_version=ALGORITHM_VERSION,
        generated_at=now,
        tracks=tracks,
        cells=[dict(i=r["i"], j=r["j"], geometry=r["geometry"]) for r in cells],
        unsupported_segment_count=unsupported,
    )
    statement = insert(FootprintActivityCache).values(**values)
    db.execute(
        statement.on_conflict_do_update(
            index_elements=["activity_id"],
            set_={
                key: value
                for key, value in values.items()
                if key not in {"id", "user_id", "activity_id"}
            },
        )
    )


def _collection(mode, features, total, visible, unsupported):
    return dict(
        scope="all",
        type="FeatureCollection",
        mode=mode,
        features=features,
        activity_count=total,
        visible_activity_count=visible,
        unsupported_segment_count=unsupported,
        grid_size_m=GRID_SIZE,
        grid_crs="EPSG:3857",
        count_basis="distinct_activity_per_cell",
        max_count=max((f["properties"].get("count", 0) for f in features), default=0),
    )


def _check_budget(stop_event, deadline):
    if stop_event is not None and stop_event.is_set():
        raise SnapshotBuildStopped()
    if monotonic() >= deadline:
        raise TimeoutError("Footprint build exceeded task deadline")


def _assemble(db, owner, stop_event, deadline):
    db.execute(text("SET LOCAL statement_timeout = '5000ms'"))
    tracks, counts, geometries = [], Counter(), {}
    visible_tracks = visible_heat = total = unsupported = byte_size = 0
    after = None
    while True:
        _check_budget(stop_event, deadline)
        query = (
            select(Activity.id, Activity.title, Activity.activity_date, FootprintActivityCache)
            .join(
                FootprintActivityCache,
                (FootprintActivityCache.activity_id == Activity.id)
                & (FootprintActivityCache.user_id == Activity.user_id),
            )
            .where(
                Activity.user_id == owner,
                FootprintActivityCache.algorithm_version == ALGORITHM_VERSION,
            )
        )
        if after is not None:
            query = query.where(Activity.id > after)
        rows = db.execute(query.order_by(Activity.id).limit(BATCH_SIZE)).all()
        if not rows:
            break
        for activity_id, title, activity_date, cache in rows:
            total += 1
            unsupported += cache.unsupported_segment_count
            visible_tracks += bool(cache.tracks)
            visible_heat += bool(cache.cells)
            for track in cache.tracks:
                feature = dict(
                    type="Feature",
                    geometry=track["geometry"],
                    properties=dict(
                        activity_id=str(activity_id),
                        segment_index=track["segment_index"],
                        title=title,
                        activity_date=activity_date.isoformat(),
                    ),
                )
                byte_size += len(json.dumps(feature, ensure_ascii=False).encode())
                tracks.append(feature)
            for cell in cache.cells:
                key = (cell["i"], cell["j"])
                counts[key] += 1
                geometries[key] = cell["geometry"]
            if byte_size > MAX_SNAPSHOT_BYTES or len(counts) > MAX_SNAPSHOT_CELLS:
                raise ValueError("Footprint snapshot exceeds resource budget")
        after = rows[-1][0]
        # Release loaded cache objects; memory remains bounded by result size and a batch.
        db.expunge_all()
    heat = [
        dict(type="Feature", geometry=geometries[i, j], properties=dict(i=i, j=j, count=count))
        for (i, j), count in sorted(counts.items())
    ]
    if byte_size + len(json.dumps(heat).encode()) > MAX_SNAPSHOT_BYTES:
        raise ValueError("Footprint snapshot exceeds resource budget")
    actual_total = db.scalar(
        select(text("count(*)")).select_from(Activity).where(Activity.user_id == owner)
    )
    if total != actual_total:
        raise SnapshotBuildStopped()
    return (
        _collection("tracks", tracks, total, visible_tracks, unsupported),
        _collection("heatmap", heat, total, visible_heat, unsupported),
    )


def _build_locked(db, owner, now, stop_event):
    deadline = monotonic() + BUILD_TIMEOUT_SECONDS
    db.execute(text("SET LOCAL statement_timeout = '5000ms'"))
    version = db.scalar(select(User.activity_data_version).where(User.id == owner))
    if version is None:
        return False
    snapshot = db.scalar(select(FootprintSnapshot).where(FootprintSnapshot.user_id == owner))
    if not refresh_due(snapshot, version, now):
        return False
    if snapshot is None:
        snapshot = FootprintSnapshot(
            user_id=owner, state="building", target_version=version, failure_count=0, attempt_at=now
        )
        db.add(snapshot)
    else:
        snapshot.state, snapshot.target_version, snapshot.attempt_at = "building", version, now
    db.commit()
    try:
        after = None
        while True:
            _check_budget(stop_event, deadline)
            query = (
                select(Activity.id)
                .outerjoin(
                    FootprintActivityCache,
                    (FootprintActivityCache.activity_id == Activity.id)
                    & (FootprintActivityCache.user_id == Activity.user_id)
                    & (FootprintActivityCache.algorithm_version == ALGORITHM_VERSION),
                )
                .where(Activity.user_id == owner, FootprintActivityCache.id.is_(None))
            )
            if after is not None:
                query = query.where(Activity.id > after)
            ids = list(db.scalars(query.order_by(Activity.id).limit(BATCH_SIZE)))
            if not ids:
                break
            for activity_id in ids:
                _check_budget(stop_event, deadline)
                build_activity_cache(db, owner, activity_id, now)
                db.commit()
            after = ids[-1]
        tracks, heatmap = _assemble(db, owner, stop_event, deadline)
        _check_budget(stop_event, deadline)
        # Only the CAS publication holds the users row lock, never spatial computation.
        current = db.scalar(
            select(User.activity_data_version).where(User.id == owner).with_for_update()
        )
        if current != version:
            raise SnapshotBuildStopped()
        snapshot = db.scalar(select(FootprintSnapshot).where(FootprintSnapshot.user_id == owner))
        snapshot.source_version, snapshot.algorithm_version = version, ALGORITHM_VERSION
        snapshot.generated_at, snapshot.tracks, snapshot.heatmap = now, tracks, heatmap
        snapshot.state, snapshot.failure_count, snapshot.retry_at = "idle", 0, None
        db.commit()
        return True
    except Exception as error:
        db.rollback()
        if stop_event is not None and stop_event.is_set():
            return False
        db.execute(text("SET LOCAL statement_timeout = '5000ms'"))
        snapshot = db.scalar(select(FootprintSnapshot).where(FootprintSnapshot.user_id == owner))
        if snapshot is not None:
            snapshot.state = "failed"
            snapshot.failure_count += 1
            snapshot.retry_at = now + retry_delay(snapshot.failure_count)
            if isinstance(error, SnapshotBuildStopped):
                snapshot.retry_at = now
            db.commit()
        if not isinstance(error, SnapshotBuildStopped):
            # Never log SQL parameters, coordinates, titles, or provider/source details.
            logger.warning("Footprint snapshot generation failed (%s)", type(error).__name__)
        return False


def build_user_snapshot(session_factory, owner, now, *, stop_event=None):
    """Deterministic worker operation; isolated connection owns the advisory lock."""
    engine = session_factory.kw["bind"]
    with engine.connect() as connection:
        if hasattr(stop_event, "attach"):
            stop_event.attach(connection)
        key = task_lock_key(owner)
        acquired = None
        try:
            acquired = connection.execute(
                text("SELECT pg_try_advisory_lock(:key)"), {"key": key}
            ).scalar_one()
            connection.commit()
            if not acquired:
                return False
            with session_factory(bind=connection) as db:
                return _build_locked(db, owner, now, stop_event)
        finally:
            if hasattr(stop_event, "detach"):
                stop_event.detach()
            if acquired is None:
                # Cancellation can hide the result after PostgreSQL acquired the lock.
                # Discard that physical connection rather than pool an unknown lock.
                connection.invalidate()
            try:
                if acquired is not None:
                    connection.rollback()
                if acquired:
                    connection.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": key})
                    connection.commit()
            except Exception:
                # A broken connection must never return a session-level advisory lock
                # to the pool. Closing the physical connection releases that lock.
                connection.invalidate()
                raise
