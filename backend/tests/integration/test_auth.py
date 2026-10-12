"""Real PostgreSQL API tests; never delete or truncate records, use unique identities."""

import os
import subprocess
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, update
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.main import create_app
from app.modules.auth.model import AuthRateBucket, AuthSession
from app.modules.users.model import User

pytestmark = pytest.mark.integration
ORIGIN = "http://localhost:5173"
PASSWORD = " a long password "


@pytest.fixture(scope="module")
def auth_database():
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.skip("Explicit isolated test database required")
    backend = Path(__file__).resolve().parents[2]
    # Session autouse safety guard has already validated the actual target identity.
    if os.environ.get("RUNNOTE_TEST_NO_MIGRATIONS") == "1":
        engine = create_engine(url, hide_parameters=True)
        try:
            from sqlalchemy import text

            with engine.connect() as connection:
                assert connection.execute(
                    text("SELECT version_num FROM alembic_version")
                ).scalars().all() == ["0003_gpx_storage"], (
                    "Existing isolated test schema must already be current"
                )
        finally:
            engine.dispose()
    else:
        subprocess.run(
            [str(backend / ".venv/bin/alembic"), "upgrade", "head"],
            cwd=backend,
            env={**os.environ, "DATABASE_URL": url, "APP_ENV": "test"},
            check=True,
            capture_output=True,
        )
    return url


@pytest.fixture
def workers(auth_database):
    url = auth_database
    settings = Settings(
        database_url=url,
        app_env="test",
        site_origin=ORIGIN,
        auth_rate_hash_key=uuid4().hex + uuid4().hex,
        _env_file=None,
    )
    a, b = create_app(settings), create_app(settings)
    engine = create_engine(url, hide_parameters=True)
    try:
        with TestClient(a, base_url=ORIGIN) as ca, TestClient(b, base_url=ORIGIN) as cb:
            yield ca, cb, engine
    finally:
        engine.dispose()


def csrf(client):
    r = client.get("/api/v1/auth/csrf")
    assert r.status_code == 200, r.text
    return {"Origin": ORIGIN, "X-CSRF-Token": r.json()["data"]["csrf_token"]}


def register(client, headers=None, **overrides):
    suffix = uuid4().hex[:20]
    body = {
        "email": f"{suffix}@example.com",
        "username": "u_" + suffix,
        "password": PASSWORD,
        **overrides,
    }
    r = client.post("/api/v1/auth/register", json=body, headers=headers or csrf(client))
    return r, body


def login(client, body):
    return client.post(
        "/api/v1/auth/login", headers=csrf(client), json={k: body[k] for k in ["email", "password"]}
    )


def test_register_rotation_storage_and_identity_isolation(workers):
    a, b, engine = workers
    old = csrf(a)
    old_cookie = a.cookies.get("run_session")
    r, body = register(a, old, email=" " + uuid4().hex + "@EXAMPLE.COM ")
    assert r.status_code == 201
    assert r.json()["data"]["user"]["email"] == body["email"].strip().lower()
    assert r.json()["data"]["csrf_token"] != old["X-CSRF-Token"]
    assert a.cookies.get("run_session") != old_cookie
    assert "HttpOnly" in r.headers["set-cookie"] and "SameSite=lax" in r.headers["set-cookie"]
    assert "Secure" not in r.headers["set-cookie"]
    assert a.get("/api/v1/auth/session").json()["data"]["authenticated"] is True
    assert b.get("/api/v1/me").status_code == 401
    rb, _ = register(b)
    assert rb.status_code == 201
    assert a.get("/api/v1/me").json()["data"]["id"] != b.get("/api/v1/me").json()["data"]["id"]
    assert a.patch("/api/v1/me", json={"display_name": "bad"}, headers=old).status_code == 403
    with Session(engine) as s:
        users = s.scalars(
            select(User).where(
                User.id.in_([r.json()["data"]["user"]["id"], rb.json()["data"]["user"]["id"]])
            )
        ).all()
        assert users[0].password_hash != users[1].password_hash
        assert all(PASSWORD != u.password_hash and not u.profile_is_public for u in users)
        assert not s.scalar(
            select(AuthSession).where(AuthSession.token_hash == a.cookies.get("run_session"))
        )
    saved = a.cookies.get("run_session")
    a.cookies.set("run_session", old_cookie, domain="localhost.local", path="/")
    assert a.get("/api/v1/me").status_code == 401
    a.cookies.set("run_session", saved, domain="localhost.local", path="/")
    assert a.get("/api/v1/me").status_code == 200
    assert set(a.get("/api/v1/me").json()["data"]) == {
        "id",
        "email",
        "username",
        "display_name",
        "timezone",
        "created_at",
    }
    engine.dispose()


