from sqlalchemy import select, update

from app.core.errors import ApiError
from app.core.security import hash_password, verify_password
from app.modules.auth.model import AuthSession
from app.modules.site_settings.images import image_version, normalize_image
from app.modules.users.model import User, UserAvatar
from app.modules.users.schema import UserView


def is_admin(user, settings):
    return user.email_normalized == settings.site_owner_email


def is_enabled(user, settings):
    return is_admin(user, settings) or bool(user.is_active)


def view(user, settings):
    return UserView(
        id=user.id,
        is_admin=is_admin(user, settings),
        showcase_enabled=is_admin(user, settings)
        or (bool(user.is_active) and bool(user.showcase_enabled)),
        email=user.email_normalized,
        username=user.username,
        display_name=user.display_name,
        timezone=user.timezone,
        created_at=user.created_at,
        bio=user.bio,
        profile_is_public=user.profile_is_public,
        avatar_url=(
            f"/api/v1/me/avatar?v={user.avatar_version}"
            if getattr(user, "avatar_version", None)
            else None
        ),
    )


def update_profile(user, payload, settings):
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(user, key, value)
    return view(user, settings)


def change_password(db, user, payload, now):
    if not verify_password(user.password_hash, payload.current_password):
        raise ApiError(401, "INVALID_CREDENTIALS", "邮箱或密码不正确")
    user.password_hash = hash_password(payload.new_password)
    db.execute(
        update(AuthSession)
        .where(AuthSession.user_id == user.id, AuthSession.revoked_at.is_(None))
        .values(revoked_at=now)
    )


def put_avatar(db, user_id, raw):
    processed = normalize_image(raw, "avatar")
    user = db.scalar(select(User).where(User.id == user_id).with_for_update())
    if user is None:
        raise ApiError(401, "AUTH_REQUIRED", "请先登录")
    avatar = db.get(UserAvatar, user_id)
    if avatar is None:
        avatar = UserAvatar(user_id=user_id)
        db.add(avatar)
    avatar.png_bytes, avatar.sha256 = processed.png, processed.sha256
    user.avatar_version = image_version(processed.sha256)
    db.flush()
    return f"/api/v1/me/avatar?v={user.avatar_version}"


def remove_avatar(db, user):
    avatar = db.get(UserAvatar, user.id)
    if avatar is not None:
        db.delete(avatar)
    user.avatar_version = None
    db.flush()


def avatar_bytes(db, user_id):
    data = db.scalar(select(UserAvatar.png_bytes).where(UserAvatar.user_id == user_id))
    if data is None:
        raise ApiError(404, "RESOURCE_NOT_FOUND", "头像不存在")
    return data
