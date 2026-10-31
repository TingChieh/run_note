import csv
import io
import json
from datetime import date, timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import text

from tests.conftest import (  # noqa: F401
    ORIGIN,
    clients,
    headers,
    register,
    upload,
)

pytestmark = pytest.mark.integration
BASE = "/api/v1/me/wellbeing"
DAY = "2025-10-10"
QUERY = f"from={DAY}&to={DAY}"
PRIVATE_KEYS = {
    "mood",
    "anxiety",
    "energy",
    "focus",
    "functioning",
    "sleep_hours",
    "sleep_quality",
    "medication_name",
    "medication_id",
    "dose_amount",
    "dose_unit",
    "taken_at",
    "regimen",
    "side_effects",
    "symptom",
    "severity",
    "onset_at",
    "duration_minutes",
    "affects_daily_life",
    "wellbeing",
    "doses",
    "symptoms",
}


def assert_private_absent(value, markers):
    if isinstance(value, dict):
        assert not (set(value) & PRIVATE_KEYS), set(value) & PRIVATE_KEYS
        for child in value.values():
            assert_private_absent(child, markers)
    elif isinstance(value, list):
        for child in value:
            assert_private_absent(child, markers)
    elif isinstance(value, str):
        assert all(marker not in value for marker in markers), value


def seed(client, label):
    markers = [
        f"{label}-entry-secret",
        f"{label}-medicine-secret",
        f"{label}-effect-secret",
        f"{label}-dose-note",
    ]
    entry = client.put(
        f"{BASE}/days/{DAY}/entry",
        headers=headers(client),
        json={
            "mood": 7,
            "anxiety": 4,
            "energy": 3,
            "note": markers[0],
        },
    )
    assert entry.status_code == 200, entry.text
    dose = client.post(
        f"{BASE}/doses",
        headers=headers(client),
        json={
            "medication_name": markers[1],
            "dose_amount": 5,
            "dose_unit": "mg",
            "taken_at": f"{DAY}T08:00:00+08:00",
            "regimen": "scheduled",
            "note": markers[3],
        },
    )
    assert dose.status_code == 201, dose.text
    symptom = client.post(
        f"{BASE}/symptoms",
        headers=headers(client),
        json={
            "entry_date": DAY,
            "symptom": markers[2],
            "severity": 6,
        },
    )
    assert symptom.status_code == 201, symptom.text
    return markers, entry.json()["data"], dose.json()["data"], symptom.json()["data"]


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("get", f"/days?{QUERY}", None),
        ("get", f"/days/{DAY}", None),
        ("put", f"/days/{DAY}/entry", {"mood": 1}),
        ("delete", f"/days/{DAY}/entry", None),
        ("get", "/entries", None),
        ("get", "/medications", None),
        ("post", "/medications", {"name": "synthetic"}),
        ("patch", f"/medications/{uuid4()}", {"name": "synthetic"}),
        ("delete", f"/medications/{uuid4()}", None),
        ("post", f"/medications/{uuid4()}/stock", {"pills": 1}),
        ("post", f"/medications/{uuid4()}/stock/count", {"pills": 1}),
        ("get", "/symptom-names", None),
        ("post", "/symptom-names", {"name": "synthetic"}),
        ("delete", f"/symptom-names/{uuid4()}", None),
        ("post", "/doses/batch", {}),
        ("post", "/doses", {}),
        ("patch", f"/doses/{uuid4()}", {"note": "synthetic"}),
        ("delete", f"/doses/{uuid4()}", None),
        ("post", "/symptoms", {}),
        ("patch", f"/symptoms/{uuid4()}", {"severity": 1}),
        ("delete", f"/symptoms/{uuid4()}", None),
        ("get", "/trends", None),
        ("get", f"/report?{QUERY}", None),
        ("get", f"/report.csv?{QUERY}", None),
    ],
)
def test_anonymous_journal_routes_are_denied(clients, method, path, body):  # noqa: F811
    client, _, _, _ = clients
    response = client.request(method, BASE + path, **({} if body is None else {"json": body}))
    assert response.status_code in ((401,) if method == "get" else (401, 403)), (
        method,
        path,
        response.text,
    )


