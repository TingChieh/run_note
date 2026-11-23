import base64
import json
from calendar import monthrange
from datetime import date, datetime
from itertools import groupby
from uuid import UUID

from sqlalchemy import and_, func, or_, select, text, update

from app.core.errors import ApiError
from app.modules.activities.model import Activity
from app.modules.activities.schema import (
    ActivityList,
    ActivitySyncItem,
    ActivitySyncView,
    ActivityView,
)
from app.modules.gpx.model import ActivitySegment
from app.modules.gpx.queries import replay_points
from app.modules.gpx.replay import ReplayPoint, build_replay
from app.modules.sharing.model import ActivityShareLink
from app.modules.users.model import User

MAX_SYNC_ACTIVE_IDS = 5000


def view(activity, has_route=True):
    fields = {
        name: getattr(activity, name) for name in ActivityView.model_fields if name != "has_route"
    }
    return ActivityView(**fields, has_route=has_route)


def sync_item_view(activity, has_route=True):
    fields = {
        name: getattr(activity, name)
        for name in ActivitySyncItem.model_fields
        if name != "has_route"
    }
    return ActivitySyncItem(**fields, has_route=has_route)


def encode_sync_cursor(updated_at: datetime, activity_id: UUID) -> str:
    raw = f"{updated_at.isoformat()}|{activity_id}".encode()
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def decode_sync_cursor(raw: str) -> tuple[datetime, UUID]:
    if not raw or len(raw) > 128:
        raise ApiError(422, "VALIDATION_ERROR", "同步游标无效")
    try:
        padded = raw + "=" * (-len(raw) % 4)
        decoded = base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8")
        ts_part, sep, id_part = decoded.partition("|")
        if not sep or "|" in id_part:
            raise ValueError("malformed cursor")
        parsed_ts = datetime.fromisoformat(ts_part)
        if parsed_ts.tzinfo is None:
            raise ValueError("naive timestamp")
        parsed_id = UUID(id_part)
    except ValueError:
        raise ApiError(422, "VALIDATION_ERROR", "同步游标无效") from None
    return parsed_ts, parsed_id


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
    activity.updated_at = now
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


def sync_activities(
    db,
    owner: UUID,
    now: datetime,
    *,
    limit: int = 50,
    since_version: int | None = None,
    updated_since: datetime | None = None,
    cursor: str | None = None,
) -> ActivitySyncView:
    if updated_since is not None and updated_since.tzinfo is None:
        raise ApiError(422, "VALIDATION_ERROR", "同步时间必须包含时区")
    cursor_pair = decode_sync_cursor(cursor) if cursor is not None else None
    data_version = db.scalar(
        select(User.activity_data_version)
        .where(User.id == owner)
        .execution_options(populate_existing=True)
    )
    if data_version is None:
        raise ApiError(401, "AUTH_REQUIRED", "请先登录")
    total_count = int(
        db.scalar(select(func.count()).select_from(Activity).where(Activity.user_id == owner)) or 0
    )
    if since_version is not None and since_version == data_version and cursor_pair is None:
        return ActivitySyncView(
            data_version=int(data_version),
            unchanged=True,
            server_time=now,
            total_count=total_count,
            items=[],
            next_cursor=None,
            has_more=False,
            active_ids=None,
            full_resync_required=False,
        )

    filters = [Activity.user_id == owner]
    if updated_since is not None:
        filters.append(Activity.updated_at >= updated_since)
    if cursor_pair is not None:
        cursor_ts, cursor_id = cursor_pair
        filters.append(
            or_(
                Activity.updated_at > cursor_ts,
                and_(Activity.updated_at == cursor_ts, Activity.id > cursor_id),
            )
        )

    rows = db.scalars(
        select(Activity)
        .where(*filters)
        .order_by(Activity.updated_at.asc(), Activity.id.asc())
        .limit(limit + 1)
    ).all()
    has_more = len(rows) > limit
    page_rows = rows[:limit]
    ids = [row.id for row in page_rows]
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
    next_cursor = (
        encode_sync_cursor(page_rows[-1].updated_at, page_rows[-1].id)
        if has_more and page_rows
        else None
    )

    active_ids: list[UUID] | None = None
    full_resync_required = False
    if since_version is not None and cursor_pair is None:
        if total_count <= MAX_SYNC_ACTIVE_IDS:
            active_ids = list(
                db.scalars(
                    select(Activity.id)
                    .where(Activity.user_id == owner)
                    .order_by(Activity.activity_date.desc(), Activity.id.desc())
                ).all()
            )
        else:
            full_resync_required = True

    server_time = now
    if page_rows:
        latest_item_ts = max(row.updated_at for row in page_rows)
        if latest_item_ts > server_time:
            server_time = latest_item_ts

    return ActivitySyncView(
        data_version=int(data_version),
        unchanged=False,
        server_time=server_time,
        total_count=total_count,
        items=[sync_item_view(row, row.id in routed) for row in page_rows],
        next_cursor=next_cursor,
        has_more=has_more,
        active_ids=active_ids,
        full_resync_required=full_resync_required,
    )


def route(db, owner, identifier):
    owned_activity(db, owner, identifier)
    # 7 decimals is ~1 cm: display-only, and far shorter than full double precision.
    rows = db.execute(
        text("""SELECT s.segment_index,s.point_count,ST_AsGeoJSON(s.geom,7)::json AS geometry,
        (SELECT ST_AsGeoJSON(p.position,7)::json FROM activity_points p WHERE p.segment_id=s.id
         ORDER BY p.point_index LIMIT 1) AS first,
        (SELECT ST_AsGeoJSON(p.position,7)::json FROM activity_points p WHERE p.segment_id=s.id
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


def replay(db, owner, identifier):
    activity = owned_activity(db, owner, identifier)
    rows = replay_points(db, owner, identifier)
    if not rows:
        raise ApiError(404, "REPLAY_UNAVAILABLE", "此活动没有可回放的轨迹")
    segments = [
        (index, [ReplayPoint(r.lon, r.lat, r.recorded_at, r.edge_m) for r in group])
        for index, group in groupby(rows, key=lambda r: r.segment_index)
    ]
    pace = activity.avg_pace_seconds_per_km
    return build_replay(segments, float(pace) if pace else None)


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
