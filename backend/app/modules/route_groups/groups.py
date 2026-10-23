"""Group an owner's runs that follow the same route; all tables here are derivatives."""

import hashlib
import logging
from uuid import UUID, uuid4

from sqlalchemy import text

logger = logging.getLogger(__name__)

ALGORITHM_VERSION = "route-groups-v1"
MIN_DISTANCE_M = 1000
DISTANCE_TOLERANCE = 0.15
BUFFER_M = 50
MIN_COVERAGE = 0.8
# About five metres; applied in degrees before the line is stored.
SIMPLIFY_DEGREES = 0.00005
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


def build_fingerprints(db, limit: int) -> int:
    """One row per activity, oldest first; geom stays NULL when the run cannot be grouped."""
    db.execute(text("SET LOCAL statement_timeout = '5000ms'"))
    result = db.execute(
        text(
            """INSERT INTO route_fingerprints (id, user_id, activity_id, algorithm_version, geom)
               SELECT gen_random_uuid(), a.user_id, a.id, :version,
                      CASE WHEN a.distance_m >= :min_distance THEN (
                          SELECT ST_Multi(ST_SimplifyPreserveTopology(
                                     ST_Collect(s.geom ORDER BY s.segment_index), :tolerance))
                          FROM activity_segments s
                          WHERE s.activity_id = a.id AND s.geom IS NOT NULL
                      ) END
               FROM activities a
               WHERE NOT EXISTS (SELECT 1 FROM route_fingerprints f WHERE f.activity_id = a.id)
               ORDER BY a.created_at, a.id
               LIMIT :limit
               ON CONFLICT (activity_id) DO NOTHING"""
        ),
        {
            "version": ALGORITHM_VERSION,
            "min_distance": MIN_DISTANCE_M,
            "tolerance": SIMPLIFY_DEGREES,
            "limit": limit,
        },
    )
    return result.rowcount


MATCH_SQL = text(
    """
WITH me AS (
    SELECT f.geom AS geom_4326,
           ST_Transform(f.geom, 3857) AS g,
           :buffer / cos(radians(ST_Y(ST_Centroid(f.geom)))) AS r
    FROM route_fingerprints f
    WHERE f.activity_id = :activity AND f.geom IS NOT NULL
), candidates AS (
    SELECT m.group_id, ST_Transform(f.geom, 3857) AS g
    FROM route_group_members m
    JOIN route_fingerprints f ON f.activity_id = m.activity_id AND f.geom IS NOT NULL
    JOIN activities a ON a.id = m.activity_id
    JOIN me ON f.geom && me.geom_4326
    WHERE m.user_id = :owner
      AND abs(a.distance_m - :distance) <= :tolerance * greatest(a.distance_m, :distance)
), scored AS (
    SELECT c.group_id,
           least(
               ST_Length(ST_Intersection(me.g, ST_Buffer(c.g, me.r))) / ST_Length(me.g),
               ST_Length(ST_Intersection(c.g, ST_Buffer(me.g, me.r))) / ST_Length(c.g)
           ) AS coverage
    FROM candidates c CROSS JOIN me
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


def assign_user(db, owner: UUID, limit: int) -> int:
    """Place the owner's oldest ungrouped runs; one transaction per owner via an advisory lock."""
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
        matches = matching_groups(db, owner, activity_id, distance)
        if matches:
            target, coverage = matches[0]
            others = [group_id for group_id, _ in matches[1:]]
            if others:
                # The run bridges groups that were separate: keep the earliest-created one.
                ordered = (
                    db.execute(
                        text(
                            "SELECT id FROM route_groups WHERE id = ANY(:ids) "
                            "ORDER BY created_at, id"
                        ),
                        {"ids": [target, *others]},
                    )
                    .scalars()
                    .all()
                )
                target = ordered[0]
                merged = ordered[1:]
                db.execute(
                    text(
                        "UPDATE route_group_members SET group_id = :target "
                        "WHERE group_id = ANY(:old)"
                    ),
                    {"target": target, "old": merged},
                )
                db.execute(text("DELETE FROM route_groups WHERE id = ANY(:old)"), {"old": merged})
        else:
            target, coverage = uuid4(), 1.0
            db.execute(
                text(
                    "INSERT INTO route_groups (id, user_id, algorithm_version) "
                    "VALUES (:id, :owner, :version)"
                ),
                {"id": target, "owner": owner, "version": ALGORITHM_VERSION},
            )
        db.execute(
            text(
                "INSERT INTO route_group_members (activity_id, user_id, group_id, coverage) "
                "VALUES (:activity, :owner, :group, :coverage)"
            ),
            {"activity": activity_id, "owner": owner, "group": target, "coverage": coverage},
        )
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
                    """SELECT DISTINCT f.user_id FROM route_fingerprints f
                       WHERE f.geom IS NOT NULL AND NOT EXISTS (
                           SELECT 1 FROM route_group_members m WHERE m.activity_id = f.activity_id)
                       LIMIT :owners"""
                ),
                {"owners": MAX_OWNERS_PER_SCAN},
            )
        )
    for owner in owners:
        while not stopped():
            with session_factory() as db:
                assigned = assign_user(db, owner, limit)
                db.commit()
            if not assigned:
                break
            done += assigned
    return done
