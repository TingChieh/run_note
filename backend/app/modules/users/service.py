from sqlalchemy import update

from app.core.errors import ApiError
from app.core.security import hash_password, verify_password
from app.modules.auth.model import AuthSession
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
