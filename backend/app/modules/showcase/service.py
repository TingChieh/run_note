"""Read-only owner resolution and independent public serialization."""

from sqlalchemy import select

from app.core.errors import ApiError
from app.modules.activities import service as activities
from app.modules.running_goals.model import RunningGoal
from app.modules.running_goals.schema import GoalsView
from app.modules.showcase.schema import (
    ShowcaseActivity,
    ShowcaseActivityList,
)
from app.modules.users.model import User


def site_owner(db, settings):
    user = db.scalar(select(User).where(User.email_normalized == settings.site_owner_email))
    if user is None:
        raise ApiError(503, "SHOWCASE_UNAVAILABLE", "展示账号尚未就绪，请联系站点管理员")
    return user


def named_owner(db, settings, username):
    user = db.scalar(select(User).where(User.username == username))
    if user is None or not (
        user.email_normalized == settings.site_owner_email
        or (user.is_active and user.showcase_enabled)
    ):
        raise ApiError(404, "RESOURCE_NOT_FOUND", "页面不存在或已停止展示")
    return user


def activity_list(db, owner, limit, offset, activity_date, category, activity_month):
    result = activities.listing(db, owner, limit, offset, activity_date, category, activity_month)
    return ShowcaseActivityList(
        items=[ShowcaseActivity.model_validate(row.model_dump()) for row in result.items],
        total=result.total,
        limit=limit,
        offset=offset,
    )


def activity_detail(db, owner, identifier):
    return ShowcaseActivity.model_validate(activities.detail(db, owner, identifier).model_dump())


def goals(db, owner):
    rows = db.scalars(select(RunningGoal).where(RunningGoal.user_id == owner)).all()
    return GoalsView(**{row.period: float(row.target_km) for row in rows})


def geometry_view(value):
    if value["type"] == "GeometryCollection":
        return {
            "type": value["type"],
            "geometries": [geometry_view(g) for g in value["geometries"]],
        }
    return {"type": value["type"], "coordinates": value["coordinates"]}


def route_view(value):
    return {
        "type": "FeatureCollection",
        "start": value["start"],
        "end": value["end"],
        "features": [
            {
                "type": "Feature",
                "geometry": geometry_view(feature["geometry"]),
                "properties": {
                    key: feature["properties"][key] for key in ("segment_index", "point_count")
                },
            }
            for feature in value["features"]
        ],
    }


REPLAY_KEYS = (
    "mode",
    "point_count",
    "interpolated_point_count",
    "distance_m",
    "elapsed_seconds",
    "moving_seconds",
)
REPLAY_SEGMENT_KEYS = (
    "segment_index",
    "coordinates",
    "elapsed_s",
    "moving_s",
    "distance_m",
    "pace_s_per_km",
)


def replay_view(value):
    return {key: value[key] for key in REPLAY_KEYS} | {
        "segments": [
            {key: segment[key] for key in REPLAY_SEGMENT_KEYS} for segment in value["segments"]
        ]
    }


def footprint_view(value):
    keys = (
        "type",
        "mode",
        "scope",
        "date_from",
        "date_to",
        "activity_count",
        "visible_activity_count",
        "unsupported_segment_count",
        "grid_size_m",
        "grid_crs",
        "count_basis",
        "max_count",
    )
    allowed = {"activity_id", "segment_index", "title", "activity_date", "i", "j", "count"}
    return {
        **{key: value[key] for key in keys if key in value},
        "features": [
            {
                "type": "Feature",
                "geometry": geometry_view(feature["geometry"]),
                "properties": {
                    key: item for key, item in feature["properties"].items() if key in allowed
                },
            }
            for feature in value["features"]
        ],
    }
