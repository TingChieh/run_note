"""Name runs after nearby places: measure, decide, then update only still-default titles."""

import logging
from uuid import UUID

import psycopg.errors
from sqlalchemy import text

from app.modules.activities.service import lock_owner
from app.modules.place_titles import rules

logger = logging.getLogger(__name__)
FILL_BATCH = 20
STATEMENT_TIMEOUT = "10000ms"

# Samples are spaced along the collected line and capped at MAX_SAMPLES, so the work per run
# is bounded however long the track is. Only linear geometry functions are used on purpose.
SHARES_SQL = text(
    """
WITH line AS (
    SELECT ST_Collect(s.geom ORDER BY s.segment_index) AS g,
           ST_Length(ST_Collect(s.geom ORDER BY s.segment_index)::geography) AS len
    FROM activity_segments s
    WHERE s.activity_id = :activity AND s.geom IS NOT NULL
), parts AS (
    SELECT p.geom AS geom, line.len AS len
    FROM line, LATERAL ST_Dump(line.g) AS p WHERE line.g IS NOT NULL
), samples AS (
    SELECT row_number() OVER () AS n, d.geom AS pt
    FROM (
        SELECT ST_LineInterpolatePoints(
                   parts.geom,
                   least(1.0, greatest(:step, parts.len / :max_samples)
                              / nullif(ST_Length(parts.geom::geography), 0)),
                   true
               ) AS pts
        FROM parts
    ) q, LATERAL ST_Dump(q.pts) AS d
), near AS (
    SELECT f.category, count(DISTINCT s.n) AS points
    FROM samples s
    JOIN place_features f ON ST_DWithin(f.geom, s.pt::geography, :radius)
    GROUP BY f.category
)
SELECT (SELECT count(*) FROM samples) AS total,
       coalesce((SELECT json_object_agg(category, points) FROM near), '{}'::json) AS near
"""
)


def place_count(db) -> int:
    return db.scalar(text("SELECT count(*) FROM place_features"))


def measure_shares(db, activity_id: UUID) -> tuple[int, dict[str, int]]:
    total, near = db.execute(
        SHARES_SQL,
        {
            "activity": activity_id,
            "step": rules.STEP_M,
            "max_samples": rules.MAX_SAMPLES,
            "radius": rules.RADIUS_M,
        },
    ).one()
    return int(total), {category: int(points) for category, points in near.items()}


def resolve(db, activity_id: UUID) -> tuple[str, float] | None:
    distance = db.scalar(
        text("SELECT distance_m FROM activities WHERE id = :activity"), {"activity": activity_id}
    )
    if distance is None or distance < rules.MIN_DISTANCE_M:
        return None
    total, near = measure_shares(db, activity_id)
    return rules.choose_category(total, near)


def apply_title(db, owner: UUID, activity_id: UUID, new_title: str) -> bool:
    """Optimistic: only a title that still equals the importer default is replaced."""
    user = lock_owner(db, owner)
    changed = db.execute(
        text(
            """UPDATE activities SET title = :title, updated_at = now()
               WHERE id = :activity AND user_id = :owner
                 AND title = '跑步 · ' || activity_date::text"""
        ),
        {"title": new_title, "activity": activity_id, "owner": owner},
    ).rowcount
    if changed:
        user.activity_data_version += 1
        db.flush()
    return bool(changed)


def _finish(db, activity_id, state, category=None, share=None, title=None):
    db.execute(
        text(
            """UPDATE activity_place_names
               SET state = :state, category = :category, share = :share,
                   applied_title = :title, algorithm_version = :version, updated_at = now()
               WHERE activity_id = :activity"""
        ),
        {
            "state": state,
            "category": category,
            "share": share,
            "title": title,
            "version": rules.ALGORITHM_VERSION,
            "activity": activity_id,
        },
    )


def _name_one(db, owner: UUID, activity_id: UUID) -> None:
    found = resolve(db, activity_id)
    if found is None:
        _finish(db, activity_id, "skipped")
        return
    category, share = found
    title = rules.title_for(category)
    if apply_title(db, owner, activity_id, title):
        _finish(db, activity_id, "done", category, share, title)
    else:
        _finish(db, activity_id, "skipped", category, share)


def _handle_failure(db, activity_id, error: Exception) -> None:
    logger.warning("place title failed for one run (%s)", type(error).__name__)
    if isinstance(getattr(error, "orig", None), psycopg.errors.QueryCanceled):
        # A busy database must not exclude the run for good: retry it later, after the others.
        db.execute(
            text(
                "UPDATE activity_place_names SET updated_at = clock_timestamp() "
                "WHERE activity_id = :activity"
            ),
            {"activity": activity_id},
        )
    else:
        _finish(db, activity_id, "skipped")


def fill_place_titles(session_factory, *, limit=FILL_BATCH, stop_event=None) -> int:
    """Resolve queued runs; leaves them pending until some place data has been imported.

    Every pending run is attempted at most once per call, so a run that stays pending (for
    example after a timeout) cannot keep the loop busy; the next scan retries it.
    """
    done = 0
    attempted: list[UUID] = []
    while stop_event is None or not stop_event.is_set():
        with session_factory() as db:
            if not place_count(db):
                return done
            db.execute(text(f"SET LOCAL statement_timeout = '{STATEMENT_TIMEOUT}'"))
            rows = db.execute(
                text(
                    """SELECT activity_id, user_id FROM activity_place_names
                       WHERE state = 'pending'
                         AND activity_id <> ALL(CAST(:attempted AS uuid[]))
                       ORDER BY updated_at, activity_id
                       LIMIT :limit FOR UPDATE SKIP LOCKED"""
                ),
                {"attempted": attempted, "limit": limit},
            ).all()
            if not rows:
                return done
            for activity_id, owner in rows:
                if stop_event is not None and stop_event.is_set():
                    break
                attempted.append(activity_id)
                try:
                    with db.begin_nested():
                        _name_one(db, owner, activity_id)
                except Exception as error:  # one bad run must not block the others
                    _handle_failure(db, activity_id, error)
                done += 1
            db.commit()
    return done
