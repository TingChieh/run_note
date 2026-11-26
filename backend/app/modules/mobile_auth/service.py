from dataclasses import dataclass
from datetime import datetime, timedelta
from uuid import uuid4

from sqlalchemy import select, update

from app.core.errors import ApiError
from app.core.security import (
    PASSWORD_HASHER,
    hash_password,
    new_token,
    token_hash,
    verify_password,
)
from app.modules.auth.model import MobileSession
from app.modules.mobile_auth.schema import ClientCapabilitiesView
from app.modules.users.model import User
from app.modules.version.service import app_version

MOBILE_API_VERSION = 1
MIN_MOBILE_APP_VERSION = "2.6.0"
MOBILE_ACCESS_TTL = timedelta(minutes=30)
MOBILE_REFRESH_TTL = timedelta(days=90)
CAPABILITY_FEATURES = (
    "mobile_auth_v1",
    "activities_sync_v1",
    "gpx_idempotency_v1",
)


@dataclass(frozen=True)
class IssuedMobileSession:
    user: User
    row: MobileSession
    access_token: str
    refresh_token: str


@dataclass(frozen=True)
class RefreshResult:
    issued: IssuedMobileSession | None
    replay_detected: bool = False


def capabilities() -> ClientCapabilitiesView:
    return ClientCapabilitiesView(
        server_version=app_version(),
        mobile_api_version=MOBILE_API_VERSION,
        min_mobile_app_version=MIN_MOBILE_APP_VERSION,
        features=list(CAPABILITY_FEATURES),
    )


def _issue_session(
    db,
    user: User,
    now: datetime,
    *,
    token_family_id,
    device_label: str,
    client_version: str,
) -> IssuedMobileSession:
    access_token = new_token()
    refresh_token = new_token()
    row = MobileSession(
        user_id=user.id,
        token_family_id=token_family_id,
        access_token_hash=token_hash(access_token),
        refresh_token_hash=token_hash(refresh_token),
        device_label=device_label,
        client_version=client_version,
        created_at=now,
        last_used_at=now,
        access_expires_at=now + MOBILE_ACCESS_TTL,
        refresh_expires_at=now + MOBILE_REFRESH_TTL,
    )
    db.add(row)
    db.flush()
    return IssuedMobileSession(
        user=user, row=row, access_token=access_token, refresh_token=refresh_token
    )


def login_mobile(db, payload, now: datetime, owner_email: str | None) -> IssuedMobileSession:
    user = db.scalar(select(User).where(User.email_normalized == payload.email).with_for_update())
    if not verify_password(user.password_hash if user else None, payload.password):
        raise ApiError(401, "INVALID_CREDENTIALS", "邮箱或密码不正确")
    if not (user.email_normalized == owner_email or user.is_active):
        raise ApiError(401, "INVALID_CREDENTIALS", "邮箱或密码不正确")
    if PASSWORD_HASHER.check_needs_rehash(user.password_hash):
        user.password_hash = hash_password(payload.password)
    return _issue_session(
        db,
        user,
        now,
        token_family_id=uuid4(),
        device_label=payload.device_label,
        client_version=payload.client_version,
    )


def revoke_token_family(db, token_family_id, now: datetime) -> None:
    db.execute(
        update(MobileSession)
        .where(MobileSession.token_family_id == token_family_id, MobileSession.revoked_at.is_(None))
        .values(revoked_at=now)
    )
    db.flush()


def refresh_mobile(db, payload, now: datetime, owner_email: str | None) -> RefreshResult:
    hashed = token_hash(payload.refresh_token)
    row = db.scalar(select(MobileSession).where(MobileSession.refresh_token_hash == hashed))
    if row is None:
        raise ApiError(401, "INVALID_REFRESH_TOKEN", "登录已过期，请重新登录")

    user = db.scalar(select(User).where(User.id == row.user_id).with_for_update())
    if user is None:
        raise ApiError(401, "INVALID_REFRESH_TOKEN", "登录已过期，请重新登录")

    db.refresh(row)
    if row.rotated_at is not None:
        # Refresh token replay: immediately revoke the entire token family.
        revoke_token_family(db, row.token_family_id, now)
        return RefreshResult(issued=None, replay_detected=True)

    if row.revoked_at is not None or now >= row.refresh_expires_at:
        raise ApiError(401, "INVALID_REFRESH_TOKEN", "登录已过期，请重新登录")

    if not (user.email_normalized == owner_email or user.is_active):
        raise ApiError(401, "INVALID_REFRESH_TOKEN", "登录已过期，请重新登录")

    consumed = db.scalar(
        update(MobileSession)
        .where(
            MobileSession.id == row.id,
            MobileSession.rotated_at.is_(None),
            MobileSession.revoked_at.is_(None),
            MobileSession.refresh_expires_at > now,
        )
        .values(rotated_at=now, revoked_at=now)
        .returning(MobileSession.id)
    )
    if consumed is None:
        revoke_token_family(db, row.token_family_id, now)
        return RefreshResult(issued=None, replay_detected=True)

    next_client_version = (
        payload.client_version if payload.client_version is not None else row.client_version
    )
    issued = _issue_session(
        db,
        user,
        now,
        token_family_id=row.token_family_id,
        device_label=row.device_label,
        client_version=next_client_version,
    )
    return RefreshResult(issued=issued, replay_detected=False)


def logout_mobile(
    db, session_row: MobileSession, user: User, now: datetime, *, revoke_all_devices: bool
) -> None:
    if revoke_all_devices:
        db.execute(
            update(MobileSession)
            .where(MobileSession.user_id == user.id, MobileSession.revoked_at.is_(None))
            .values(revoked_at=now)
        )
    else:
        revoke_token_family(db, session_row.token_family_id, now)
    db.flush()
