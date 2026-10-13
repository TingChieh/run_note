import re
import secrets
from datetime import timedelta

from sqlalchemy import func, select, update

from app.core.errors import ApiError
from app.core.security import token_hash
from app.modules.activities.model import Activity
from app.modules.activities.service import detail, owned_activity
from app.modules.sharing.model import ActivityShareLink as Link
from app.modules.sharing.schema import (
    PublicActivity,
    PublicActivityList,
    PublicAuthor,
    PublicProfile,
)
from app.modules.statistics import service as statistics
from app.modules.users.model import User


def missing():
    raise ApiError(404, "RESOURCE_NOT_FOUND", "页面不存在或已停止分享")


def profile_user(db, username):
    user = db.scalar(
        select(User).where(User.username == username, User.profile_is_public.is_(True))
    )
    if user is None:
        missing()
    return user


def profile(db, username):
    user = profile_user(db, username)
    return PublicProfile(
        username=user.username,
        display_name=user.display_name,
        bio=user.bio,
        summary=statistics.summary(db, user.id, public_only=True),
    )


def public_view(db, activity):
    user = db.get(User, activity.user_id)
    return PublicActivity(
        **{
            key: getattr(activity, key)
            for key in (
                "id",
                "title",
                "activity_date",
                "distance_m",
                "elapsed_seconds",
                "avg_pace_seconds_per_km",
            )
        },
        author=PublicAuthor(username=user.username, display_name=user.display_name),
    )


def public_activity(db, identifier):
    activity = db.scalar(
        select(Activity).where(Activity.id == identifier, Activity.visibility == "public")
    )
    if activity is None:
        missing()
    return public_view(db, activity)


def public_listing(db, username, limit, offset, day):
    user = profile_user(db, username)
    filters = [Activity.user_id == user.id, Activity.visibility == "public"]
    if day is not None:
        filters.append(Activity.activity_date == day)
    rows = db.scalars(
        select(Activity)
        .where(*filters)
        .order_by(Activity.activity_date.desc(), Activity.id.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    return PublicActivityList(
        items=[public_view(db, a) for a in rows],
        total=db.scalar(select(func.count()).select_from(Activity).where(*filters)),
        limit=limit,
        offset=offset,
    )


def lock_owner(db, owner):
    return db.scalar(
        select(User)
        .where(User.id == owner)
        .with_for_update()
        .execution_options(populate_existing=True)
    )


def visibility(db, owner, identifier, value, now):
    user = lock_owner(db, owner)
    activity = owned_activity(db, owner, identifier)
    activity.visibility = value
    # This release shares only summaries, never coordinates.
    activity.allow_shared_route = False
    if value == "private":
        db.execute(
            update(Link)
            .where(Link.activity_id == identifier, Link.revoked_at.is_(None))
            .values(revoked_at=now)
        )
    user.activity_data_version += 1
    db.flush()
    return detail(db, owner, identifier)


def create_link(db, owner, identifier, payload, now, origin):
    lock_owner(db, owner)
    activity = owned_activity(db, owner, identifier)
    if activity.visibility == "private":
        raise ApiError(409, "ACTIVITY_PRIVATE", "请先选择仅链接可见或公开，再创建分享链接")
    expiry = (
        payload.expires_at if "expires_at" in payload.model_fields_set else now + timedelta(days=30)
    )
    if expiry is not None and (
        expiry.tzinfo is None or not now < expiry <= now + timedelta(days=365)
    ):
        raise ApiError(422, "VALIDATION_ERROR", "到期时间须在未来365天内，并包含时区")
    active = db.scalar(
        select(func.count())
        .select_from(Link)
        .where(
            Link.activity_id == identifier,
            Link.revoked_at.is_(None),
            (Link.expires_at.is_(None)) | (Link.expires_at > now),
        )
    )
    if active >= 20:
        raise ApiError(409, "SHARE_LIMIT", "最多保留20条有效链接，请先撤销旧链接")
    token = secrets.token_urlsafe(32)
    link = Link(
        activity_id=identifier, token_hash=token_hash(token), created_at=now, expires_at=expiry
    )
    db.add(link)
    db.flush()
    return {"link_id": link.id, "share_url": f"{origin}/shared/{token}", "expires_at": expiry}


def links(db, owner, identifier, now):
    owned_activity(db, owner, identifier)
    rows = db.scalars(
        select(Link).where(Link.activity_id == identifier).order_by(Link.created_at.desc())
    ).all()
    return {
        "items": [
            {
                "link_id": link.id,
                "created_at": link.created_at,
                "expires_at": link.expires_at,
                "revoked_at": link.revoked_at,
                "status": "revoked"
                if link.revoked_at
                else "expired"
                if link.expires_at and link.expires_at <= now
                else "active",
            }
            for link in rows
        ]
    }


def revoke(db, owner, identifier, link_id, now):
    lock_owner(db, owner)
    owned_activity(db, owner, identifier)
    link = db.scalar(select(Link).where(Link.id == link_id, Link.activity_id == identifier))
    if link is None:
        missing()
    if link.revoked_at is None:
        link.revoked_at = now
    return {"revoked": True}


def shared(db, token, now):
    if not re.fullmatch(r"[A-Za-z0-9_-]{43}", token):
        missing()
    activity = db.scalar(
        select(Activity)
        .join(Link, Link.activity_id == Activity.id)
        .where(
            Link.token_hash == token_hash(token),
            Link.revoked_at.is_(None),
            (Link.expires_at.is_(None)) | (Link.expires_at > now),
            Activity.visibility.in_(["public", "unlisted"]),
        )
    )
    if activity is None:
        missing()
    return public_view(db, activity)
