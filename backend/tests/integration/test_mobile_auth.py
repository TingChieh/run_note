"""Real PostgreSQL integration tests for mobile Bearer auth, rotation, replay, and revocation."""

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import hash_password, token_hash
from app.modules.auth.model import MobileSession
from app.modules.users.model import User
from tests.conftest import FIXTURES, headers, register, upload
from tests.integration.test_migrations import assert_downgrade_guard

pytestmark = pytest.mark.integration
PASSWORD = "Mobile-synthetic-password-2026"


def _create_user(client, *, is_active: bool = True, as_owner: bool = False):
    unique = uuid4().hex[:20]
    email = f"{unique}@example.com"
    if as_owner:
        client.app.state.settings.site_owner_email = email
    with client.app.state.session_factory() as db:
        user = User(
            email_normalized=email,
            username=f"m_{unique}",
            display_name="Mobile Runner",
            password_hash=hash_password(PASSWORD),
            is_active=is_active,
            timezone="Asia/Shanghai",
        )
        db.add(user)
        db.commit()
        user_id = str(user.id)
    return {"id": user_id, "email": email, "password": PASSWORD}


def _mobile_login(client, email, password, *, device_label="Android Test", client_version="2.6.0"):
    return client.post(
        "/api/v1/mobile/auth/login",
        json={
            "email": email,
            "password": password,
            "device_label": device_label,
            "client_version": client_version,
        },
    )


