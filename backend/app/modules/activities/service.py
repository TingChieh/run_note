import json
from calendar import monthrange
from datetime import date
from uuid import UUID

from sqlalchemy import func, select, text, update

from app.core.errors import ApiError
from app.modules.activities.model import Activity
from app.modules.activities.schema import ActivityList, ActivityView
from app.modules.gpx.model import ActivitySegment
from app.modules.sharing.model import ActivityShareLink
from app.modules.users.model import User


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


def lock_owner(db, owner):
    return db.scalar(
        select(User)
        .where(User.id == owner)
        .with_for_update()
        .execution_options(populate_existing=True)
    )


def update_activity(db, owner, identifier, payload, now):
    user = lock_owner(db, owner)
    activity = owned_activity(db, owner, identifier)
    for name, value in payload.model_dump(exclude_unset=True).items():
        setattr(activity, name, value)
    if "visibility" in payload.model_fields_set:
        # Sharing remains summary-only; private transitions revoke old links atomically.
        activity.allow_shared_route = False
        if activity.visibility == "private":
            db.execute(
                update(ActivityShareLink)
                .where(
                    ActivityShareLink.activity_id == identifier,
                    ActivityShareLink.revoked_at.is_(None),
                )
                .values(revoked_at=now)
            )
    user.activity_data_version += 1
    db.flush()
    return detail(db, owner, identifier)


def delete_activity(db, owner, identifier):
    user = lock_owner(db, owner)
    activity = owned_activity(db, owner, identifier)
    db.delete(activity)
    user.activity_data_version += 1
    db.flush()
    return {"deleted": True}


def detail(db, owner, identifier):
    activity = owned_activity(db, owner, identifier)
    exists = db.scalar(
        select(ActivitySegment.id).where(ActivitySegment.activity_id == identifier).limit(1)
    )
    return view(activity, exists is not None)


def categories(db, owner):
    return list(
        db.scalars(
            select(Activity.category)
            .where(Activity.user_id == owner)
            .distinct()
            .order_by(Activity.category)
        )
    )


def listing(db, owner, limit, offset, activity_date=None, category=None, activity_month=None):
    filters = [Activity.user_id == owner]
    if activity_date is not None:
        filters.append(Activity.activity_date == activity_date)
    if category is not None:
        filters.append(Activity.category == category)
    if activity_month is not None:
        year, month = map(int, activity_month.split("-"))
        filters.extend(
            [
                Activity.activity_date >= date(year, month, 1),
                Activity.activity_date <= date(year, month, monthrange(year, month)[1]),
            ]
        )
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


def delete_activities(db, owner, identifiers):
    user = lock_owner(db, owner)
    activities = db.scalars(
        select(Activity).where(Activity.id.in_(identifiers), Activity.user_id == owner)
    ).all()
    if len(activities) != len(identifiers):
        raise ApiError(404, "RESOURCE_NOT_FOUND", "部分记录不存在，请刷新后重试")
    for activity in activities:
        db.delete(activity)
    user.activity_data_version += 1
    db.flush()
    return {"deleted": True, "deleted_count": len(activities)}