def test_profile_password_revokes_all_workers_and_logout(workers):
    a, b, engine = workers
    r, body = register(a)
    assert r.status_code == 201
    assert login(b, body).status_code == 200
    h = csrf(a)
    assert (
        a.patch(
            "/api/v1/me", headers=h, json={"display_name": "Runner", "timezone": "Europe/London"}
        ).status_code
        == 200
    )
    assert b.get("/api/v1/me").json()["data"]["display_name"] == "Runner"
    for payload in [
        {"email": "bad"},
        {"username": "bad"},
        {"profile_is_public": True},
        {"user_id": r.json()["data"]["user"]["id"]},
        {"timezone": "No/Such"},
        {"display_name": None},
        {"display_name": ""},
        {},
    ]:
        assert a.patch("/api/v1/me", headers=h, json=payload).status_code == 422
    assert (
        a.patch(
            "/api/v1/me/password",
            headers=h,
            json={"current_password": "wrong password", "new_password": "new long password"},
        ).status_code
        == 401
    )
    change = a.patch(
        "/api/v1/me/password",
        headers=h,
        json={"current_password": PASSWORD, "new_password": "new long password"},
    )
    assert change.status_code == 200
    assert "Max-Age=0" in change.headers["set-cookie"]
    assert a.get("/api/v1/me").status_code == b.get("/api/v1/me").status_code == 401
    assert login(a, body).status_code == 401
    body["password"] = "new long password"
    assert login(a, body).status_code == 200
    logout = a.post("/api/v1/auth/logout", headers=csrf(a))
    assert logout.status_code == 200 and logout.json()["data"]["logged_out"] is True
    assert a.get("/api/v1/auth/session").status_code == 401
    assert a.post("/api/v1/auth/logout", headers=h).status_code == 401
    engine.dispose()


@pytest.mark.parametrize(
    "headers",
    [
        {},
        {"Origin": "null"},
        {"Origin": "http://evil"},
        {"Origin": "http://evil", "Referer": ORIGIN + "/"},
        {"Origin": ORIGIN},
    ],
)
def test_write_source_and_csrf_rejection(workers, headers):
    a, _, engine = workers
    good = csrf(a)
    if headers.get("Origin") != ORIGIN:
        headers = {**headers, "X-CSRF-Token": good["X-CSRF-Token"]}
    r, _ = register(a, headers=headers or {"X-CSRF-Token": good["X-CSRF-Token"]})
    assert r.status_code == 403
    engine.dispose()


def test_referer_preauth_unknown_fields_credentials_and_conflicts(workers):
    a, b, engine = workers
    h = csrf(a)
    assert a.get("/api/v1/me").status_code == 401
    h.pop("Origin")
    h["Referer"] = ORIGIN + "/register"
    r, body = register(a, headers=h)
    assert r.status_code == 201
    conflict, _ = register(b, email=body["email"])
    assert conflict.status_code == 409 and conflict.json()["error"]["code"] == "EMAIL_EXISTS"
    conflict, _ = register(b, username=body["username"])
    assert conflict.status_code == 409 and conflict.json()["error"]["code"] == "USERNAME_EXISTS"
    bad, _ = register(b, user_id=uuid4().hex)
    assert bad.status_code == 422
    bad, _ = register(b, timezone="invalid")
    assert bad.status_code == 422
    wrong = login(b, {**body, "password": "wrong password"})
    unknown = login(b, {"email": uuid4().hex + "@example.com", "password": "wrong password"})
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json()["error"] == unknown.json()["error"]
    engine.dispose()


