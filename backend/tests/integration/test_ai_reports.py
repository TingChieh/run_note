import json
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, date, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.config import Settings
from app.core.errors import ApiError
from app.main import create_app
from app.modules.activities.model import Activity
from app.modules.users.model import User
from tests.integration.test_gpx_import import headers, register

pytestmark = pytest.mark.integration
PAYLOAD = {"date_from": "2024-01-01", "date_to": "2024-01-29", "consent_to_send_summary": True}
TEXT = {
    "trend_summary": "跑量呈上升趋势，注意恢复。",
    "recommendations": ["下周以轻松跑为主，疲劳时休息。"],
    "limitations": "仅基于提供的统计，不能判断健康状况。建议仅供参考，不构成医疗建议。",
}


class MockProvider:
    def __init__(self):
        self.calls = []
        self.error = None
        self.entered = threading.Event()
        self.release = None

    def generate(self, snapshot, settings):
        from app.modules.ai_reports.provider import request_body
        from app.modules.ai_reports.schema import ProviderResult

        self.calls.append(request_body(snapshot, settings.ai_model))
        self.entered.set()
        if self.release:
            assert self.release.wait(8)
        if self.error:
            raise self.error
        return ProviderResult(analysis=TEXT)


@pytest.fixture
def ai_clients():
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.skip("Explicit isolated database required")
    settings = Settings(
        database_url=url,
        site_origin="http://127.0.0.1:5183",
        auth_rate_hash_key=uuid4().hex,
        ai_base_url="http://127.0.0.1:1/v1",
        ai_model="mock-only",
        ai_api_key="test-only",
        _env_file=None,
    )
    app = create_app(settings.model_copy())
    other_app = create_app(settings.model_copy())
    other_app.state.clock = lambda: app.state.clock()
    provider = MockProvider()
    app.state.ai_provider = provider
    other_app.state.ai_provider = provider
    with (
        TestClient(app, base_url=settings.site_origin) as a,
        TestClient(other_app, base_url=settings.site_origin) as b,
    ):
        yield a, b, app, provider


def seed(app, owner):
    with app.state.session_factory.begin() as db:
        for day, distance, elapsed, quality in [
            ("2024-01-01", 1000, 600, "complete"),
            ("2024-01-08", 1500, 750, "complete"),
            ("2024-01-15", 2000, None, "incomplete"),
            ("2024-01-22", 2500, 1250, "complete"),
        ]:
            db.add(
                Activity(
                    user_id=owner,
                    source="manual",
                    title="Secret title",
                    notes="Secret notes",
                    activity_date=date.fromisoformat(day),
                    date_source="manual",
                    timezone="Asia/Shanghai",
                    distance_m=distance,
                    elapsed_seconds=elapsed,
                    avg_pace_seconds_per_km=None,
                    temporal_quality=quality,
                    quality_summary={"warnings": ["missing"] if elapsed is None else []},
                    metrics_version="test-v1",
                )
            )
        user = db.get(User, UUID(owner))
        user.activity_data_version += 1


def post(a, key=None, payload=None):
    return a.post(
        "/api/v1/ai-reports",
        headers={**headers(a), "Idempotency-Key": str(key or uuid4())},
        json=payload or PAYLOAD,
    )


