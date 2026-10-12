from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest


def test_argon2_salts_and_dummy_verification():
    from app.core.security import hash_password, verify_password

    a, b = hash_password(" a long password "), hash_password(" a long password ")
    assert a != b
    assert a.startswith("$argon2id$v=19$m=19456,t=2,p=1$")
    assert verify_password(a, " a long password ")
    assert not verify_password(a, "a long password")
    assert not verify_password(None, " a long password ")


@pytest.mark.parametrize("size", [0, 11, 129])
def test_password_bounds(size):
    from app.core.security import hash_password

    with pytest.raises(ValueError):
        hash_password("x" * size)


@pytest.mark.parametrize("size", [12, 128])
def test_password_valid_bounds(size):
    from app.core.security import hash_password, verify_password

    assert verify_password(hash_password("x" * size), "x" * size)


def test_token_hash_and_randomness():
    from app.core.security import new_token, token_hash

    a, b = new_token(), new_token()
    assert a != b and len(a) >= 43
    assert len(token_hash(a)) == 64 and token_hash(a) != a
    assert token_hash(a) == token_hash(a)


@pytest.mark.parametrize("kind", ["absolute", "idle", "revoked", "anonymous"])
def test_session_expiry_boundaries(kind):
    from app.core.security import session_valid

    now = datetime(2026, 10, 12, tzinfo=UTC)
    row = SimpleNamespace(
        user_id=1, expires_at=now + timedelta(days=1), last_seen_at=now, revoked_at=None
    )
    assert session_valid(row, now)
    if kind == "absolute":
        row.expires_at = now
    elif kind == "idle":
        row.last_seen_at = now - timedelta(hours=24)
    elif kind == "revoked":
        row.revoked_at = now
    else:
        row.user_id = None
        row.last_seen_at = now - timedelta(minutes=10)
        row.expires_at = now
    assert not session_valid(row, now)


@pytest.mark.parametrize(
    "headers,valid",
    [
        ({"origin": "http://localhost:5173"}, True),
        ({"referer": "http://localhost:5173/settings?x=1"}, True),
        ({}, False),
        ({"origin": "null"}, False),
        ({"origin": "http://localhost:5173.evil"}, False),
        ({"origin": "http://evil", "referer": "http://localhost:5173/"}, False),
        ({"origin": "http://localhost:5173/"}, False),
    ],
)
def test_source_check(headers, valid):
    from app.core.errors import ApiError
    from app.core.security import check_source

    if valid:
        check_source(headers, "http://localhost:5173")
    else:
        with pytest.raises(ApiError) as e:
            check_source(headers, "http://localhost:5173")
        assert e.value.status_code == 403


def test_rate_subject_scope_and_secret():
    from app.modules.auth.rate_limit import subject_hash

    a = subject_hash("a" * 32, "login-account", "test@example.com")
    assert len(a) == 64
    assert a != subject_hash("b" * 32, "login-account", "test@example.com")
    assert a != subject_hash("a" * 32, "login-ip", "test@example.com")


def test_missing_auth_key_fails_closed_without_database():
    from fastapi.testclient import TestClient

    from app.core.config import Settings
    from app.main import create_app

    settings = Settings(
        database_url="postgresql+psycopg://u:p@127.0.0.1/unused", app_env="test", _env_file=None
    )
    with TestClient(create_app(settings)) as client:
        assert client.get("/api/v1/health/live").status_code == 200
        r = client.get("/api/v1/auth/csrf")
        assert r.status_code == 503 and r.json()["error"]["code"] == "AUTH_UNAVAILABLE"


@pytest.mark.parametrize("value", ["short", ""])
def test_weak_hmac_key_rejected(value):
    from pydantic import ValidationError

    from app.core.config import Settings

    with pytest.raises(ValidationError):
        Settings(
            database_url="postgresql+psycopg://u:p@127.0.0.1/x",
            auth_rate_hash_key=value,
            _env_file=None,
        )


def test_unknown_user_performs_real_dummy_verify(monkeypatch):
    from app.core import security

    seen = []
    real = security.PASSWORD_HASHER

    class Verifier:
        def verify(self, encoded, password):
            seen.append(encoded)
            return real.verify(encoded, password)

    monkeypatch.setattr(security, "PASSWORD_HASHER", Verifier())
    assert not security.verify_password(None, "wrong password")
    assert len(seen) == 1 and seen[0].startswith("$argon2id$")


@pytest.mark.parametrize(
    "peer,forwarded,trusted,expected",
    [
        ("192.0.2.10", "1.2.3.4", (), "192.0.2.10"),
        ("127.0.0.1", "1.2.3.4", ("127.0.0.1",), "1.2.3.4"),
        ("127.0.0.1", "1.2.3.4, 192.0.2.10", ("127.0.0.1",), "192.0.2.10"),
        ("127.0.0.1", "invalid", ("127.0.0.1",), "127.0.0.1"),
    ],
)
def test_proxy_trust_boundary(peer, forwarded, trusted, expected):
    from app.modules.auth.rate_limit import client_ip

    request = SimpleNamespace(
        client=SimpleNamespace(host=peer),
        headers={"x-forwarded-for": forwarded},
        app=SimpleNamespace(
            state=SimpleNamespace(settings=SimpleNamespace(auth_trusted_proxies=trusted))
        ),
    )
    assert client_ip(request) == expected


def test_production_cookie_attributes():
    from starlette.responses import Response

    from app.modules.auth.service import set_cookie

    settings = SimpleNamespace(app_env="production")
    response = Response()
    set_cookie(response, settings, "secret")
    header = response.headers["set-cookie"]
    for expected in [
        "__Host-run_session=",
        "HttpOnly",
        "Secure",
        "SameSite=lax",
        "Path=/",
        "Max-Age=604800",
    ]:
        assert expected in header
    assert "Domain=" not in header
    response = Response()
    set_cookie(response, settings)
    assert "Max-Age=0" in response.headers["set-cookie"]
    assert "__Host-run_session=" in response.headers["set-cookie"]
