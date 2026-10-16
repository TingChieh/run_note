"""Single-owner API acceptance using synthetic rows in an explicitly allowed _test DB."""

import os
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.security import hash_password, new_token, token_hash
from app.db.schema import get_expected_revision
from app.main import create_app
from app.modules.activities.model import Activity
from app.modules.ai_reports.model import AIReport
from app.modules.ai_reports.schema import AnalysisText
from app.modules.ai_reports.snapshot import build_snapshot
from app.modules.auth.model import AuthSession
from app.modules.users.model import User

pytestmark = pytest.mark.integration
ORIGIN = "http://127.0.0.1:5191"
PASSWORD = "Synthetic-showcase-password"


@pytest.fixture(scope="module")
def site():
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.skip("Explicit isolated test database required")
    engine = create_engine(url, hide_parameters=True)
    with engine.connect() as db:
        assert db.scalars(text("SELECT version_num FROM alembic_version")).all() == [
            get_expected_revision()
        ]
    unique = uuid4().hex[:20]
    owner_email, other_email = f"site-{unique}@example.com", f"other-{unique}@example.com"
    now = datetime(2026, 10, 16, tzinfo=UTC)
    old_token = new_token()
    with Session(engine) as db:
        owner = User(
            email_normalized=owner_email,
            username=f"s_{unique}",
            display_name="合成站主",
            password_hash=hash_password(PASSWORD),
            timezone="Asia/Shanghai",
        )
        other = User(
            email_normalized=other_email,
            username=f"o_{unique}",
            display_name="合成其他账号",
            password_hash=hash_password(PASSWORD),
            timezone="Asia/Shanghai",
        )
        db.add_all([owner, other])
        db.flush()
        owner_id, other_id = owner.id, other.id
        db.add(
            AuthSession(
                user_id=other_id,
                token_hash=token_hash(old_token),
                csrf_token="synthetic-old-csrf",
                created_at=now,
                last_seen_at=now,
                expires_at=now + timedelta(days=1),
            )
        )
        db.commit()
    settings = Settings(
        database_url=url,
        site_owner_email=owner_email,
        site_origin=ORIGIN,
        app_env="test",
        auth_rate_hash_key=uuid4().hex + uuid4().hex,
        _env_file=None,
    )
    app = create_app(settings)
    app.state.clock = lambda: now
    # No lifespan worker: acceptance reads never rebuild or refresh caches in the background.
    admin = TestClient(app, base_url=ORIGIN)
    visitor = TestClient(app, base_url=ORIGIN)
    old = TestClient(app, base_url=ORIGIN)
    old.cookies.set("run_session", old_token)
    csrf = admin.get("/api/v1/auth/csrf").json()["data"]["csrf_token"]
    login = admin.post(
        "/api/v1/auth/login",
        json={"email": owner_email, "password": PASSWORD},
        headers={"Origin": ORIGIN, "X-CSRF-Token": csrf},
    )
    assert login.status_code == 200
    headers = {"Origin": ORIGIN, "X-CSRF-Token": login.json()["data"]["csrf_token"]}
    fixture = Path(__file__).parents[1] / "fixtures/gpx/equator-six.gpx"
    uploaded = admin.post(
        "/api/v1/gpx-imports",
        headers=headers,
        files={"file": ("synthetic.gpx", fixture.read_bytes(), "application/gpx+xml")},
    )
    assert uploaded.status_code == 201, uploaded.text
    activity = uploaded.json()["data"]["activity"]
    changed = admin.patch(
        f"/api/v1/activities/{activity['id']}",
        headers=headers,
        json={"notes": "PRIVATE_NOTE_SENTINEL", "title": "合成公开晨跑"},
    )
    assert changed.status_code == 200
    with Session(engine) as db:
        snapshot = build_snapshot(
            db, owner_id, now.date() - timedelta(days=32), now.date() - timedelta(days=4)
        )
        identifiers = {}
        other_activity = Activity(
            user_id=other_id,
            source="manual",
            title="OTHER_ACTIVITY_SENTINEL",
            activity_date=now.date(),
            date_source="manual",
            timezone="Asia/Shanghai",
            distance_m=1000,
            temporal_quality="manual",
            quality_summary={},
            metrics_version="synthetic-v1",
            visibility="public",
        )
        db.add(other_activity)
        db.flush()
        identifiers["other_activity"] = str(other_activity.id)
        for name, user_id, status in [
            ("owner", owner_id, "succeeded"),
            ("other", other_id, "succeeded"),
            ("pending", owner_id, "pending"),
        ]:
            row = AIReport(
                user_id=user_id,
                request_key=uuid4(),
                date_from="2026-09-14",
                date_to="2026-10-12",
                source_data_version=0,
                status=status,
                stats_snapshot={**snapshot, "email": "PRIVATE_EMAIL_SENTINEL"},
                model="private-model",
                prompt_version="private-version",
                report_text=AnalysisText(
                    trend_summary="保持稳定节奏",
                    recommendations=["适度休息"],
                    limitations="仅供参考",
                ).model_dump_json()
                if status == "succeeded"
                else None,
                created_at=now - timedelta(days=1),
                finished_at=now if status == "succeeded" else None,
            )
            db.add(row)
            db.flush()
            identifiers[name] = str(row.id)
        db.commit()
    try:
        yield admin, visitor, old, headers, activity, identifiers, engine, settings, other_email
    finally:
        admin.close()
        visitor.close()
        old.close()
        engine.dispose()


