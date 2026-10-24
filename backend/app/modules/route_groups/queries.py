"""Read-side SQL: groups are aggregated from their member activities at read time."""

from sqlalchemy import text

MIN_RUNS = 2
ORDER = {
    "count": "agg.run_count DESC, agg.last_date DESC, agg.group_id",
    "recent": "agg.last_date DESC, agg.run_count DESC, agg.group_id",
    "distance": "agg.median_distance_m DESC, agg.group_id",
}

AGGREGATES = """
WITH members AS (
    SELECT m.group_id, a.id AS activity_id, a.activity_date, a.distance_m,
           COALESCE(a.timer_seconds, a.elapsed_seconds) AS duration,
           a.avg_pace_seconds_per_km AS pace
    FROM route_group_members m JOIN activities a ON a.id = m.activity_id
    WHERE m.user_id = :owner {group_filter}
), agg AS (
    SELECT group_id, count(*) AS run_count, min(activity_date) AS first_date,
           max(activity_date) AS last_date,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY distance_m) AS median_distance_m,
           min(duration) AS best_duration_seconds, avg(duration) AS avg_duration_seconds,
           min(pace) AS best_pace_seconds_per_km, avg(pace) AS avg_pace_seconds_per_km
    FROM members GROUP BY group_id HAVING count(*) >= :min_runs
)
"""

SELECT_GROUPS = """
SELECT agg.group_id AS id, agg.run_count, agg.first_date, agg.last_date,
       agg.median_distance_m, agg.best_duration_seconds, agg.avg_duration_seconds,
       agg.best_pace_seconds_per_km, agg.avg_pace_seconds_per_km, rep.shape
FROM agg
JOIN LATERAL (
    SELECT (ST_AsGeoJSON(f.geom, 5)::json -> 'coordinates') AS shape
    FROM members mm JOIN route_fingerprints f ON f.activity_id = mm.activity_id
    WHERE mm.group_id = agg.group_id AND f.geom IS NOT NULL
    ORDER BY abs(mm.distance_m - agg.median_distance_m), mm.activity_date, mm.activity_id
    LIMIT 1
) rep ON true
"""


def list_rows(db, owner, limit, offset, sort):
    order = f" ORDER BY {ORDER[sort]} LIMIT :limit OFFSET :offset"
    sql = AGGREGATES.format(group_filter="") + SELECT_GROUPS + order
    params = {"owner": owner, "min_runs": MIN_RUNS, "limit": limit, "offset": offset}
    return db.execute(text(sql), params).mappings().all()


def count_groups(db, owner):
    sql = AGGREGATES.format(group_filter="") + "SELECT count(*) FROM agg"
    return db.scalar(text(sql), {"owner": owner, "min_runs": MIN_RUNS})


def group_row(db, owner, group):
    sql = AGGREGATES.format(group_filter="AND m.group_id = :group") + SELECT_GROUPS
    params = {"owner": owner, "group": group, "min_runs": MIN_RUNS}
    return db.execute(text(sql), params).mappings().first()


def run_rows(db, owner, group):
    return (
        db.execute(
            text(
                """SELECT a.id AS activity_id, a.title, a.activity_date, a.distance_m,
                          COALESCE(a.timer_seconds, a.elapsed_seconds) AS duration_seconds,
                          a.avg_pace_seconds_per_km, m.coverage
                   FROM route_group_members m JOIN activities a ON a.id = m.activity_id
                   WHERE m.user_id = :owner AND m.group_id = :group
                   ORDER BY a.activity_date DESC, a.started_at DESC NULLS LAST, a.id"""
            ),
            {"owner": owner, "group": group},
        )
        .mappings()
        .all()
    )


def has_unprocessed(db, owner):
    return bool(
        db.scalar(
            text(
                """SELECT EXISTS (
                       SELECT 1 FROM activities a
                       WHERE a.user_id = :owner
                         AND NOT EXISTS (
                             SELECT 1 FROM route_fingerprints f WHERE f.activity_id = a.id))
                   OR EXISTS (
                       SELECT 1 FROM route_fingerprints f
                       WHERE f.user_id = :owner AND f.geom IS NOT NULL
                         AND NOT EXISTS (
                             SELECT 1 FROM route_group_members m
                             WHERE m.activity_id = f.activity_id))"""
            ),
            {"owner": owner},
        )
    )
