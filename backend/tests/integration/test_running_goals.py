from decimal import Decimal
from uuid import UUID

import pytest
from sqlalchemy import text

from tests.integration.test_gpx_import import clients, headers, register  # noqa: F401

pytestmark = pytest.mark.integration
PATH = "/api/v1/me/running-goals"


def test_goals_persist_across_sessions_and_are_private(clients):  # noqa: F811
    a, b, engine, _ = clients
    owner = register(a)
    register(b)
    assert a.get(PATH).json()["data"] == {"week": None, "month": None, "year": None}
    for period, target in [("week", 5.5), ("month", 50), ("year", 500)]:
        response = a.put(f"{PATH}/{period}", headers=headers(a), json={"target_km": target})
        assert response.status_code == 200, response.text
        assert float(response.json()["data"]["target_km"]) == target
    assert b.get(PATH).json()["data"] == {"week": None, "month": None, "year": None}
    assert a.put(f"{PATH}/week", headers=headers(a), json={"target_km": 10}).status_code == 200
    assert {k: float(v) for k, v in a.get(PATH).json()["data"].items()} == {
        "week": 10,
        "month": 50,
        "year": 500,
    }
    with engine.connect() as db:
        rows = db.execute(
            text("SELECT period,target_km FROM running_goals WHERE user_id=:owner"),
            {"owner": UUID(owner)},
        ).all()
        assert dict(rows) == {"week": Decimal("10"), "month": Decimal("50"), "year": Decimal("500")}
    from fastapi.testclient import TestClient

    with TestClient(a.app, base_url="http://127.0.0.1:5183") as fresh:
        response = fresh.post(
            "/api/v1/auth/login",
            headers=headers(fresh),
            json={
                "email": a.get("/api/v1/me").json()["data"]["email"],
                "password": "Synthetic-password-2026",
            },
        )
        assert response.status_code == 200
        assert float(fresh.get(PATH).json()["data"]["week"]) == 10
    a.cookies.clear()
    assert a.get(PATH).status_code == 401
    assert a.put(f"{PATH}/week", json={"target_km": 5}).status_code == 401


@pytest.mark.parametrize("value", [0, -1, 100001, 5.55, "5", True, None])
def test_goal_validation_does_not_change_saved_value(clients, value):  # noqa: F811
    a, _, _, _ = clients
    register(a)
    assert a.put(f"{PATH}/week", headers=headers(a), json={"target_km": 5}).status_code == 200
    response = a.put(f"{PATH}/week", headers=headers(a), json={"target_km": value})
    assert response.status_code == 422
    assert float(a.get(PATH).json()["data"]["week"]) == 5


def test_goal_writes_require_csrf_and_reject_owner_override(clients):  # noqa: F811
    a, b, _, _ = clients
    register(a)
    other = register(b)
    for overrides in [{"Origin": "https://evil.example"}, {"X-CSRF-Token": "bad"}]:
        response = a.put(f"{PATH}/week", headers={**headers(a), **overrides}, json={"target_km": 5})
        assert response.status_code == 403
    assert a.put(f"{PATH}/week", json={"target_km": 5}).status_code == 403
    assert a.put(f"{PATH}/day", headers=headers(a), json={"target_km": 5}).status_code == 422
    response = a.put(f"{PATH}/week", headers=headers(a), json={"target_km": 5, "user_id": other})
    assert response.status_code == 422
    assert a.get(PATH).json()["data"]["week"] is None


def test_first_concurrent_saves_keep_one_goal_per_period(clients):  # noqa: F811
    from concurrent.futures import ThreadPoolExecutor

    a, _, engine, _ = clients
    owner = register(a)
    csrf = headers(a)
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(
            pool.map(
                lambda target: a.put(f"{PATH}/week", headers=csrf, json={"target_km": target}),
                [10, 20],
            )
        )
    assert all(response.status_code == 200 for response in responses)
    assert a.get(PATH).json()["data"]["week"] in [10, 20]
    with engine.connect() as db:
        assert (
            db.scalar(
                text("SELECT count(*) FROM running_goals WHERE user_id=:owner"),
                {"owner": UUID(owner)},
            )
            == 1
        )