def _bearer(access_token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {access_token}"}


def test_mobile_login_token_hashing_ttls_and_bearer_access(clients):
    a, b, engine, app = clients
    base = datetime(2026, 11, 26, 10, 0, tzinfo=UTC)
    app.state.clock = lambda: base
    account = _create_user(a, is_active=True)

    # Inactive user cannot log in unless site owner.
    inactive = _create_user(a, is_active=False)
    assert _mobile_login(a, inactive["email"], inactive["password"]).status_code == 401
    assert _mobile_login(a, account["email"], "wrong-password-1234").status_code == 401

    login = _mobile_login(a, account["email"], account["password"], device_label="PKT110")
    assert login.status_code == 200, login.text
    assert "set-cookie" not in login.headers
    assert a.cookies.get("run_session") is None

    data = login.json()["data"]
    assert data["token_type"] == "Bearer"
    assert data["user"]["id"] == account["id"]
    access = data["access_token"]
    refresh = data["refresh_token"]
    assert len(access) >= 43 and len(refresh) >= 43 and access != refresh
    assert datetime.fromisoformat(data["access_expires_at"].replace("Z", "+00:00")) == (
        base + timedelta(minutes=30)
    )
    assert datetime.fromisoformat(data["refresh_expires_at"].replace("Z", "+00:00")) == (
        base + timedelta(days=90)
    )

    with Session(engine) as db:
        row = db.scalar(
            select(MobileSession).where(MobileSession.access_token_hash == token_hash(access))
        )
        assert row is not None
        assert row.refresh_token_hash == token_hash(refresh)
        assert row.access_token_hash != access
        assert row.refresh_token_hash != refresh
        assert row.device_label == "PKT110"
        assert row.client_version == "2.6.0"
        assert row.last_used_at == base

    # Bearer works on read and write endpoints without Cookie, Origin, or CSRF headers.
    me = a.get("/api/v1/me", headers=_bearer(access))
    assert me.status_code == 200 and me.json()["data"]["id"] == account["id"]
    patched = a.patch("/api/v1/me", headers=_bearer(access), json={"display_name": "Bearer Runner"})
    assert patched.status_code == 200 and patched.json()["data"]["display_name"] == "Bearer Runner"
    assert "set-cookie" not in patched.headers

    # Last-used timestamp updates only after the 5-minute throttle window.
    app.state.clock = lambda: base + timedelta(minutes=6)
    assert a.get("/api/v1/me", headers=_bearer(access)).status_code == 200
    with Session(engine) as db:
        row = db.scalar(
            select(MobileSession).where(MobileSession.access_token_hash == token_hash(access))
        )
        assert row.last_used_at == base + timedelta(minutes=6)

    # Access token expires at 30 minutes.
    app.state.clock = lambda: base + timedelta(minutes=30)
    assert a.get("/api/v1/me", headers=_bearer(access)).status_code == 401

    # Migration downgrade guard refuses while mobile_sessions rows exist.
    assert_downgrade_guard(
        engine, "0035_mobile_sessions", "Refusing to downgrade 0035_mobile_sessions"
    )


def test_mobile_refresh_rotation_sliding_ttl_and_replay_revokes_family(clients):
    a, _, engine, app = clients
    t0 = datetime(2026, 11, 26, 10, 0, tzinfo=UTC)
    app.state.clock = lambda: t0
    account = _create_user(a, is_active=True)

    # Two independent devices (two token families).
    dev1 = _mobile_login(a, account["email"], account["password"], device_label="Device 1").json()[
        "data"
    ]
    dev2 = _mobile_login(a, account["email"], account["password"], device_label="Device 2").json()[
        "data"
    ]

    # Advance 2 days (access expired, refresh still valid); rotate dev1.
    t1 = t0 + timedelta(days=2)
    app.state.clock = lambda: t1
    assert a.get("/api/v1/me", headers=_bearer(dev1["access_token"])).status_code == 401

    refreshed = a.post(
        "/api/v1/mobile/auth/refresh",
        json={"refresh_token": dev1["refresh_token"], "client_version": "2.6.1"},
    )
    assert refreshed.status_code == 200, refreshed.text
    assert "set-cookie" not in refreshed.headers
    next_tokens = refreshed.json()["data"]
    assert next_tokens["access_token"] != dev1["access_token"]
    assert next_tokens["refresh_token"] != dev1["refresh_token"]
    assert datetime.fromisoformat(next_tokens["refresh_expires_at"].replace("Z", "+00:00")) == (
        t1 + timedelta(days=90)
    )
    assert a.get("/api/v1/me", headers=_bearer(next_tokens["access_token"])).status_code == 200

    # Replay of the already-rotated refresh token must fail AND revoke the entire dev1 token family.
    replay = a.post(
        "/api/v1/mobile/auth/refresh",
        json={"refresh_token": dev1["refresh_token"]},
    )
    assert replay.status_code == 401
    assert replay.json()["error"]["code"] == "INVALID_REFRESH_TOKEN"

    # The newly minted access & refresh tokens in dev1's family are now revoked too.
    assert a.get("/api/v1/me", headers=_bearer(next_tokens["access_token"])).status_code == 401
    assert (
        a.post(
            "/api/v1/mobile/auth/refresh",
            json={"refresh_token": next_tokens["refresh_token"]},
        ).status_code
        == 401
    )

    # Device 2's separate token family remains unaffected.
    dev2_refresh = a.post(
        "/api/v1/mobile/auth/refresh",
        json={"refresh_token": dev2["refresh_token"]},
    )
    assert dev2_refresh.status_code == 200


def test_mobile_refresh_concurrent_race_is_single_use(clients):
    a, _, _, app = clients
    account = _create_user(a, is_active=True)
    issued = _mobile_login(a, account["email"], account["password"]).json()["data"]

    def do_refresh(_):
        return a.post(
            "/api/v1/mobile/auth/refresh",
            json={"refresh_token": issued["refresh_token"]},
        ).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = sorted(pool.map(do_refresh, range(2)))
    assert statuses == [200, 401]


def test_mobile_logout_single_device_and_all_devices(clients):
    a, _, _, _ = clients
    account = _create_user(a, is_active=True)
    dev1 = _mobile_login(a, account["email"], account["password"], device_label="D1").json()["data"]
    dev2 = _mobile_login(a, account["email"], account["password"], device_label="D2").json()["data"]
    dev3 = _mobile_login(a, account["email"], account["password"], device_label="D3").json()["data"]

    # Default logout revokes only current device family.
    out1 = a.post("/api/v1/mobile/auth/logout", headers=_bearer(dev1["access_token"]))
    assert out1.status_code == 200 and out1.json()["data"]["logged_out"] is True
    assert a.get("/api/v1/me", headers=_bearer(dev1["access_token"])).status_code == 401
    assert (
        a.post(
            "/api/v1/mobile/auth/refresh", json={"refresh_token": dev1["refresh_token"]}
        ).status_code
        == 401
    )
    assert a.get("/api/v1/me", headers=_bearer(dev2["access_token"])).status_code == 200
    assert a.get("/api/v1/me", headers=_bearer(dev3["access_token"])).status_code == 200

    # revoke_all_devices=True revokes all remaining mobile sessions for this user.
    out_all = a.post(
        "/api/v1/mobile/auth/logout",
        headers=_bearer(dev2["access_token"]),
        json={"revoke_all_devices": True},
    )
    assert out_all.status_code == 200
    assert a.get("/api/v1/me", headers=_bearer(dev2["access_token"])).status_code == 401
    assert a.get("/api/v1/me", headers=_bearer(dev3["access_token"])).status_code == 401


def test_cookie_and_bearer_mutual_exclusion_and_desktop_csrf_unchanged(clients):
    a, b, _, _ = clients
    register(a)  # a now holds a valid desktop web session cookie.
    account = _create_user(b, is_active=True)
    mobile = _mobile_login(b, account["email"], account["password"]).json()["data"]

    # Desktop Cookie + CSRF/Origin still strictly enforced when no Bearer is sent.
    assert a.get("/api/v1/me").status_code == 200
    assert a.patch("/api/v1/me", json={"display_name": "No CSRF"}).status_code == 403
    assert (
        a.patch(
            "/api/v1/me", headers={"Origin": "http://evil.example"}, json={"display_name": "Bad"}
        ).status_code
        == 403
    )
    assert (
        a.patch("/api/v1/me", headers=headers(a), json={"display_name": "Web OK"}).status_code
        == 200
    )
    # Cookie-only session cannot call mobile logout.
    assert a.post("/api/v1/mobile/auth/logout", headers=headers(a)).status_code == 401

    # Sending BOTH session Cookie and Authorization: Bearer must be rejected.
    conflict_get = a.get("/api/v1/me", headers=_bearer(mobile["access_token"]))
    assert conflict_get.status_code == 400
    assert conflict_get.json()["error"]["code"] == "AUTH_CONFLICT"

    conflict_patch = a.patch(
        "/api/v1/me",
        headers={**headers(a), **_bearer(mobile["access_token"])},
        json={"display_name": "Conflict"},
    )
    assert conflict_patch.status_code == 400
    assert conflict_patch.json()["error"]["code"] == "AUTH_CONFLICT"

    # Even an invalid Bearer alongside a valid Cookie is rejected (no silent fallback).
    conflict_bad_bearer = a.get("/api/v1/me", headers=_bearer("invalid-token"))
    assert conflict_bad_bearer.status_code == 400
    assert conflict_bad_bearer.json()["error"]["code"] == "AUTH_CONFLICT"

    # Non-Bearer Authorization (e.g. staging HTTP Basic Auth) alongside Cookie does not conflict.
    basic_with_cookie = a.get("/api/v1/me", headers={"Authorization": "Basic dXNlcjpwYXNz"})
    assert basic_with_cookie.status_code == 200


def test_bearer_cross_user_isolation_returns_404(clients):
    a, b, _, _ = clients
    register(a)
    activity_id = upload(a).json()["data"]["activity"]["id"]

    other = _create_user(b, is_active=True)
    other_tokens = _mobile_login(b, other["email"], other["password"]).json()["data"]
    auth = _bearer(other_tokens["access_token"])

    assert b.get(f"/api/v1/activities/{activity_id}", headers=auth).status_code == 404
    assert (
        b.patch(
            f"/api/v1/activities/{activity_id}",
            headers=auth,
            json={"title": "Hijacked"},
        ).status_code
        == 404
    )
    assert b.delete(f"/api/v1/activities/{activity_id}", headers=auth).status_code == 404

    # Bearer can upload a GPX track for itself without CSRF.
    imported = b.post(
        "/api/v1/gpx-imports",
        headers=auth,
        files={
            "file": (
                "equator-six.gpx",
                (FIXTURES / "equator-six.gpx").read_bytes(),
                "application/gpx+xml",
            )
        },
        data={"timezone": "UTC"},
    )
    assert imported.status_code == 201, imported.text


def test_password_change_and_admin_actions_revoke_mobile_sessions(clients):
    owner_client, member_client, _, _ = clients
    register(owner_client)

    # Create a managed active user via admin API.
    member_email = f"{uuid4().hex[:16]}@example.com"
    created = owner_client.post(
        "/api/v1/admin/users",
        headers=headers(owner_client),
        json={
            "email": member_email,
            "username": f"u_{uuid4().hex[:16]}",
            "display_name": "Managed Runner",
            "password": PASSWORD,
            "is_active": True,
        },
    )
    assert created.status_code == 201, created.text
    member_id = created.json()["data"]["id"]

    # 1) Password change revokes both web and mobile sessions.
    tokens1 = _mobile_login(member_client, member_email, PASSWORD).json()["data"]
    assert (
        member_client.get("/api/v1/me", headers=_bearer(tokens1["access_token"])).status_code == 200
    )
    pw_change = member_client.patch(
        "/api/v1/me/password",
        headers=_bearer(tokens1["access_token"]),
        json={"current_password": PASSWORD, "new_password": "New-mobile-password-2026"},
    )
    assert pw_change.status_code == 200
    assert "set-cookie" not in pw_change.headers
    assert (
        member_client.get("/api/v1/me", headers=_bearer(tokens1["access_token"])).status_code == 401
    )
    assert (
        member_client.post(
            "/api/v1/mobile/auth/refresh", json={"refresh_token": tokens1["refresh_token"]}
        ).status_code
        == 401
    )

    # 2) Admin password reset revokes mobile session.
    tokens2 = _mobile_login(member_client, member_email, "New-mobile-password-2026").json()["data"]
    assert (
        owner_client.post(
            f"/api/v1/admin/users/{member_id}/reset-password",
            headers=headers(owner_client),
            json={"new_password": "Admin-reset-password-2026"},
        ).status_code
        == 200
    )
    assert (
        member_client.get("/api/v1/me", headers=_bearer(tokens2["access_token"])).status_code == 401
    )
    assert (
        member_client.post(
            "/api/v1/mobile/auth/refresh", json={"refresh_token": tokens2["refresh_token"]}
        ).status_code
        == 401
    )

    # 3) Admin email change revokes mobile session.
    tokens3 = _mobile_login(member_client, member_email, "Admin-reset-password-2026").json()["data"]
    new_email = f"{uuid4().hex[:16]}@example.com"
    assert (
        owner_client.patch(
            f"/api/v1/admin/users/{member_id}",
            headers=headers(owner_client),
            json={"email": new_email},
        ).status_code
        == 200
    )
    assert (
        member_client.get("/api/v1/me", headers=_bearer(tokens3["access_token"])).status_code == 401
    )
    assert (
        member_client.post(
            "/api/v1/mobile/auth/refresh", json={"refresh_token": tokens3["refresh_token"]}
        ).status_code
        == 401
    )

    # 4) Admin disable revokes mobile session.
    tokens4 = _mobile_login(member_client, new_email, "Admin-reset-password-2026").json()["data"]
    assert (
        owner_client.patch(
            f"/api/v1/admin/users/{member_id}",
            headers=headers(owner_client),
            json={"is_active": False},
        ).status_code
        == 200
    )
    assert (
        member_client.get("/api/v1/me", headers=_bearer(tokens4["access_token"])).status_code == 401
    )
    assert (
        member_client.post(
            "/api/v1/mobile/auth/refresh", json={"refresh_token": tokens4["refresh_token"]}
        ).status_code
        == 401
    )


def test_mobile_login_rate_limiting_uses_shared_auth_buckets(clients):
    a, _, _, _ = clients
    email = f"{uuid4().hex[:16]}@example.com"
    for _ in range(10):
        res = _mobile_login(a, email, "wrong-password-1234")
        assert res.status_code == 401
    limited = _mobile_login(a, email, "wrong-password-1234")
    assert limited.status_code == 429
    assert limited.json()["error"]["code"] == "AUTH_RATE_LIMITED"
    assert 1 <= int(limited.headers["retry-after"]) <= 900