def test_other_user_cannot_read_or_change_journal_by_date_or_id(clients):  # noqa: F811
    a, b, engine, _ = clients
    owner = register(a)
    register(b)
    markers, _, dose, symptom = seed(a, "owner-a")
    with engine.connect() as db:
        entry_id = db.scalar(
            text("SELECT id FROM wellbeing_daily_entries WHERE user_id=:owner"),
            {"owner": owner},
        )
    before = a.get(f"{BASE}/days/{DAY}").json()["data"]
    for path in (
        f"/days/{DAY}",
        f"/days?{QUERY}",
        "/entries",
        "/medications",
        "/symptom-names",
        f"/report?{QUERY}",
        "/trends",
    ):
        response = b.get(BASE + path)
        assert response.status_code == 200, response.text
        assert all(marker not in response.text for marker in markers)
    assert b.get(f"{BASE}/days/{DAY}").json()["data"]["entry"] is None
    assert b.delete(f"{BASE}/days/{DAY}/entry", headers=headers(b)).status_code == 404
    # Daily entries have no id-based endpoint; event IDs support writes only.
    for path in (f"/entries/{entry_id}", f"/doses/{dose['id']}", f"/symptoms/{symptom['id']}"):
        assert b.get(BASE + path).status_code in (404, 405)
    for kind, record, payload in (
        ("doses", dose, {"note": "tampered"}),
        ("symptoms", symptom, {"severity": 1}),
    ):
        path = f"{BASE}/{kind}/{record['id']}"
        assert b.patch(path, headers=headers(b), json=payload).status_code == 404
        assert b.delete(path, headers=headers(b)).status_code == 404
    assert (
        b.put(f"{BASE}/days/{DAY}/entry", headers=headers(b), json={"note": "owner-b"}).status_code
        == 200
    )
    assert a.get(f"{BASE}/days/{DAY}").json()["data"] == before


@pytest.mark.parametrize("kind,index", [("entries", 0), ("doses", 1), ("symptoms", 2)])
def test_csv_exports_only_current_users_rows(clients, kind, index):  # noqa: F811
    a, b, _, _ = clients
    owner_a = register(a)
    owner_b = register(b)
    a_markers, *_ = seed(a, "owner-a")
    b_markers, *_ = seed(b, "owner-b")
    path = f"{BASE}/report.csv?{QUERY}&kind={kind}"
    with TestClient(a.app, base_url=ORIGIN) as anonymous:
        assert anonymous.get(path).status_code == 401
    for client, own, other, foreign_id in (
        (a, a_markers, b_markers, owner_b),
        (b, b_markers, a_markers, owner_a),
    ):
        response = client.get(path)
        assert response.status_code == 200, response.text
        rows = list(csv.reader(io.StringIO(response.content.decode("utf-8-sig"))))
        assert len(rows) == 2
        assert own[index] in rows[1]
        assert all(marker not in response.text for marker in other)
        # An owner override must not turn the current-user export into another user's export.
        override = client.get(path + f"&user_id={foreign_id}")
        assert override.status_code == 200
        assert own[index] in override.text
        assert all(marker not in override.text for marker in other)


def test_admin_deleting_user_cascades_wellbeing_without_affecting_other_user(clients):  # noqa: F811
    # There is no user self-deletion API; account removal uses admin batch-delete.
    admin, victim, engine, _ = clients
    admin_id = register(admin)
    victim_id = register(victim)
    for client, label in ((admin, "survivor"), (victim, "deleted")):
        seed(client, label)
        medications = client.get(f"{BASE}/medications").json()["data"]
        response = client.post(
            f"{BASE}/medications/{medications[0]['id']}/stock",
            headers=headers(client),
            json={"pills": 5},
        )
        assert response.status_code == 200, response.text

    tables = (
        "wellbeing_daily_entries",
        "wellbeing_dose_events",
        "wellbeing_symptom_events",
        "wellbeing_medications",
        "wellbeing_stock_movements",
        "wellbeing_symptom_names",
    )

    def snapshot(owner):
        with engine.connect() as db:
            return {
                table: db.execute(
                    text(f"SELECT to_jsonb(t) FROM {table} t WHERE user_id=:owner ORDER BY id"),
                    {"owner": owner},
                )
                .scalars()
                .all()
                for table in tables
            }

    before_admin, before_victim = snapshot(admin_id), snapshot(victim_id)
    assert all(before_admin.values()) and all(before_victim.values())
    response = admin.post(
        "/api/v1/admin/users/batch-delete", headers=headers(admin), json={"ids": [victim_id]}
    )
    assert response.status_code == 200, response.text
    assert response.json()["data"] == {"deleted": True, "deleted_count": 1}
    assert all(not rows for rows in snapshot(victim_id).values())
    assert snapshot(admin_id) == before_admin
    assert victim.get("/api/v1/me").status_code == 401


