"""Shared fixed-window counters. Commit attempts independently of business rollback."""

import hashlib
import hmac
from datetime import UTC, datetime, timedelta
from ipaddress import ip_address

from sqlalchemy.dialects.postgresql import insert

from app.core.errors import ApiError
from app.modules.auth.model import AuthRateBucket

LIMITS = {
    "login-account": (10, 900),
    "login-ip": (60, 900),
    "register-ip": (10, 3600),
    "csrf-ip": (60, 3600),
}


def subject_hash(secret: str, scope: str, subject: str) -> str:
    return hmac.new(secret.encode(), f"{scope}\0{subject}".encode(), hashlib.sha256).hexdigest()


def client_ip(request) -> str:
    peer = request.client.host if request.client else "unknown"
    trusted = request.app.state.settings.auth_trusted_proxies
    if peer not in trusted:
        return peer
    # Walk right to left; never trust an attacker-prepended address past an untrusted hop.
    chain = request.headers.get("x-forwarded-for", "").split(",")
    current = peer
    for hop in reversed(chain):
        if current not in trusted:
            break
        try:
            current = str(ip_address(hop.strip()))
        except ValueError:
            return peer
    return current


def consume(app, subjects: list[tuple[str, str]], now: datetime) -> None:
    key = app.state.settings.auth_rate_hash_key
    if key is None:
        raise ApiError(503, "AUTH_UNAVAILABLE", "认证配置未就绪")
    retry = 0
    with app.state.session_factory.begin() as db:
        for scope, subject in subjects:
            limit, seconds = LIMITS[scope]
            start = datetime.fromtimestamp(int(now.timestamp()) // seconds * seconds, UTC)
            end = start + timedelta(seconds=seconds)
            statement = (
                insert(AuthRateBucket)
                .values(
                    scope=scope,
                    subject_hash=subject_hash(key.get_secret_value(), scope, subject),
                    window_start=start,
                    expires_at=end,
                    attempts=1,
                )
                .on_conflict_do_update(
                    index_elements=["scope", "subject_hash", "window_start"],
                    set_={"attempts": AuthRateBucket.attempts + 1},
                )
                .returning(AuthRateBucket.attempts)
            )
            attempts = db.scalar(statement)
            if attempts > limit:
                retry = max(retry, max(1, int((end - now).total_seconds()) + 1))
    if retry:
        raise ApiError(429, "AUTH_RATE_LIMITED", "请求过于频繁", retry_after=retry)