def test_all_owner_records_and_precise_route_are_public_but_private_fields_are_not(site):
    admin, visitor, _, _, activity, ids, _, _, _ = site
    prefix = "/api/v1/showcase"
    listed = visitor.get(prefix + "/activities").json()["data"]
    assert listed["total"] == 1
    assert listed["items"][0]["id"] == activity["id"]
    assert activity["visibility"] == "private"
    public = visitor.get(prefix + f"/activities/{activity['id']}")
    assert public.status_code == 200
    assert "notes" not in public.json()["data"] and "PRIVATE_NOTE_SENTINEL" not in public.text
    for key in ["email", "user_id", "password_hash", "filename"]:
        assert key not in public.json()["data"]
    assert visitor.get(prefix + f"/activities/{uuid4()}").status_code == 404
    for suffix in ["", "/route"]:
        assert (
            visitor.get(prefix + "/activities/" + ids["other_activity"] + suffix).status_code == 404
        )
    path = f"/activities/{activity['id']}/route"
    route = visitor.get(prefix + path)
    assert route.json()["data"] == admin.get("/api/v1" + path).json()["data"]
    assert route.json()["data"]["features"]
    assert route.headers["cache-control"] == "no-store"
    assert "set-cookie" not in route.headers


def test_showcase_statistics_goals_footprints_and_report_reads(site):
    _, visitor, _, _, _, ids, engine, _, _ = site
    for path in [
        "/profile",
        "/statistics/summary",
        "/statistics/calendar?year=2026",
        "/statistics/trends?date_from=2026-01-01&date_to=2027-01-01",
        "/statistics/streaks",
        "/running-goals",
        "/footprints/all",
        "/footprints/provinces",
        "/footprints?date_from=2023-01-01&date_to=2027-01-01",
    ]:
        response = visitor.get("/api/v1/showcase" + path)
        assert response.status_code == 200, (path, response.text)
    reports = visitor.get("/api/v1/showcase/ai-reports").json()["data"]
    assert reports["total"] == 1 and reports["items"][0]["id"] == ids["owner"]
    for name in ["other", "pending"]:
        assert visitor.get("/api/v1/showcase/ai-reports/" + ids[name]).status_code == 404
    report = visitor.get("/api/v1/showcase/ai-reports/" + ids["owner"])
    assert report.status_code == 200
    assert "PRIVATE_EMAIL_SENTINEL" not in report.text and "private-model" not in report.text
    with Session(engine) as db:
        pending = db.scalar(select(AIReport).where(AIReport.id == ids["pending"]))
        assert pending.status == "pending" and pending.finished_at is None


def test_old_other_account_session_and_anonymous_writes_are_rejected(site):
    _, visitor, old, headers, activity, _, _, _, other_email = site
    path = f"/api/v1/activities/{activity['id']}"
    for client in [visitor, old]:
        assert client.get("/api/v1/me").status_code == 401
        assert client.patch(path, json={"title": "forbidden"}, headers=headers).status_code == 401
    csrf = visitor.get("/api/v1/auth/csrf").json()["data"]["csrf_token"]
    rejected = visitor.post(
        "/api/v1/auth/login",
        json={"email": other_email, "password": PASSWORD},
        headers={"Origin": ORIGIN, "X-CSRF-Token": csrf},
    )
    assert rejected.status_code == 401
    assert visitor.get("/api/v1/auth/session").status_code == 401
    assert (
        visitor.post(
            "/api/v1/auth/register",
            json={"email": "closed@example.com", "username": "closed_user", "password": PASSWORD},
        ).status_code
        == 403
    )


def test_admin_csrf_origin_and_mutation_still_work(site):
    admin, visitor, _, headers, activity, _, _, _, _ = site
    path = f"/api/v1/activities/{activity['id']}"
    assert admin.patch(path, json={"title": "forbidden"}).status_code == 403
    assert (
        admin.patch(
            path,
            json={"title": "forbidden"},
            headers={**headers, "Origin": "https://different.example"},
        ).status_code
        == 403
    )
    assert admin.patch(path, json={"title": "管理员合成更新"}, headers=headers).status_code == 200
    assert (
        visitor.get("/api/v1/showcase" + path.removeprefix("/api/v1")).json()["data"]["title"]
        == "管理员合成更新"
    )


def test_offline_owner_bootstrap_checks_target_and_never_overwrites_an_existing_owner(
    site, monkeypatch
):
    import runpy
    import sys
    from types import SimpleNamespace

    from app.core.security import verify_password

    *_, engine, config, _ = site
    unique = uuid4().hex[:20]
    config = config.model_copy(update={"site_owner_email": f"bootstrap-{unique}@example.com"})
    entry = runpy.run_path(str(Path(__file__).parents[3] / "scripts/site-owner.py"))["main"]
    monkeypatch.setitem(entry.__globals__, "Settings", lambda: config)
    monkeypatch.setattr(sys, "argv", ["site-owner.py", "status"])
    with pytest.raises(SystemExit, match="owner missing"):
        entry()
    monkeypatch.setattr(sys, "stdin", SimpleNamespace(isatty=lambda: True))
    monkeypatch.setattr("builtins.input", lambda _: engine.url.database)
    monkeypatch.setattr("getpass.getpass", lambda _: PASSWORD)
    monkeypatch.setattr(sys, "argv", ["site-owner.py", "create", "--username", f"b_{unique}"])
    entry()
    with Session(engine) as db:
        user = db.scalar(select(User).where(User.email_normalized == config.site_owner_email))
        assert verify_password(user.password_hash, PASSWORD)
        original_hash = user.password_hash
    with pytest.raises(SystemExit, match="already exists"):
        entry()
    with Session(engine) as db:
        assert (
            db.scalar(
                select(User.password_hash).where(User.email_normalized == config.site_owner_email)
            )
            == original_hash
        )
    monkeypatch.setattr(sys, "argv", ["site-owner.py", "status"])
    entry()
