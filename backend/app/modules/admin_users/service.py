from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError

from app.core.errors import ApiError
from app.core.security import hash_password
from app.modules.admin_users.schema import AdminUser, AdminUserList
from app.modules.auth.model import AuthSession
from app.modules.users.model import User
from app.modules.users.service import is_admin, is_enabled, view


def admin_view(user, settings):
    return AdminUser(**view(user, settings).model_dump(), is_active=is_enabled(user, settings))


def listing(db, settings, search, is_active, limit, offset):
    filters = []
    if search:
        # Literal substring matching: do not interpret user-supplied SQL wildcards.
        term = search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        filters.append(
            or_(
                User.email_normalized.ilike(f"%{term}%", escape="\\"),
                User.username.ilike(f"%{term}%", escape="\\"),
            )
        )
    enabled = or_(User.email_normalized == settings.site_owner_email, User.is_active.is_(True))
    if is_active is not None:
        filters.append(enabled if is_active else ~enabled)
    rows = db.scalars(
        select(User)
        .where(*filters)
        .order_by(User.created_at.desc(), User.id)
        .limit(limit)
        .offset(offset)
    ).all()
    return AdminUserList(
        items=[admin_view(row, settings) for row in rows],
        total=db.scalar(select(func.count()).select_from(User).where(*filters)),
        limit=limit,
        offset=offset,
    )


def flush_user(db):
    try:
        db.flush()
    except IntegrityError as error:
        constraint = getattr(getattr(error.orig, "diag", None), "constraint_name", "")
        db.rollback()
        if constraint == "uq_users_email_normalized":
            raise ApiError(409, "EMAIL_EXISTS", "邮箱已被使用") from None
        if constraint == "uq_users_username":
            raise ApiError(409, "USERNAME_EXISTS", "用户名已被使用") from None
        raise


def create(db, payload, settings):
    if payload.email == settings.site_owner_email:
        raise ApiError(409, "OWNER_PROTECTED", "站主账号请使用离线初始化流程")
    user = User(
        email_normalized=payload.email,
        username=payload.username,
        password_hash=hash_password(payload.password),
        display_name=payload.display_name,
        timezone=payload.timezone,
        is_active=payload.is_active,
        showcase_enabled=payload.is_active and payload.showcase_enabled,
        profile_is_public=False,
        bio="",
        activity_data_version=0,
    )
    db.add(user)
    flush_user(db)
    return admin_view(user, settings)


def locked_user(db, identifier):
    user = db.scalar(select(User).where(User.id == identifier).with_for_update())
    if user is None:
        raise ApiError(404, "RESOURCE_NOT_FOUND", "账号不存在")
    return user


def revoke_sessions(db, user, now):
    db.execute(
        update(AuthSession)
        .where(AuthSession.user_id == user.id, AuthSession.revoked_at.is_(None))
        .values(revoked_at=now)
    )


def patch(db, identifier, payload, settings, now):
    user = locked_user(db, identifier)
    changes = payload.model_dump(exclude_unset=True)
    if is_admin(user, settings) and set(changes) & {"email", "is_active", "showcase_enabled"}:
        raise ApiError(409, "OWNER_PROTECTED", "不能修改站主邮箱、启用状态或展示开关")
    if changes.get("email") == settings.site_owner_email:
        raise ApiError(409, "OWNER_PROTECTED", "不能将普通账号变为站主")
    revoke = ("email" in changes and changes["email"] != user.email_normalized) or changes.get(
        "is_active"
    ) is False
    for key, value in changes.items():
        setattr(user, "email_normalized" if key == "email" else key, value)
    if not is_enabled(user, settings):
        user.showcase_enabled = False
    user.activity_data_version += 1
    if revoke:
        revoke_sessions(db, user, now)
    flush_user(db)
    return admin_view(user, settings)


def reset_password(db, identifier, payload, settings, now):
    user = locked_user(db, identifier)
    if is_admin(user, settings):
        raise ApiError(409, "OWNER_PROTECTED", "站主请通过本人修改密码流程操作")
    user.password_hash = hash_password(payload.new_password)
    user.activity_data_version += 1
    revoke_sessions(db, user, now)
    db.flush()
    return {"password_reset": True}


def delete_many(db, identifiers, settings):
    # Fixed lock order avoids deadlocks with concurrent imports and edits.
    users = db.scalars(
        select(User).where(User.id.in_(identifiers)).order_by(User.id).with_for_update()
    ).all()
    if any(is_admin(user, settings) for user in users):
        raise ApiError(409, "OWNER_PROTECTED", "不能删除站主账号")
    if users:
        # Database ON DELETE CASCADE removes records, raw files, reports, goals and sessions.
        db.execute(delete(User).where(User.id.in_([user.id for user in users])))
    db.flush()
    return {"deleted": True, "deleted_count": len(users)}