@pytest.mark.parametrize("expiry", ["absolute", "idle", "anonymous"])
def test_real_expiry_and_last_seen_throttle(workers, expiry):
    from app.core.security import token_hash

    a, _, engine = workers
    if expiry == "anonymous":
        csrf(a)
    else:
        assert register(a)[0].status_code == 201
    hashed = token_hash(a.cookies.get("run_session"))
    now = datetime.now(UTC)
    with Session(engine) as s:
        row = s.scalar(select(AuthSession).where(AuthSession.token_hash == hashed))
        before = row.last_seen_at
    if expiry != "anonymous":
        assert a.get("/api/v1/me").status_code == 200
        with Session(engine) as s:
            assert (
                s.scalar(select(AuthSession.last_seen_at).where(AuthSession.token_hash == hashed))
                == before
            )
        with engine.begin() as c:
            c.execute(
                update(AuthSession)
                .where(AuthSession.token_hash == hashed)
                .values(last_seen_at=now - timedelta(minutes=6))
            )
        assert a.get("/api/v1/me").status_code == 200
        with Session(engine) as s:
            assert (
                s.scalar(select(AuthSession.last_seen_at).where(AuthSession.token_hash == hashed))
                > before
            )
    values = (
        {"expires_at": now} if expiry != "idle" else {"last_seen_at": now - timedelta(hours=24)}
    )
    with engine.begin() as c:
        c.execute(update(AuthSession).where(AuthSession.token_hash == hashed).values(**values))
    if expiry == "anonymous":
        old = a.cookies.get("run_session")
        csrf(a)
        assert old != a.cookies.get("run_session")
    else:
        assert a.get("/api/v1/me").status_code == 401
    engine.dispose()


def test_shared_account_rate_limit_and_untrusted_forwarded_ip(workers):
    a, b, engine = workers
    assert register(a)[0].status_code == 201
    headers = [csrf(a), csrf(b)]
    email = uuid4().hex + "@example.com"
    for i in range(10):
        c = [a, b][i % 2]
        assert (
            c.post(
                "/api/v1/auth/login",
                headers={**headers[i % 2], "X-Forwarded-For": f"192.0.2.{i}"},
                json={"email": email, "password": "wrong password"},
            ).status_code
            == 401
        )
    r = b.post(
        "/api/v1/auth/login",
        headers=headers[1],
        json={"email": email, "password": "wrong password"},
    )
    assert r.status_code == 429 and 1 <= int(r.headers["retry-after"]) <= 900
    with Session(engine) as s:
        buckets = s.scalars(
            select(AuthRateBucket).where(AuthRateBucket.scope == "login-account")
        ).all()
        assert email not in [x.subject_hash for x in buckets]
    engine.dispose()


def test_concurrent_database_rate_limit(workers):
    from app.core.errors import ApiError
    from app.modules.auth.rate_limit import consume

    a, b, engine = workers
    now = datetime(2026, 10, 12, tzinfo=UTC)
    subject = uuid4().hex

    def attempt(i):
        app = [a, b][i % 2].app
        try:
            consume(app, [("login-account", subject)], now)
            return 200
        except ApiError as e:
            return e.status_code

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(attempt, range(20)))
    assert results.count(200) == 10 and results.count(429) == 10
    engine.dispose()