def test_device_snapshot_weights_timer_and_preserves_missing_zero_and_owner_scope(ai_clients):
    a, b, app, provider = ai_clients
    owner, other = register(a), register(b)
    seed(app, owner)
    seed(app, other)
    with app.state.session_factory.begin() as db:
        rows = db.scalars(
            select(Activity).where(Activity.user_id == owner).order_by(Activity.activity_date)
        ).all()
        rows[0].avg_heart_rate_bpm = 120
        rows[0].calories_kcal = 100
        rows[0].steps = 1000
        rows[1].activity_date = date(2024, 1, 2)
        rows[1].elapsed_seconds = 1200
        rows[1].timer_seconds = 600
        rows[1].avg_heart_rate_bpm = 180
        rows[1].steps = 0
        rows[2].avg_heart_rate_bpm = 200
        rows[2].calories_kcal = 0
        other_row = db.scalar(select(Activity).where(Activity.user_id == other))
        other_row.avg_heart_rate_bpm = 300
        other_row.calories_kcal = 99999
        other_row.steps = 99999
        # End date is exclusive, even if all device fields are available.
        db.add(
            Activity(
                user_id=owner,
                source="manual",
                title="Excluded boundary",
                activity_date=date(2024, 1, 29),
                date_source="manual",
                timezone="UTC",
                distance_m=1000,
                elapsed_seconds=600,
                avg_heart_rate_bpm=300,
                calories_kcal=99999,
                steps=99999,
                temporal_quality="manual",
                quality_summary={"warnings": []},
                metrics_version="test-v1",
            )
        )
    preview = a.get("/api/v1/ai-reports/context?date_from=2024-01-01&date_to=2024-01-29")
    assert preview.status_code == 200, preview.text
    assert not provider.calls  # Reading facts never calls the model.
    snapshot = preview.json()["data"]["stats_snapshot"]
    assert snapshot["schema_version"] == "running-summary-v2"
    assert snapshot["device_metrics"] == {
        "heart_rate_record_count": 3,
        "heart_rate_weighted_count": 2,
        "heart_rate_weighted_duration_seconds": "1200.000",
        "avg_heart_rate_bpm": "150.000",
        "calories_record_count": 2,
        "calories_kcal": 100,
        "steps_record_count": 2,
        "steps": 1000,
    }
    weeks = snapshot["weeks"]
    assert weeks[0]["device_metrics"]["avg_heart_rate_bpm"] == "150.000"
    assert weeks[0]["device_metrics"]["heart_rate_record_count"] == 2
    assert weeks[1]["activity_count"] == 0
    assert weeks[1]["device_metrics"]["calories_kcal"] is None
    assert weeks[1]["device_metrics"]["heart_rate_record_count"] == 0
    assert weeks[2]["device_metrics"]["heart_rate_record_count"] == 1
    assert weeks[2]["device_metrics"]["avg_heart_rate_bpm"] is None
    assert weeks[2]["device_metrics"]["calories_kcal"] == 0
    generated = post(a)
    assert generated.status_code == 201, generated.text
    report = generated.json()["data"]
    sent = json.loads(provider.calls[0]["messages"][1]["content"])
    assert sent["device_metrics"]["avg_heart_rate_bpm"] == "150.000"
    assert sent["weeks"][0]["device_metrics"]["steps"] == 1000
    with app.state.session_factory.begin() as db:
        db.get(Activity, rows[0].id).avg_heart_rate_bpm = 240
        db.get(User, UUID(owner)).activity_data_version += 1
    saved = a.get("/api/v1/ai-reports/" + report["id"]).json()["data"]
    assert saved["stats_snapshot"]["device_metrics"]["avg_heart_rate_bpm"] == "150.000"
    assert saved["is_stale"] is True
    assert len(provider.calls) == 1
    assert b.get("/api/v1/ai-reports/" + report["id"]).status_code == 404


def test_zero_device_timer_excludes_heart_rate_without_falling_back_to_wall_time(ai_clients):
    a, _, app, _ = ai_clients
    owner = register(a)
    seed(app, owner)
    with app.state.session_factory.begin() as db:
        row = db.scalar(
            select(Activity).where(Activity.user_id == owner).order_by(Activity.activity_date)
        )
        row.timer_seconds = 0
        row.avg_heart_rate_bpm = 156
    snapshot = a.get("/api/v1/ai-reports/context?date_from=2024-01-01&date_to=2024-01-29").json()[
        "data"
    ]["stats_snapshot"]
    metrics = snapshot["device_metrics"]
    assert metrics["heart_rate_record_count"] == 1
    assert metrics["heart_rate_weighted_count"] == 0
    assert metrics["avg_heart_rate_bpm"] is None
    assert metrics["heart_rate_weighted_duration_seconds"] is None
    assert metrics["calories_record_count"] == 0 and metrics["calories_kcal"] is None
    assert metrics["steps_record_count"] == 0 and metrics["steps"] is None


