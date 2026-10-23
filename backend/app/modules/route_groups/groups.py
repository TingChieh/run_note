"""Group an owner's runs that follow the same route; all tables here are derivatives."""

import hashlib
import logging
from uuid import UUID, uuid4

from sqlalchemy import text

logger = logging.getLogger(__name__)

ALGORITHM_VERSION = "route-groups-v2"
MIN_DISTANCE_M = 1000
DISTANCE_TOLERANCE = 0.15
BUFFER_M = 50
MIN_COVERAGE = 0.8
# About five metres; applied in degrees before the line is stored.
SIMPLIFY_DEGREES = 0.00005
# A stored fingerprint stays small enough for the buffer/intersection match; noisy or very
# long tracks are coarsened once and left ungrouped (NULL) if they still do not fit.
MAX_FINGERPRINT_VERTICES = 2000
COARSEN_FACTORS = (10,)
# A simplified line shorter than this (metres, geography) is noise or a stationary track.
MIN_FINGERPRINT_LENGTH_M = 100
FILL_BATCH = 20
MAX_OWNERS_PER_SCAN = 50


def lock_key(owner: UUID) -> int:
    # Separate namespace from import and footprint locks, including for the same user.
    return int.from_bytes(
        hashlib.sha256(b"route-groups:" + owner.bytes).digest()[:8], "big", signed=True
    )


def reset_stale_versions(db) -> None:
    """A new algorithm version rebuilds everything; members go with their groups."""
    params = {"version": ALGORITHM_VERSION}
    db.execute(text("DELETE FROM route_groups WHERE algorithm_version <> :version"), params)
    db.execute(text("DELETE FROM route_fingerprints WHERE algorithm_version <> :version"), params)
    # Groups whose runs were all deleted are no longer reachable from any member.
    db.execute(
        text(
            """DELETE FROM route_groups g
               WHERE NOT EXISTS (SELECT 1 FROM route_group_members m WHERE m.group_id = g.id)"""
        )
    )


FINGERPRINT_SQL = text(
    """INSERT INTO route_fingerprints (id, user_id, activity_id, algorithm_version, geom)
       SELECT gen_random_uuid(), a.user_id, a.id, :version,
              CASE WHEN :compute AND a.distance_m >= :min_distance THEN (
                  SELECT CASE WHEN ST_Length(f.g::geography) >= :min_length THEN f.g END
                  FROM (
                      SELECT CASE
                                 WHEN ST_NPoints(c.g) <= :max_vertices THEN c.g
                                 WHEN ST_NPoints(c.g1) <= :max_vertices THEN c.g1
                             END AS g
                      FROM (
                          SELECT ST_Multi(ST_Simplify(
                                     ST_RemoveRepeatedPoints(
                                         ST_Collect(s.geom ORDER BY s.segment_index),
                                         :tolerance),
                                     :tolerance, true)) AS g
                          FROM activity_segments s
                          WHERE s.activity_id = a.id AND s.geom IS NOT NULL
                      ) base
                      CROSS JOIN LATERAL (
                          SELECT CASE WHEN NOT ST_IsEmpty(base.g) THEN base.g END AS g
                      ) c0
                      CROSS JOIN LATERAL (
                          SELECT c0.g AS g,
                                 CASE WHEN ST_NPoints(c0.g) > :max_vertices THEN
                                     ST_Multi(ST_Simplify(c0.g, :coarse, true)) END AS g1
                      ) c
                  ) f
              ) END
       FROM activities a
       WHERE a.id = ANY(:ids)
       ON CONFLICT (activity_id) DO NOTHING"""
)


def insert_fingerprints(db, ids: list[UUID], *, compute: bool = True) -> int:
    """compute=False writes NULL fingerprints, which marks the runs as handled."""
    return db.execute(
        FINGERPRINT_SQL,
        {
            "ids": ids,
            "compute": compute,
            "version": ALGORITHM_VERSION,
            "min_distance": MIN_DISTANCE_M,
            "min_length": MIN_FINGERPRINT_LENGTH_M,
            "tolerance": SIMPLIFY_DEGREES,
            "max_vertices": MAX_FINGERPRINT_VERTICES,
            "coarse": SIMPLIFY_DEGREES * COARSEN_FACTORS[0],
        },
    ).rowcount