def test_concurrent_registration_unique_constraint(workers):
    a, b, engine = workers
    ha, hb = csrf(a), csrf(b)
    suffix = uuid4().hex[:20]
    body = {"email": suffix + "@example.com", "username": "u_" + suffix, "password": PASSWORD}
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(
            pool.map(
                lambda pair: pair[0].post("/api/v1/auth/register", headers=pair[1], json=body),
                [(a, ha), (b, hb)],
            )
        )
    assert sorted(r.status_code for r in results) == [201, 409]
    with Session(engine) as s:
        assert len(s.scalars(select(User).where(User.email_normalized == body["email"])).all()) == 1
    engine.dispose()


@pytest.mark.parametrize(
    "scope,limit,seconds", [("login-ip", 60, 900), ("register-ip", 10, 3600), ("csrf-ip", 60, 3600)]
)
def test_other_rate_limits_and_window_boundary(workers, scope, limit, seconds):
    from app.core.errors import ApiError
    from app.modules.auth.rate_limit import consume

    a, b, engine = workers
    subject = uuid4().hex
    now = datetime(2026, 10, 12, tzinfo=UTC)
    for i in range(limit):
        consume([a, b][i % 2].app, [(scope, subject)], now)
    with pytest.raises(ApiError) as e:
        consume(b.app, [(scope, subject)], now)
    assert e.value.status_code == 429
    consume(a.app, [(scope, subject)], now + timedelta(seconds=seconds))
    engine.dispose()


def test_concurrent_preauth_token_only_consumed_once(workers):
    a, b, engine = workers
    h = csrf(a)
    b.cookies.set("run_session", a.cookies.get("run_session"), domain="localhost.local", path="/")

    def attempt(pair):
        return register(pair[0], headers=pair[1])[0].status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(attempt, [(a, h), (b, h)]))
    assert sorted(results) == [201, 403]
    engine.dispose()


def test_login_rehash_and_rotation_does_not_revoke_other_devices(workers):
    from argon2 import PasswordHasher

    a, b, engine = workers
    r, body = register(a)
    user_id = r.json()["data"]["user"]["id"]
    with engine.begin() as c:
        c.execute(
            update(User)
            .where(User.id == user_id)
            .values(
                password_hash=PasswordHasher(memory_cost=8192, time_cost=1, parallelism=1).hash(
                    PASSWORD
                )
            )
        )
    assert login(b, body).status_code == 200
    assert a.get("/api/v1/me").status_code == 200
    old = b.cookies.get("run_session")
    old_csrf = csrf(b)
    assert login(b, body).status_code == 200
    assert b.cookies.get("run_session") != old
    assert b.patch("/api/v1/me", headers=old_csrf, json={"display_name": "No"}).status_code == 403
    with Session(engine) as s:
        assert s.get(User, user_id).password_hash.startswith("$argon2id$v=19$m=19456,t=2,p=1$")
    engine.dispose()


def test_sensitive_values_absent_from_responses_and_logs(workers, caplog):
    a, _, engine = workers
    with caplog.at_level("INFO"):
        r, body = register(a)
        bad = login(a, {**body, "password": "wrong password"})
        response = a.get("/api/v1/me")
    text = r.text + bad.text + response.text + caplog.text
    with Session(engine) as s:
        user = s.scalar(select(User).where(User.email_normalized == body["email"]))
        assert user.password_hash not in text
    assert PASSWORD not in text and a.cookies.get("run_session") not in text
    assert "password_hash" not in text and "token_hash" not in text
    for item in [r, bad, response]:
        assert item.headers["cache-control"] == "no-store"
        assert item.headers["x-request-id"] == item.json()["meta"]["request_id"]
    engine.dispose()


def test_logout_rejects_unknown_body_fields(workers):
    a, _, engine = workers
    assert register(a)[0].status_code == 201
    r = a.post("/api/v1/auth/logout", headers=csrf(a), json={"user_id": str(uuid4())})
    assert r.status_code == 422
    assert a.get("/api/v1/me").status_code == 200
    engine.dispose()