def test_overall_heart_rate_uses_duration_instead_of_mean_of_weekly_means(ai_clients):
    a, _, app, _ = ai_clients
    owner = register(a)
    seed(app, owner)
    with app.state.session_factory.begin() as db:
        rows = db.scalars(
            select(Activity).where(Activity.user_id == owner).order_by(Activity.activity_date)
        ).all()
        rows[0].avg_heart_rate_bpm = 120  # 600 seconds
        rows[1].avg_heart_rate_bpm = 180  # 750 seconds in a different week
    snapshot = a.get("/api/v1/ai-reports/context?date_from=2024-01-01&date_to=2024-01-29").json()[
        "data"
    ]["stats_snapshot"]
    assert snapshot["device_metrics"]["avg_heart_rate_bpm"] == "153.333"
    assert snapshot["device_metrics"]["heart_rate_weighted_duration_seconds"] == "1350.000"
    assert snapshot["weeks"][0]["device_metrics"]["avg_heart_rate_bpm"] == "120.000"
    assert snapshot["weeks"][1]["device_metrics"]["avg_heart_rate_bpm"] == "180.000"


def test_legacy_report_remains_readable_without_rewriting_or_provider_call(ai_clients):
    from app.modules.ai_reports.model import AIReport

    a, _, app, provider = ai_clients
    owner = register(a)
    seed(app, owner)
    created = post(a).json()["data"]
    legacy = created["stats_snapshot"]
    legacy["schema_version"] = "running-summary-v1"
    legacy.pop("device_metrics")
    for week in legacy["weeks"]:
        week.pop("device_metrics")
    with app.state.session_factory.begin() as db:
        row = db.get(AIReport, UUID(created["id"]))
        row.stats_snapshot = legacy
        row.prompt_version = "running-qualitative-v1"
    saved = a.get("/api/v1/ai-reports/" + created["id"]).json()["data"]
    assert saved["stats_snapshot"] == legacy
    assert saved["analysis"] == TEXT
    assert saved["prompt_version"] == "running-qualitative-v1"
    assert len(provider.calls) == 1


def test_end_to_end_snapshot_isolation_and_idempotency(ai_clients):
    a, b, app, provider = ai_clients
    owner, other = register(a), register(b)
    seed(app, owner)
    seed(app, other)
    key = uuid4()
    r = post(a, key)
    assert r.status_code == 201, r.text
    report = r.json()["data"]
    facts = report["stats_snapshot"]
    assert facts["summary"]["distance_m"] == "7000.000"
    assert facts["summary"]["activity_count"] == 4
    assert facts["summary"]["avg_pace_seconds_per_km"] == "520.000"
    assert facts["summary"]["missing_duration_count"] == 1
    assert [w["distance_change_pct"] for w in facts["weeks"]] == [
        None,
        "50.000",
        "33.333",
        "25.000",
    ]
    assert facts["average_runs_per_week"] == "1.000"
    assert post(a, key).status_code == 200 and len(provider.calls) == 1
    path = "/api/v1/ai-reports/" + report["id"]
    assert a.get(path).json()["data"]["analysis"] == TEXT
    assert b.get(path).status_code == 404
    assert b.delete(path, headers=headers(b)).status_code == 404
    assert b.get("/api/v1/ai-reports").json()["data"]["total"] == 0
    sent = provider.calls[0]["messages"][1]["content"]
    assert all(
        value not in sent
        for value in [
            owner,
            other,
            "Secret",
            "email",
            "username",
            "coordinates",
            "raw_gpx",
            "started_at",
        ]
    )
    seed(app, owner)
    assert a.get(path).json()["data"]["is_stale"] is True
    assert a.delete(path, headers=headers(a)).status_code == 200
    assert a.get(path).status_code == 404
    assert post(a, key).status_code == 409
    assert a.get("/api/v1/ai-reports").json()["data"]["total"] == 0
    from app.modules.ai_reports.model import AIReport

    with app.state.session_factory() as db:
        stored = db.get(AIReport, UUID(report["id"]))
        assert stored.stats_snapshot == {} and stored.report_text is None


def test_consent_validation_unconfigured_empty_and_sparse(ai_clients):
    a, _, app, provider = ai_clients
    assert a.get("/api/v1/ai-reports").status_code == 401
    owner = register(a)
    assert post(a, payload={**PAYLOAD, "consent_to_send_summary": False}).status_code == 422
    assert a.post("/api/v1/ai-reports", json=PAYLOAD).status_code == 403
    assert a.post("/api/v1/ai-reports", json=PAYLOAD, headers=headers(a)).status_code == 422
    assert post(a, payload={**PAYLOAD, "date_from": "2024-01-02"}).status_code == 422
    assert post(a).status_code == 422
    assert not provider.calls
    seed(app, owner)
    app.state.settings.ai_api_key = None
    assert post(a).status_code == 503
    assert (
        a.get("/api/v1/ai-reports/context?date_from=2024-01-01&date_to=2024-01-29").json()["data"][
            "configured"
        ]
        is False
    )
    assert not provider.calls