def build_fingerprints(db, limit: int) -> int:
    """One row per activity, oldest first; geom stays NULL when the run cannot be grouped.

    A failing batch is retried one run at a time, and a run that fails alone gets a NULL
    fingerprint, so a single bad track cannot make every later scan fail the same way.
    """
    db.execute(text("SET LOCAL statement_timeout = '5000ms'"))
    ids = list(
        db.scalars(
            text(
                """SELECT a.id FROM activities a
                   WHERE NOT EXISTS (SELECT 1 FROM route_fingerprints f WHERE f.activity_id = a.id)
                   ORDER BY a.created_at, a.id
                   LIMIT :limit"""
            ),
            {"limit": limit},
        )
    )
    if not ids:
        return 0
    try:
        with db.begin_nested():
            return insert_fingerprints(db, ids)
    except Exception as error:
        logger.warning("route fingerprint batch failed (%s); retrying singly", type(error).__name__)
    built = 0
    for activity_id in ids:
        try:
            with db.begin_nested():
                built += insert_fingerprints(db, [activity_id])
        except Exception as error:
            logger.warning("route fingerprint failed for one run (%s)", type(error).__name__)
            built += insert_fingerprints(db, [activity_id], compute=False)
    return built


MATCH_SQL = text(
    """
WITH me AS (
    SELECT x.geom_4326, x.g, x.r, ST_Buffer(x.g, x.r) AS buf
    FROM (
        SELECT f.geom AS geom_4326,
               ST_Transform(f.geom, 3857) AS g,
               :buffer / cos(radians(ST_Y(ST_Centroid(f.geom)))) AS r
        FROM route_fingerprints f
        WHERE f.activity_id = :activity AND f.geom IS NOT NULL
    ) x
), candidates AS (
    SELECT m.group_id, ST_Transform(f.geom, 3857) AS g
    FROM route_group_members m
    JOIN route_fingerprints f ON f.activity_id = m.activity_id AND f.geom IS NOT NULL
    JOIN activities a ON a.id = m.activity_id
    JOIN me ON f.geom && me.geom_4326
    WHERE m.user_id = :owner
      AND abs(a.distance_m - :distance) <= :tolerance * greatest(a.distance_m, :distance)
), ratios AS (
    SELECT c.group_id,
           ST_Length(ST_Intersection(me.g, ST_Buffer(c.g, me.r)))
               / NULLIF(ST_Length(me.g), 0) AS mine,
           ST_Length(ST_Intersection(c.g, me.buf)) / NULLIF(ST_Length(c.g), 0) AS theirs
    FROM candidates c CROSS JOIN me
), scored AS (
    -- least() ignores NULL, so a missing ratio must be turned into a NULL coverage explicitly.
    SELECT group_id,
           CASE WHEN mine IS NULL OR theirs IS NULL THEN NULL
                ELSE greatest(0, least(1, mine, theirs)) END AS coverage
    FROM ratios
)
SELECT group_id, max(coverage) AS coverage
FROM scored
GROUP BY group_id
HAVING max(coverage) >= :min_coverage
ORDER BY max(coverage) DESC, group_id
"""
)


def matching_groups(db, owner: UUID, activity_id: UUID, distance) -> list[tuple[UUID, float]]:
    rows = db.execute(
        MATCH_SQL,
        {
            "buffer": BUFFER_M,
            "activity": activity_id,
            "owner": owner,
            "distance": distance,
            "tolerance": DISTANCE_TOLERANCE,
            "min_coverage": MIN_COVERAGE,
        },
    ).all()
    return [(group_id, float(coverage)) for group_id, coverage in rows]


def new_group(db, owner: UUID, activity_id: UUID) -> None:
    group = uuid4()
    db.execute(
        text(
            # clock_timestamp(): now() is the transaction start and would tie groups made together.
            "INSERT INTO route_groups (id, user_id, algorithm_version, created_at) "
            "VALUES (:id, :owner, :version, clock_timestamp())"
        ),
        {"id": group, "owner": owner, "version": ALGORITHM_VERSION},
    )
    add_member(db, owner, activity_id, group, 1.0)


