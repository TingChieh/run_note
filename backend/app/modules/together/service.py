"""Public, explicitly selected running data; no wellbeing tables are accessed."""

from datetime import timedelta

from sqlalchemy import text

from app.modules.together.schema import TogetherView

# Named showcase must be accessible as well as the user's own public-home switch.
ELIGIBLE = """u.together_allowed AND u.together_enabled AND u.profile_is_public
    AND (u.email_normalized = :owner OR (u.is_active AND u.showcase_enabled))"""


def overview(db, settings, now):
    today = now.date()
    params = {
        "owner": settings.site_owner_email,
        "week": today - timedelta(days=today.weekday()),
        "month": today.replace(day=1),
        "end": today + timedelta(days=1),
    }
    # One grouped SQL query computes all participant totals and both rankings; no per-user queries.
    participants = (
        db.execute(
            text(f"""
        SELECT u.username, u.display_name, COALESCE(sum(a.distance_m), 0) AS distance_m,
            count(a.id) AS count,
            sum(COALESCE(sum(a.distance_m), 0)) OVER () AS total_distance,
            sum(count(a.id)) OVER () AS total_count,
            COALESCE(sum(a.distance_m) FILTER (WHERE a.activity_date >= :week
                AND a.activity_date < :end), 0) AS week_m,
            COALESCE(sum(a.distance_m) FILTER (WHERE a.activity_date >= :month
                AND a.activity_date < :end), 0) AS month_m
        FROM users u LEFT JOIN activities a ON a.user_id = u.id
        WHERE {ELIGIBLE} GROUP BY u.id ORDER BY u.username
    """),
            params,
        )
        .mappings()
        .all()
    )
    recent = (
        db.execute(
            text(f"""
        SELECT a.id, u.username, u.display_name, a.title, a.activity_date, a.distance_m
        FROM activities a JOIN users u ON u.id = a.user_id
        WHERE {ELIGIBLE} ORDER BY a.activity_date DESC, a.id DESC LIMIT 30
    """),
            params,
        )
        .mappings()
        .all()
    )
    tracks = (
        db.execute(
            text(f"""
        WITH selected AS MATERIALIZED (
            SELECT u.username, a.id AS activity_id, a.title, a.activity_date,
                s.segment_index, s.geom
            FROM activities a JOIN users u ON u.id = a.user_id
            JOIN activity_segments s ON s.activity_id = a.id
            WHERE {ELIGIBLE} AND s.geom IS NOT NULL
                AND ST_YMin(Box3D(s.geom)) >= -85 AND ST_YMax(Box3D(s.geom)) <= 85
                AND ST_XMax(Box3D(s.geom)) - ST_XMin(Box3D(s.geom)) <= 180
            ORDER BY a.activity_date DESC, a.id DESC, s.segment_index LIMIT 500
        )
        SELECT username, activity_id, title, activity_date, segment_index,
            ST_AsGeoJSON(ST_Simplify(geom, 0.0001), 6)::json AS geometry
        FROM selected
    """),
            params,
        )
        .mappings()
        .all()
    )
    return TogetherView(
        distance_m=float(participants[0]["total_distance"]) if participants else 0,
        count=int(participants[0]["total_count"]) if participants else 0,
        participants=participants,
        recent=recent,
        tracks=tracks,
    )