def test_five_parallel_cookie_requests_do_not_starve_pool(workers, monkeypatch):
    import threading

    from app.modules.auth import service

    a, _, engine = workers
    h = csrf(a)
    real = service.find_session
    barrier = threading.Barrier(5)
    lock = threading.Lock()
    calls = 0

    def aligned(*args):
        nonlocal calls
        row = real(*args)
        with lock:
            calls += 1
            first = calls <= 5
        if first:
            barrier.wait(timeout=3)
        return row

    monkeypatch.setattr(service, "find_session", aligned)
    with TestClient(a.app, base_url=ORIGIN, raise_server_exceptions=False) as client:
        client.cookies.set(
            "run_session", a.cookies.get("run_session"), domain="localhost.local", path="/"
        )

        def attempt(i):
            return client.post(
                "/api/v1/auth/login",
                headers=h,
                json={"email": uuid4().hex + "@example.com", "password": "wrong password"},
            ).status_code

        with ThreadPoolExecutor(max_workers=5) as pool:
            results = list(pool.map(attempt, range(5)))
    assert results == [401] * 5
    engine.dispose()


def _process_login_and_verify(url, key, body, output, check_revoked):
    """Separate OS worker, engine and Cookie jar; no inherited Session or pool."""
    settings = Settings(
        database_url=url, app_env="test", site_origin=ORIGIN, auth_rate_hash_key=key, _env_file=None
    )
    with TestClient(create_app(settings), base_url=ORIGIN) as client:
        result = login(client, body)
        output.put((os.getpid(), result.status_code, client.get("/api/v1/me").json()["data"]["id"]))
        if not check_revoked.wait(timeout=15):
            raise RuntimeError("Parent revocation did not arrive")
        output.put((os.getpid(), client.get("/api/v1/me").status_code))


def test_two_os_workers_observe_password_revocation(workers):
    import multiprocessing

    a, _, engine = workers
    r, body = register(a)
    assert r.status_code == 201
    user_id = r.json()["data"]["user"]["id"]
    context = multiprocessing.get_context("spawn")
    output = context.Queue()
    check_revoked = context.Event()
    settings = a.app.state.settings
    children = [
        context.Process(
            target=_process_login_and_verify,
            args=(
                settings.database_url,
                settings.auth_rate_hash_key.get_secret_value(),
                body,
                output,
                check_revoked,
            ),
        )
        for _ in range(2)
    ]
    try:
        for process in children:
            process.start()
        initial = [output.get(timeout=15) for _ in children]
        assert len({x[0] for x in initial}) == 2
        assert all(x[1:] == (200, user_id) for x in initial)
        response = a.patch(
            "/api/v1/me/password",
            headers=csrf(a),
            json={"current_password": PASSWORD, "new_password": "new long password"},
        )
        assert response.status_code == 200
        check_revoked.set()
        final = [output.get(timeout=15) for _ in children]
        assert all(x[1] == 401 for x in final)
        for process in children:
            process.join(timeout=15)
            assert process.exitcode == 0
    finally:
        check_revoked.set()
        for process in children:
            if process.is_alive():
                process.terminate()
            process.join(timeout=5)
        output.close()
        output.join_thread()
        engine.dispose()


@pytest.mark.parametrize(
    "method,path,payload",
    [
        ("get", "/api/v1/auth/session", None),
        ("get", "/api/v1/me", None),
        ("patch", "/api/v1/me", {"display_name": "Runner"}),
        ("patch", "/api/v1/me/password", {"current_password": PASSWORD, "new_password": PASSWORD}),
        ("post", "/api/v1/auth/logout", None),
    ],
)
def test_anonymous_and_preauth_cannot_access_identity(workers, method, path, payload):
    a, _, engine = workers
    for headers in [{}, csrf(a)]:
        r = a.request(method, path, json=payload, headers=headers)
        assert r.status_code == 401
    engine.dispose()
