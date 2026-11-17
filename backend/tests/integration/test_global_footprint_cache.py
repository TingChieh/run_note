"""Per-activity global region & city cache: live vs cached parity and Taiwan attribution."""

# ruff: noqa: F811

from datetime import date
from uuid import UUID

import pytest
from sqlalchemy import text

from app.modules.footprints import global_atlas as module
from tests.conftest import clients, register  # noqa: F401
from tests.integration.test_footprints import add_activity

pytestmark = pytest.mark.integration

SHANGHAI = [(121.45, 31.20), (121.50, 31.25)]
TAIPEI = [(121.55, 25.03), (121.57, 25.04)]
TOKYO = [(139.69, 35.68), (139.71, 35.69)]


def quiet(*test_clients):
    for client in test_clients:
        client.app.state.footprint_worker.stop()


def cache_rows(app, owner):
    with app.state.session_factory() as db:
        return db.scalar(
            text("SELECT count(*) FROM activity_global_footprint_caches WHERE user_id=:o"),
            {"o": UUID(owner)},
        )


def read(client, year=None):
    response = client.get("/api/v1/footprints/global" + (f"?year={year}" if year else ""))
    assert response.status_code == 200, response.text
    return response.json()["data"]


def test_taipei_lights_up_china_and_taiwan_province_without_separate_country(clients):  # noqa: F401
    a, b, _, app = clients
    quiet(a, b)
    owner = register(a)
    add_activity(app, owner, [SHANGHAI], day=date(2025, 4, 1), geographic=True)
    add_activity(app, owner, [TAIPEI], day=date(2025, 4, 2), geographic=True)
    add_activity(app, owner, [TOKYO], day=date(2026, 4, 3), geographic=True)

    live = read(a)
    assert live["activity_count"] == 3
    assert live["located_activity_count"] == 3
    assert live["region_count"] == 3
    assert [c["code"] for c in live["countries"]] == ["CHN", "JPN"]

    china = live["countries"][0]
    assert china["name"] == "中国"
    assert china["activity_count"] == 2
    assert china["distance_m"] == 2000.0
    assert {r["code"] for r in china["regions"]} == {"CN-310000", "CN-710000"}
    taiwan = next(r for r in china["regions"] if r["code"] == "CN-710000")
    assert taiwan["name"] == "台湾省"
    assert taiwan["short_name"] == "台湾"
    assert taiwan["distance_m"] == 1000.0
    assert any(c["short_name"] == "台北" and c["distance_m"] == 1000.0 for c in taiwan["cities"])

    japan = live["countries"][1]
    assert japan["name"] == "日本"
    assert japan["distance_m"] == 1000.0
    assert japan["regions"][0]["code"] == "JP-13"
    assert japan["regions"][0]["distance_m"] == 1000.0
    assert any(
        c["short_name"] == "东京" and c["distance_m"] == 1000.0
        for c in japan["regions"][0]["cities"]
    )

    assert len(live["region_features"]["features"]) == 3

    assert module.fill_global_footprint_caches(app.state.session_factory, owner=UUID(owner)) == 3
    assert module.fill_global_footprint_caches(app.state.session_factory, owner=UUID(owner)) == 0
    assert cache_rows(app, owner) == 3

    def forbidden(*args, **kwargs):
        raise AssertionError("spatial pass must not run when every row is cached")

    orig = module.compute_global_codes
    module.compute_global_codes = forbidden
    try:
        assert read(a) == live
    finally:
        module.compute_global_codes = orig

    y2026 = read(a, 2026)
    assert y2026["year"] == 2026
    assert [c["code"] for c in y2026["countries"]] == ["JPN"]


def test_worker_scan_fills_global_footprint_caches(clients):  # noqa: F401
    from app.modules.footprints.worker import run_scan

    a, b, _, app = clients
    quiet(a, b)
    owner = register(a)
    add_activity(app, owner, [TAIPEI], geographic=True)
    assert cache_rows(app, owner) == 0
    run_scan(
        app.state.session_factory,
        app.state.clock(),
        app.state.expected_revision,
        limit=0,
    )
    assert cache_rows(app, owner) == 1
