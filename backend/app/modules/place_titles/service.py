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

# Samples are spaced along the collected line, then thinned to at most MAX_SAMPLES points
# (every k-th with k = ceil(total / MAX_SAMPLES), so ceil(total / k) <= MAX_SAMPLES). Every
# segment yields at least its end point, so thinning after generation is what bounds the join
# however many segments a track has. Only linear geometry functions are used on purpose.
SHARES_SQL = text(
    """
WITH line AS (
    SELECT ST_Collect(s.geom ORDER BY s.segment_index) AS g,
           ST_Length(ST_Collect(s.geom ORDER BY s.segment_index)::geography) AS len
    FROM activity_segments s
    WHERE s.activity_id = :activity AND s.geom IS NOT NULL
), parts AS (
    SELECT p.geom AS geom, p.path[1] AS ord, line.len AS len
    FROM line, LATERAL ST_Dump(line.g) AS p WHERE line.g IS NOT NULL
), samples AS (
    SELECT row_number() OVER (ORDER BY q.ord, d.path) AS n, d.geom AS pt
    FROM (
        SELECT parts.ord,
               ST_LineInterpolatePoints(
                   parts.geom,
                   least(1.0, greatest(:step, parts.len / :max_samples)
                              / nullif(ST_Length(parts.geom::geography), 0)),
                   true
               ) AS pts
        FROM parts
    ) q, LATERAL ST_Dump(q.pts) AS d
), counted AS (
    SELECT n, pt, count(*) OVER () AS total FROM samples
), thinned AS (
    SELECT n, pt FROM counted
    WHERE (n - 1) % greatest(1, ceil(total::numeric / :max_samples)::bigint) = 0
), near AS (
    SELECT f.category, count(DISTINCT s.n) AS points
    FROM thinned s
    JOIN place_features f ON ST_DWithin(f.geom, s.pt::geography, :radius)
    GROUP BY f.category
)
SELECT (SELECT count(*) FROM thinned) AS total,
       coalesce((SELECT json_object_agg(category, points) FROM near), '{}'::json) AS near
"""
)

# Same text as rules.default_title(activity_date).
DEFAULT_TITLE_SQL = "'跑步 · ' || to_char(activity_date, 'YYYY-MM-DD')"


def has_places(db) -> bool:
    return bool(db.scalar(text("SELECT EXISTS(SELECT 1 FROM place_features)")))


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
    """Optimistic: only a title that still equals the importer default is replaced.

    The caller holds the users row lock (see the lock order note on fill_place_titles).
    """
    user = lock_owner(db, owner)
    changed = db.execute(
        text(
            f"""UPDATE activities SET title = :title, updated_at = now()
               WHERE id = :activity AND user_id = :owner AND title = {DEFAULT_TITLE_SQL}"""
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


def _measure(session_factory, owner: UUID, activity_id: UUID):
    """Read-only, no row locks. Returns ("skip",), ("found", category, share) or ("retry",)."""
    try:
        with session_factory() as db:
            db.execute(text(f"SET LOCAL statement_timeout = '{STATEMENT_TIMEOUT}'"))
            is_default = db.scalar(
                text(
                    f"""SELECT title = {DEFAULT_TITLE_SQL} FROM activities
                        WHERE id = :activity AND user_id = :owner"""
                ),
                {"activity": activity_id, "owner": owner},
            )
            if not is_default:  # deleted, renamed or user-titled
                return ("skip",)
            found = resolve(db, activity_id)
            return ("skip",) if found is None else ("found", *found)
    except Exception as error:  # one bad run must not block the others
        logger.warning("place title failed for one run (%s)", type(error).__name__)
        if isinstance(getattr(error, "orig", None), psycopg.errors.QueryCanceled):
            # A busy database must not exclude the run for good: retry it later, after the others.
            return ("retry",)
        return ("skip",)


def _record(session_factory, owner: UUID, activity_id: UUID, outcome) -> bool:
    """Short write transaction. Returns True when the run was renamed."""
    with session_factory() as db:
        try:
            with db.begin_nested():
                # Lock order: users row first (as importers and activity deletion do), then the
                # queue row. A run deleted meanwhile has no queue row left: nothing to do.
                lock_owner(db, owner)
                row = db.execute(
                    text(
                        """SELECT 1 FROM activity_place_names
                           WHERE activity_id = :activity AND state = 'pending'
                           FOR UPDATE SKIP LOCKED"""
                    ),
                    {"activity": activity_id},
                ).first()
                if row is None:
                    return False
                if outcome[0] == "retry":
                    db.execute(
                        text(
                            "UPDATE activity_place_names SET updated_at = clock_timestamp() "
                            "WHERE activity_id = :activity"
                        ),
                        {"activity": activity_id},
                    )
                    renamed = False
                elif outcome[0] == "found":
                    _, category, share = outcome
                    title = rules.title_for(category)
                    renamed = apply_title(db, owner, activity_id, title)
                    if renamed:
                        _finish(db, activity_id, "done", category, share, title)
                    else:
                        _finish(db, activity_id, "skipped", category, share)
                else:
                    _finish(db, activity_id, "skipped")
                    renamed = False
        except Exception as error:
            logger.warning("place title could not be recorded (%s)", type(error).__name__)
            db.rollback()
            return False
        db.commit()
        return renamed


def fill_place_titles(session_factory, *, limit=FILL_BATCH, stop_event=None) -> int:
    """Name queued runs; returns how many were renamed. Stays pending until places exist.

    Each pending run is attempted at most once per call: rows are walked by keyset on
    (updated_at, activity_id) and only those not newer than the call's start are considered, so
    a run that stays pending (a timeout moves it to the back) cannot keep the loop busy.

    Lock order is users row -> queue row everywhere (importers, deletion, this worker). The
    expensive measurement therefore runs first with no row locks, and each run is then applied
    in its own short transaction.
    """
    renamed = 0
    last = ("-infinity", UUID(int=0))
    with session_factory() as db:
        cutoff = db.scalar(text("SELECT clock_timestamp()"))
    while stop_event is None or not stop_event.is_set():
        with session_factory() as db:
            if not has_places(db):
                return renamed
            rows = db.execute(
                text(
                    """SELECT activity_id, user_id, updated_at FROM activity_place_names
                       WHERE state = 'pending' AND updated_at <= :cutoff
                         AND (updated_at, activity_id) > (CAST(:ts AS timestamptz), :id)
                       ORDER BY updated_at, activity_id LIMIT :limit"""
                ),
                {"cutoff": cutoff, "ts": last[0], "id": last[1], "limit": limit},
            ).all()
        if not rows:
            return renamed
        for activity_id, owner, updated_at in rows:
            if stop_event is not None and stop_event.is_set():
                break
            last = (updated_at, activity_id)
            outcome = _measure(session_factory, owner, activity_id)
            if _record(session_factory, owner, activity_id, outcome):
                renamed += 1
        else:
            continue
        break
    return renamed