@pytest.mark.parametrize(
    "code,status", [("AI_TIMEOUT", 503), ("AI_PROVIDER_ERROR", 502), ("AI_OUTPUT_INVALID", 502)]
)
def test_failure_is_persisted_and_replayed_without_new_charge(ai_clients, code, status):
    a, _, app, provider = ai_clients
    seed(app, register(a))
    provider.error = ApiError(status, code, "safe error")
    key = uuid4()
    r = post(a, key)
    assert r.status_code == status
    identifier = r.json()["error"]["details"][0]["report_id"]
    assert a.get("/api/v1/ai-reports/" + identifier).json()["data"]["status"] == "failed"
    assert post(a, key).status_code == 200 and len(provider.calls) == 1
    provider.error = None
    assert post(a).status_code == 201


def test_daily_quota_includes_deleted_failures_and_completed_replay(ai_clients):
    a, _, app, provider = ai_clients
    seed(app, register(a))
    app.state.settings.ai_daily_limit = 2
    key = uuid4()
    report = post(a, key).json()["data"]
    provider.error = ApiError(502, "AI_PROVIDER_ERROR", "safe")
    failed = post(a)
    assert failed.status_code == 502
    assert (
        a.delete(
            "/api/v1/ai-reports/" + failed.json()["error"]["details"][0]["report_id"],
            headers=headers(a),
        ).status_code
        == 200
    )
    r = post(a)
    assert r.status_code == 429 and int(r.headers["Retry-After"]) > 0
    assert post(a, key).json()["data"]["id"] == report["id"]
    assert len(provider.calls) == 2
    assert post(a, key, {**PAYLOAD, "date_to": "2024-02-05"}).status_code == 409


def test_pending_concurrency_expiry_and_late_response(ai_clients):
    a, b, app, provider = ai_clients
    owner = register(a)
    seed(app, owner)
    # Same authenticated session, independent HTTP worker/DB sessions.
    b.app.state.settings.site_owner_email = a.app.state.settings.site_owner_email
    b.cookies.update(a.cookies)
    provider.release = threading.Event()
    key = uuid4()
    with ThreadPoolExecutor(1) as pool:
        pending = pool.submit(post, a, key)
        assert provider.entered.wait(5)
        assert post(b, key).status_code == 409
        assert post(b).status_code == 409
        listing = b.get("/api/v1/ai-reports").json()["data"]
        identifier = listing["items"][0]["id"]
        assert b.delete("/api/v1/ai-reports/" + identifier, headers=headers(b)).status_code == 409
        # Emulate a crash deadline while the late provider is still running.
        app.state.clock = lambda: datetime.now(UTC) + timedelta(minutes=5)
        assert b.get("/api/v1/ai-reports/" + identifier).json()["data"]["status"] == "failed"
        provider.release.set()
        assert pending.result().status_code == 503
    assert b.get("/api/v1/ai-reports/" + identifier).json()["data"]["status"] == "failed"
    assert len(provider.calls) == 1


@pytest.mark.parametrize(
    "distances,elapsed,limited,last_change,pace",
    [
        ([1000, 2000, 3000, 4000], 600, False, "33.333", "240.000"),
        ([4000, 3000, 2000, 1000], 600, False, "-50.000", "240.000"),
        ([0, 0, 0, 1000], 600, True, None, "600.000"),
        ([1000, 2000, 3000, 4000], None, False, "33.333", None),
    ],
)
def test_real_statistics_cases(ai_clients, distances, elapsed, limited, last_change, pace):
    a, _, app, _ = ai_clients
    owner = register(a)
    with app.state.session_factory.begin() as db:
        for index, distance in enumerate(distances):
            if distance == 0:
                continue
            db.add(
                Activity(
                    user_id=owner,
                    source="manual",
                    title="private",
                    activity_date=date(2024, 1, 1) + timedelta(weeks=index),
                    date_source="manual",
                    timezone="UTC",
                    distance_m=distance,
                    elapsed_seconds=elapsed,
                    avg_pace_seconds_per_km=None,
                    temporal_quality="manual" if elapsed else "incomplete",
                    quality_summary={"warnings": ["missing"] if elapsed is None else []},
                    metrics_version="test-v1",
                )
            )
    r = post(a)
    assert r.status_code == 201
    snapshot = r.json()["data"]["stats_snapshot"]
    assert snapshot["evidence_limited"] is limited
    assert snapshot["weeks"][-1]["distance_change_pct"] == last_change
    assert snapshot["summary"]["avg_pace_seconds_per_km"] == pace
    if elapsed is None:
        assert snapshot["summary"]["quality_warning_count"] == 4
        assert snapshot["summary"]["missing_duration_count"] == 4


