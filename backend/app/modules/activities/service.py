import json
from uuid import UUID

from sqlalchemy import func, select, text

from app.core.errors import ApiError
from app.modules.activities.model import Activity
from app.modules.activities.schema import ActivityList, ActivityView
from app.modules.gpx.model import ActivitySegment


def view(activity, has_route=True):
    fields = {
        name: getattr(activity, name) for name in ActivityView.model_fields if name != "has_route"
    }
    return ActivityView(**fields, has_route=has_route)


def owned_activity(db, owner: UUID, identifier: UUID):
    activity = db.scalar(
        select(Activity).where(Activity.id == identifier, Activity.user_id == owner)
    )
    if activity is None:
        raise ApiError(404, "RESOURCE_NOT_FOUND", "记录不存在")
    return activity


def detail(db, owner, identifier):
    activity = owned_activity(db, owner, identifier)
    exists = db.scalar(
        select(ActivitySegment.id).where(ActivitySegment.activity_id == identifier).limit(1)
    )
    return view(activity, exists is not None)


def listing(db, owner, limit, offset, activity_date=None):
    filters = [Activity.user_id == owner]
    if activity_date is not None:
        filters.append(Activity.activity_date == activity_date)
    activities = db.scalars(
        select(Activity)
        .where(*filters)
        .order_by(Activity.activity_date.desc(), Activity.id.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    ids = [a.id for a in activities]
    routed = (
        set(
            db.scalars(
                select(ActivitySegment.activity_id)
                .where(ActivitySegment.activity_id.in_(ids))
                .distinct()
            )
        )
        if ids
        else set()
    )
    total = db.scalar(select(func.count()).select_from(Activity).where(*filters))
    return ActivityList(
        items=[view(a, a.id in routed) for a in activities], total=total, limit=limit, offset=offset
    )


def route(db, owner, identifier):
    owned_activity(db, owner, identifier)
    rows = db.execute(
        text("""SELECT s.segment_index,s.point_count,ST_AsGeoJSON(s.geom,15)::json AS geometry,
        (SELECT ST_AsGeoJSON(p.position,15)::json FROM activity_points p WHERE p.segment_id=s.id
         ORDER BY p.point_index LIMIT 1) AS first,
        (SELECT ST_AsGeoJSON(p.position,15)::json FROM activity_points p WHERE p.segment_id=s.id
         ORDER BY p.point_index DESC LIMIT 1) AS last
        FROM activity_segments s JOIN activities a ON a.id=s.activity_id
        WHERE a.id=:id AND a.user_id=:owner ORDER BY s.segment_index"""),
        {"id": identifier, "owner": owner},
    ).all()
    features = []
    for row in rows:
        geometry = row.geometry or row.first
        if isinstance(geometry, str):
            geometry = json.loads(geometry)
        features.append(
            {
                "type": "Feature",
                "geometry": geometry,
                "properties": {"segment_index": row.segment_index, "point_count": row.point_count},
            }
        )
    return {
        "type": "FeatureCollection",
        "features": features,
        "start": rows[0].first["coordinates"] if rows else None,
        "end": rows[-1].last["coordinates"] if rows else None,
    }