def test_public_sharing_showcase_poster_sources_and_ai_exclude_journal(clients):  # noqa: F811
    a, _, _, app = clients
    register(a)
    markers, *_ = seed(a, f"privacy-{uuid4().hex[:16]}")
    assert (
        a.patch("/api/v1/me", headers=headers(a), json={"profile_is_public": True}).status_code
        == 200
    )
    username = a.get("/api/v1/me").json()["data"]["username"]
    result = upload(a)
    assert result.status_code == 201, result.text
    activity = result.json()["data"]["activity"]
    identifier = activity["id"]
    assert (
        a.patch(
            f"/api/v1/activities/{identifier}", headers=headers(a), json={"visibility": "public"}
        ).status_code
        == 200
    )
    share = a.post(f"/api/v1/activities/{identifier}/shares", headers=headers(a), json={})
    assert share.status_code == 201, share.text
    token = share.json()["data"]["share_url"].rsplit("/", 1)[1]
    year = activity["activity_date"][:4]
    suffixes = [
        "/profile",
        "/activities",
        f"/activities/{identifier}",
        f"/activities/{identifier}/route",
        "/statistics/summary",
        f"/statistics/calendar?year={year}",
        "/statistics/records",
        "/statistics/streaks",
        "/running-goals",
        "/footprints/all",
        "/ai-reports",
    ]
    public = [
        f"/api/v1/public/users/{username}",
        f"/api/v1/public/users/{username}/calendar?year={year}",
        f"/api/v1/public/users/{username}/activities",
        f"/api/v1/public/activities/{identifier}",
        f"/api/v1/shared/{token}",
    ]
    public += [f"/api/v1/showcase{suffix}" for suffix in suffixes]
    public += [f"/api/v1/showcase/users/{username}{suffix}" for suffix in suffixes]
    with TestClient(app, base_url=ORIGIN) as anonymous:
        for path in public:
            response = anonymous.get(path)
            assert response.status_code == 200, (path, response.text)
            if path in (
                "/api/v1/showcase/activities",
                f"/api/v1/showcase/users/{username}/activities",
            ):
                assert any(item["id"] == identifier for item in response.json()["data"]["items"])
            assert all(marker not in response.text for marker in markers), path
            assert_private_absent(response.json(), markers)
    # Both report generation and the context endpoint call ai_reports.service.build_snapshot.
    from app.modules.ai_reports.provider import request_body

    sent = []

    class MockProvider:
        def generate(self, snapshot, settings):
            sent.append(request_body(snapshot, settings.ai_model))
            return {
                "analysis": {
                    "trend_summary": "记录覆盖有限，暂时无法判断趋势。",
                    "recommendations": ["结合恢复情况保持轻松活动。"],
                    "limitations": "分析仅依据已知汇总，建议仅供参考，不构成医疗建议。",
                }
            }

    app.state.settings.ai_base_url = "http://127.0.0.1:1/v1"
    app.state.settings.ai_model = "mock-only"
    app.state.settings.ai_api_key = SecretStr("test-only")
    app.state.ai_provider = MockProvider()
    activity_day = date.fromisoformat(activity["activity_date"])
    week_start = activity_day - timedelta(days=activity_day.weekday())
    generated = a.post(
        "/api/v1/ai-reports",
        headers={**headers(a), "Idempotency-Key": str(uuid4())},
        json={
            "date_from": week_start.isoformat(),
            "date_to": (week_start + timedelta(days=7)).isoformat(),
            "consent_to_send_summary": True,
        },
    )
    assert generated.status_code == 201, generated.text
    assert len(sent) == 1
    assert_private_absent(json.loads(sent[0]["messages"][1]["content"]), markers)
    assert all(marker not in json.dumps(sent[0], ensure_ascii=False) for marker in markers)
    # Poster data are built in the browser from these authenticated activity/route/statistics APIs.
    for path in (
        "/api/v1/activities",
        f"/api/v1/activities/{identifier}",
        f"/api/v1/activities/{identifier}/route",
        "/api/v1/statistics/summary",
        "/api/v1/ai-reports/context",
        "/api/v1/ai-reports",
    ):
        response = a.get(path)
        assert response.status_code == 200, (path, response.text)
        assert all(marker not in response.text for marker in markers), path
        assert_private_absent(response.json(), markers)


def test_other_user_cannot_change_medication_stock_or_symptom_names(clients):  # noqa: F811
    a, b, _, _ = clients
    register(a)
    register(b)
    medication = a.post(f"{BASE}/medications", headers=headers(a), json={"name": "owner-a-med"})
    assert medication.status_code == 201, medication.text
    med_id = medication.json()["data"]["id"]
    added = a.post(f"{BASE}/medications/{med_id}/stock", headers=headers(a), json={"pills": 5})
    assert added.status_code == 200, added.text
    symptom = a.post(f"{BASE}/symptom-names", headers=headers(a), json={"name": "owner-a-symptom"})
    assert symptom.status_code == 201, symptom.text
    symptom_id = symptom.json()["data"]["id"]
    paths = ("/medications", "/symptom-names")
    before = [a.get(BASE + path).json()["data"] for path in paths]
    for method, path, body in (
        ("patch", f"/medications/{med_id}", {"name": "tampered"}),
        ("delete", f"/medications/{med_id}", None),
        ("post", f"/medications/{med_id}/stock", {"pills": 3}),
        ("post", f"/medications/{med_id}/stock/count", {"pills": 0}),
        ("delete", f"/symptom-names/{symptom_id}", None),
    ):
        response = b.request(
            method, BASE + path, headers=headers(b), **({} if body is None else {"json": body})
        )
        assert response.status_code == 404, (method, path, response.text)
        assert [a.get(BASE + p).json()["data"] for p in paths] == before