def add_member(db, owner: UUID, activity_id: UUID, group: UUID, coverage: float) -> None:
    db.execute(
        text(
            "INSERT INTO route_group_members (activity_id, user_id, group_id, coverage) "
            "VALUES (:activity, :owner, :group, :coverage)"
        ),
        {"activity": activity_id, "owner": owner, "group": group, "coverage": coverage},
    )


def place(db, owner: UUID, activity_id: UUID, distance) -> None:
    matches = matching_groups(db, owner, activity_id, distance)
    if not matches:
        new_group(db, owner, activity_id)
        return
    target, coverage = matches[0]
    others = [group_id for group_id, _ in matches[1:]]
    if others:
        # The run bridges groups that were separate: keep the earliest-created one.
        ordered = (
            db.execute(
                text("SELECT id FROM route_groups WHERE id = ANY(:ids) ORDER BY created_at, id"),
                {"ids": [target, *others]},
            )
            .scalars()
            .all()
        )
        target, merged = ordered[0], ordered[1:]
        db.execute(
            text("UPDATE route_group_members SET group_id = :target WHERE group_id = ANY(:old)"),
            {"target": target, "old": merged},
        )
        db.execute(text("DELETE FROM route_groups WHERE id = ANY(:old)"), {"old": merged})
    add_member(db, owner, activity_id, target, coverage)


def assign_user(db, owner: UUID, limit: int) -> int:
    """Place the owner's oldest ungrouped runs; one transaction per owner via an advisory lock.

    Each run is placed inside a savepoint; if matching fails (for example a timeout), the run
    becomes a group of its own so it cannot block the runs behind it on every later scan.
    """
    db.execute(text("SET LOCAL statement_timeout = '10000ms'"))
    if not db.scalar(text("SELECT pg_try_advisory_xact_lock(:key)"), {"key": lock_key(owner)}):
        return 0
    pending = db.execute(
        text(
            """SELECT f.activity_id, a.distance_m
               FROM route_fingerprints f JOIN activities a ON a.id = f.activity_id
               WHERE f.user_id = :owner AND f.geom IS NOT NULL AND f.algorithm_version = :version
                 AND NOT EXISTS (
                     SELECT 1 FROM route_group_members m WHERE m.activity_id = f.activity_id)
               ORDER BY a.activity_date, a.created_at, a.id
               LIMIT :limit"""
        ),
        {"owner": owner, "version": ALGORITHM_VERSION, "limit": limit},
    ).all()
    for activity_id, distance in pending:
        try:
            with db.begin_nested():
                place(db, owner, activity_id, distance)
        except Exception as error:
            logger.warning("route matching failed for one run (%s)", type(error).__name__)
            new_group(db, owner, activity_id)
    return len(pending)


def fill_route_groups(session_factory, *, limit=FILL_BATCH, stop_event=None) -> int:
    """Bounded, restart-safe pass: stale cleanup, fingerprints, then grouping per owner."""

    def stopped():
        return stop_event is not None and stop_event.is_set()

    done = 0
    with session_factory() as db:
        reset_stale_versions(db)
        db.commit()
    while not stopped():
        with session_factory() as db:
            built = build_fingerprints(db, limit)
            db.commit()
        if not built:
            break
        done += built
    with session_factory() as db:
        owners = list(
            db.scalars(
                text(
                    """SELECT f.user_id FROM route_fingerprints f
                       WHERE f.geom IS NOT NULL AND NOT EXISTS (
                           SELECT 1 FROM route_group_members m WHERE m.activity_id = f.activity_id)
                       GROUP BY f.user_id
                       ORDER BY min(f.generated_at), f.user_id
                       LIMIT :owners"""
                ),
                {"owners": MAX_OWNERS_PER_SCAN},
            )
        )
    for owner in owners:
        try:
            while not stopped():
                with session_factory() as db:
                    assigned = assign_user(db, owner, limit)
                    db.commit()
                if not assigned:
                    break
                done += assigned
        except Exception as error:  # one owner must not stop the others
            logger.warning("route grouping failed for one owner (%s)", type(error).__name__)
    return done
