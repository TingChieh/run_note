"""Authentication primitives. UTC timestamps, opaque tokens, exact same-origin writes."""

import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta
from urllib.parse import urlsplit

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

from app.core.errors import ApiError

PASSWORD_HASHER = PasswordHasher(
    memory_cost=19456, time_cost=2, parallelism=1, salt_len=16, hash_len=32
)
_DUMMY_HASH = PASSWORD_HASHER.hash(secrets.token_urlsafe(32))


def utc_now() -> datetime:
    return datetime.now(UTC)


def hash_password(password: str) -> str:
    if not 12 <= len(password) <= 128:
        raise ValueError("Password must contain 12–128 characters")
    return PASSWORD_HASHER.hash(password)


def verify_password(encoded: str | None, password: str) -> bool:
    try:
        valid = PASSWORD_HASHER.verify(encoded or _DUMMY_HASH, password)
    except (VerificationError, InvalidHashError):
        return False
    return bool(encoded and valid)


def new_token() -> str:
    return secrets.token_urlsafe(32)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def session_valid(row, now: datetime) -> bool:
    return bool(
        row
        and row.revoked_at is None
        and now < row.expires_at
        and (row.user_id is None or now < row.last_seen_at + timedelta(hours=24))
    )


def check_source(headers, site_origin: str) -> None:
    origin = headers.get("origin")
    if origin is not None:
        valid = origin == site_origin
    else:
        try:
            referer = urlsplit(headers.get("referer", ""))
            valid = (
                not referer.username
                and not referer.password
                and f"{referer.scheme}://{referer.netloc}" == site_origin
            )
        except ValueError:
            valid = False
    if not valid:
        raise ApiError(403, "CSRF_FAILED", "请求来源或CSRF令牌不合法")


def check_csrf(headers, site_origin: str, row) -> None:
    check_source(headers, site_origin)
    supplied = headers.get("x-csrf-token", "")
    if not row or not hmac.compare_digest(supplied.encode(), row.csrf_token.encode()):
        raise ApiError(403, "CSRF_FAILED", "请求来源或CSRF令牌不合法")
