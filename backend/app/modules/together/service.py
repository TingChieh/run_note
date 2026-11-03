"""Public, explicitly selected running data; no wellbeing tables are accessed."""

import base64
import binascii
from datetime import date, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import text

from app.core.errors import ApiError
from app.modules.together.schema import FeedPage, TogetherView

# Named showcase must be accessible as well as the user's own public-home switch.
ELIGIBLE = """u.together_allowed AND u.together_enabled AND u.profile_is_public
    AND (u.email_normalized = :owner OR (u.is_active AND u.showcase_enabled))"""


TRACK_SEGMENT_LIMIT = 500


def feed(db, settings, before=None, limit=20):
    params = {"owner": settings.site_owner_email, "limit": limit + 1}
    predicate = ""
    if before is not None:
        try:
            if len(before) > 128:
                raise ValueError
            raw = base64.b64decode(
                before + "=" * (-len(before) % 4), altchars=b"-_", validate=True
            ).decode("ascii")
            day, identifier = raw.split("|")
            params.update(day=date.fromisoformat(day), identifier=UUID(identifier))
            predicate = "AND (a.activity_date, a.id) < (:day, :identifier)"
        except (ValueError, UnicodeError, binascii.Error):
            raise ApiError(422, "INVALID_CURSOR", "动态游标无效") from None
    rows = (
        db.execute(
            text(f"""
        SELECT a.id, u.username, u.display_name, a.title, a.category, a.tags,
            a.temporal_quality, a.activity_date, a.distance_m,
            a.avg_pace_seconds_per_km, a.elapsed_seconds, a.timer_seconds,
            a.avg_heart_rate_bpm,
            COALESCE((SELECT json_agg(ST_AsGeoJSON(
                ST_SimplifyPreserveTopology(s.geom, 0.000005), 6)::json ORDER BY s.segment_index)
                FROM activity_segments s WHERE s.activity_id = a.id AND s.geom IS NOT NULL
                AND ST_YMin(Box3D(s.geom)) >= -85 AND ST_YMax(Box3D(s.geom)) <= 85
                AND ST_XMax(Box3D(s.geom)) - ST_XMin(Box3D(s.geom)) <= 180), '[]'::json)
                AS geometry
        FROM activities a JOIN users u ON u.id = a.user_id
        WHERE {ELIGIBLE} AND a.visibility = 'public' {predicate}
        ORDER BY a.activity_date DESC, a.id DESC LIMIT :limit
    """),
            params,
        )
        .mappings()
        .all()
    )
    items = rows[:limit]
    cursor = None
    if len(rows) > limit:
        last = items[-1]
        cursor = (
            base64.urlsafe_b64encode(f"{last['activity_date']}|{last['id']}".encode())
            .decode()
            .rstrip("=")
        )
    return FeedPage(items=items, next_cursor=cursor)


def overview(db, settings, now, period="week"):
    today = now.astimezone(ZoneInfo("Asia/Shanghai")).date()
    params = {
        "owner": settings.site_owner_email,
        "week": today - timedelta(days=today.weekday()),
        "month": today.replace(day=1),
        "year": today.replace(month=1, day=1),
        "end": today + timedelta(days=1),
        "track_limit": TRACK_SEGMENT_LIMIT + 1,
    }
    params["start"] = params[period]
    # One grouped SQL query computes all participant totals and rankings; no per-user queries.
    participants = (
        db.execute(
            text(f"""
        SELECT u.id AS user_id, u.username, u.display_name, u.avatar_version,
            COALESCE(sum(a.distance_m) FILTER (WHERE a.activity_date >= :start), 0) AS distance_m,
            count(a.id) FILTER (WHERE a.activity_date >= :start) AS count,
            sum(COALESCE(sum(a.distance_m) FILTER (WHERE a.activity_date >= :start), 0))
                OVER () AS total_distance,
            sum(count(a.id) FILTER (WHERE a.activity_date >= :start)) OVER () AS total_count,
            COALESCE(sum(a.distance_m) FILTER (WHERE a.activity_date >= :week
                AND a.activity_date < :end), 0) AS week_m,
            COALESCE(sum(a.distance_m) FILTER (WHERE a.activity_date >= :month
                AND a.activity_date < :end), 0) AS month_m,
            COALESCE(sum(a.distance_m) FILTER (WHERE a.activity_date >= :year
                AND a.activity_date < :end), 0) AS year_m
        FROM users u LEFT JOIN activities a ON a.user_id = u.id AND a.visibility = 'public'
            AND a.activity_date >= LEAST(:week, :month, :year) AND a.activity_date < :end
        WHERE {ELIGIBLE} GROUP BY u.id ORDER BY u.username
    """),
            params,
        )
        .mappings()
        .all()
    )
    recent = feed(db, settings)
    tracks = (
        db.execute(
            text(f"""
        WITH selected AS MATERIALIZED (
            SELECT u.username, a.id AS activity_id, a.title, a.activity_date,
                s.segment_index, s.geom
            FROM activities a JOIN users u ON u.id = a.user_id
            JOIN activity_segments s ON s.activity_id = a.id
            WHERE {ELIGIBLE} AND a.visibility = 'public'
                AND a.activity_date >= :start AND a.activity_date < :end AND s.geom IS NOT NULL
                AND ST_YMin(Box3D(s.geom)) >= -85 AND ST_YMax(Box3D(s.geom)) <= 85
                AND ST_XMax(Box3D(s.geom)) - ST_XMin(Box3D(s.geom)) <= 180
            ORDER BY a.activity_date DESC, a.id DESC, s.segment_index LIMIT :track_limit
        )
        SELECT username, activity_id, title, activity_date, segment_index,
            ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, 0.000005), 6)::json AS geometry
        FROM selected ORDER BY activity_date DESC, activity_id DESC, segment_index
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
        recent=recent.items,
        next_cursor=recent.next_cursor,
        tracks=tracks[:TRACK_SEGMENT_LIMIT],
        tracks_truncated=len(tracks) > TRACK_SEGMENT_LIMIT,
    )
