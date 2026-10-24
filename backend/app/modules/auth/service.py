from datetime import timedelta

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from app.core.errors import ApiError
from app.core.security import (
    PASSWORD_HASHER,
    hash_password,
    new_token,
    session_valid,
    token_hash,
    verify_password,
)
from app.modules.auth.model import AuthSession
from app.modules.users.model import User


def cookie_name(settings):
    return "__Host-run_session" if settings.app_env == "production" else "run_session"


def set_cookie(response, settings, token=None, anonymous=False):
    options = dict(
        key=cookie_name(settings),
        httponly=True,
        samesite="lax",
        path="/",
        secure=settings.app_env == "production",
    )
    if token is None:
        response.delete_cookie(**options)
    else:
        response.set_cookie(value=token, max_age=600 if anonymous else 604800, **options)


def find_session(db, request, now):
    token = request.cookies.get(cookie_name(request.app.state.settings))
    if not token or len(token) > 128:
        return None
    row = db.scalar(select(AuthSession).where(AuthSession.token_hash == token_hash(token)))
    return row if session_valid(row, now) else None


def require_identity(db, request, now, shared=False):
    row = find_session(db, request, now)
    if row is None or row.user_id is None:
        raise ApiError(401, "AUTH_REQUIRED", "请先登录")
    # Serialize user mutations with login/password changes across workers. Refresh the
    # session after acquiring the user lock so a concurrent revocation cannot be missed.
    # `shared` takes FOR SHARE: still excluded by every writer (FOR UPDATE), but concurrent
    # readers of the same user no longer queue behind each other's slow queries.
    query = select(User).where(User.id == row.user_id)
    user = db.scalar(query.with_for_update(read=shared))
    if user is None:
        raise ApiError(401, "AUTH_REQUIRED", "请先登录")
    db.refresh(row)
    if (
        user is None
        or not session_valid(row, now)
        or not (
            user.email_normalized == request.app.state.settings.site_owner_email or user.is_active
        )
    ):
        raise ApiError(401, "AUTH_REQUIRED", "请先登录")
    if now >= row.last_seen_at + timedelta(minutes=5):
        row.last_seen_at = now
    return row, user


def rotate(db, old, user, now):
    if old is not None:
        consumed = db.scalar(
            update(AuthSession)
            .where(AuthSession.id == old.id, AuthSession.revoked_at.is_(None))
            .values(revoked_at=now)
            .returning(AuthSession.id)
        )
        if consumed is None:
            raise ApiError(403, "CSRF_FAILED", "请求来源或CSRF令牌不合法")
    token = new_token()
    row = AuthSession(
        user_id=user.id if user else None,
        token_hash=token_hash(token),
        csrf_token=new_token(),
        created_at=now,
        last_seen_at=now,
        expires_at=now + (timedelta(days=7) if user else timedelta(minutes=10)),
    )
    db.add(row)
    db.flush()
    return row, token


def register(db, old, payload, now):
    user = User(
        email_normalized=payload.email,
        username=payload.username,
        password_hash=hash_password(payload.password),
        display_name=payload.username,
        timezone=payload.timezone,
        profile_is_public=False,
        activity_data_version=0,
    )
    db.add(user)
    try:
        db.flush()
    except IntegrityError as error:
        constraint = getattr(getattr(error.orig, "diag", None), "constraint_name", "")
        db.rollback()
        if constraint == "uq_users_email_normalized":
            raise ApiError(409, "EMAIL_EXISTS", "邮箱已被注册") from None
        if constraint == "uq_users_username":
            raise ApiError(409, "USERNAME_EXISTS", "用户名已被注册") from None
        raise
    row, token = rotate(db, old, user, now)
    return user, row, token


def login(db, old, payload, now, owner_email=None):
    user = db.scalar(select(User).where(User.email_normalized == payload.email).with_for_update())
    if not verify_password(user.password_hash if user else None, payload.password):
        raise ApiError(401, "INVALID_CREDENTIALS", "邮箱或密码不正确")
    if not (user.email_normalized == owner_email or user.is_active):
        raise ApiError(401, "INVALID_CREDENTIALS", "邮箱或密码不正确")
    if PASSWORD_HASHER.check_needs_rehash(user.password_hash):
        user.password_hash = hash_password(payload.password)
    row, token = rotate(db, old, user, now)
    return user, row, token