def test_snapshot_version_lock_and_connection_release(ai_clients):
    a, _, app, provider = ai_clients
    owner = register(a)
    seed(app, owner)

    def during_call(snapshot, settings):
        # A separate committed write can acquire the user lock while the provider runs.
        with app.state.session_factory.begin() as db:
            user = db.scalar(select(User).where(User.id == owner).with_for_update())
            user.activity_data_version += 1
        from app.modules.ai_reports.schema import ProviderResult

        return ProviderResult(analysis=TEXT)

    provider.generate = during_call
    r = post(a)
    assert r.status_code == 201 and r.json()["data"]["is_stale"] is True
    assert r.json()["data"]["stats_snapshot"]["summary"]["activity_count"] == 4


def test_invalid_injected_output_becomes_failed_without_text(ai_clients):
    a, _, app, provider = ai_clients
    seed(app, register(a))
    provider.generate = lambda *_: {"analysis": {**TEXT, "trend_summary": "虚构999公里"}}
    r = post(a)
    assert r.status_code == 502 and r.json()["error"]["code"] == "AI_OUTPUT_INVALID"
    item = a.get("/api/v1/ai-reports").json()["data"]["items"][0]
    assert item["analysis"] is None and item["status"] == "failed"


def test_independent_app_workers_share_pending_guard(ai_clients):
    a, _, app, provider = ai_clients
    seed(app, register(a))
    provider.release = threading.Event()
    worker = create_app(app.state.settings)
    worker.state.ai_provider = provider
    with TestClient(worker, base_url=app.state.settings.site_origin) as b:
        b.app.state.settings.site_owner_email = a.app.state.settings.site_owner_email
        b.cookies.update(a.cookies)
        with ThreadPoolExecutor(1) as pool:
            pending = pool.submit(post, a)
            assert provider.entered.wait(5)
            assert post(b).status_code == 409
            provider.release.set()
            assert pending.result().status_code == 201
    assert len(provider.calls) == 1


def test_snapshot_and_version_remain_consistent_during_concurrent_write(ai_clients, monkeypatch):
    from app.modules.statistics import service as stats

    a, _, app, provider = ai_clients
    owner = register(a)
    seed(app, owner)
    original = stats.summary
    started, finished = threading.Event(), threading.Event()
    pool = ThreadPoolExecutor(1)
    future = None

    def edit():
        with app.state.session_factory.begin() as db:
            started.set()
            user = db.scalar(select(User).where(User.id == owner).with_for_update())
            activity = db.scalar(
                select(Activity).where(Activity.user_id == owner).order_by(Activity.activity_date)
            )
            activity.distance_m = 9999
            user.activity_data_version += 1
        finished.set()

    def wrapped(*args, **kwargs):
        nonlocal future
        result = original(*args, **kwargs)
        future = pool.submit(edit)
        assert started.wait(3)
        assert not finished.wait(0.1)
        return result

    monkeypatch.setattr(stats, "summary", wrapped)

    def generate(snapshot, settings):
        from app.modules.ai_reports.schema import ProviderResult

        future.result(timeout=4)
        return ProviderResult(analysis=TEXT)

    provider.generate = generate
    try:
        r = post(a)
        assert r.status_code == 201 and r.json()["data"]["is_stale"] is True
        snapshot = r.json()["data"]["stats_snapshot"]
        assert snapshot["summary"]["distance_m"] == "7000.000"
        assert sum(float(w["distance_m"]) for w in snapshot["weeks"]) == 7000
    finally:
        pool.shutdown()
