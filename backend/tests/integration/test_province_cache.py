"""Per-activity province cache: same answers as the live pass, without repeating it."""

from datetime import date
from uuid import UUID

import pytest
from sqlalchemy import text

from app.modules.footprints import provinces as module
from tests.conftest import clients, register  # noqa: F401
from tests.integration.test_footprints import add_activity

pytestmark = pytest.mark.integration  # clients is requested by name

SHANGHAI = [(121.45, 31.20), (121.50, 31.25)]
BEIJING = [(116.30, 39.90), (116.45, 39.95)]
ABROAD = [(10.0, 50.0), (10.01, 50.01)]


def quiet(*test_clients):
    """Stop the background workers so the test decides when the fill runs."""
    for client in test_clients:
        client.app.state.footprint_worker.stop()


def cache_rows(app, owner):
    with app.state.session_factory() as db:
        return db.scalar(
            text("SELECT count(*) FROM activity_province_caches WHERE user_id=:o"),
            {"o": UUID(owner)},
        )


def read(client, year=None):
    response = client.get("/api/v1/footprints/provinces" + (f"?year={year}" if year else ""))
    assert response.status_code == 200, response.text
    return response.json()["data"]


def counts(data):
    return {p["code"]: p["activity_count"] for p in data["provinces"]}


def test_compute_and_fill_store_the_codes_each_activity_passes_through(clients):  # noqa: F811
    a, b, _, app = clients
    quiet(a, b)
    owner = register(a)
    both = add_activity(app, owner, [SHANGHAI, BEIJING], geographic=True)
    abroad = add_activity(app, owner, [ABROAD], geographic=True)
    with app.state.session_factory() as db:
        codes = module.compute_province_codes(db, UUID(owner), [UUID(both), UUID(abroad)])
    assert codes == {UUID(both): [110000, 310000], UUID(abroad): []}
    # The test database is shared, so other tests' activities may be filled as well.
    assert module.fill_province_caches(app.state.session_factory) >= 2
    assert cache_rows(app, owner) == 2
    assert module.fill_province_caches(app.state.session_factory) == 0  # nothing left to do
    with app.state.session_factory() as db:
        stored = dict(
            db.execute(
                text(
                    "SELECT activity_id, province_codes FROM activity_province_caches "
                    "WHERE user_id=:o"
                ),
                {"o": UUID(owner)},
            ).all()
        )
    assert stored == {UUID(both): [110000, 310000], UUID(abroad): []}


def test_cached_summary_equals_the_live_one_and_skips_the_spatial_pass(clients, monkeypatch):  # noqa: F811
    a, b, _, app = clients
    quiet(a, b)
    owner = register(a)
    add_activity(app, owner, [SHANGHAI], day=date(2025, 3, 1), geographic=True)
    add_activity(app, owner, [SHANGHAI, BEIJING], day=date(2025, 3, 2), geographic=True)
    add_activity(app, owner, [ABROAD], day=date(2025, 3, 3), geographic=True)
    live = read(a)  # nothing cached yet: every activity is computed for the request
    assert (counts(live), live["activity_count"], live["located_activity_count"]) == (
        {310000: 2, 110000: 1},
        3,
        2,
    )
    assert [p["name"] for p in live["provinces"]] == ["北京市", "上海市"]
    module.fill_province_caches(app.state.session_factory)
    assert cache_rows(app, owner) == 3

    def forbidden(*args, **kwargs):
        raise AssertionError("the spatial pass must not run when every row is cached")

    monkeypatch.setattr(module, "compute_province_codes", forbidden)
    assert read(a) == live


def test_missing_activities_are_computed_for_the_request_without_writing(clients):  # noqa: F811
    a, b, _, app = clients
    quiet(a, b)
    owner = register(a)
    add_activity(app, owner, [SHANGHAI], geographic=True)
    module.fill_province_caches(app.state.session_factory)
    add_activity(app, owner, [BEIJING], geographic=True)  # imported after the last fill
    data = read(a)
    assert (counts(data), data["activity_count"], data["located_activity_count"]) == (
        {310000: 1, 110000: 1},
        2,
        2,
    )
    assert cache_rows(app, owner) == 1  # a GET never writes


def test_outdated_atlas_versions_count_as_missing_and_are_refreshed(clients, monkeypatch):  # noqa: F811
    a, b, _, app = clients
    quiet(a, b)
    owner = register(a)
    add_activity(app, owner, [SHANGHAI], geographic=True)
    module.fill_province_caches(app.state.session_factory)
    with app.state.session_factory.begin() as db:
        db.execute(
            text("UPDATE activity_province_caches SET atlas_version='old' WHERE user_id=:o"),
            {"o": UUID(owner)},
        )
    calls = []
    original = module.compute_province_codes
    monkeypatch.setattr(
        module,
        "compute_province_codes",
        lambda *args, **kwargs: calls.append(1) or original(*args, **kwargs),
    )
    assert counts(read(a)) == {310000: 1}
    assert calls  # the outdated row was computed for the request
    module.fill_province_caches(app.state.session_factory)
    with app.state.session_factory() as db:
        versions = db.scalars(
            text("SELECT atlas_version FROM activity_province_caches WHERE user_id=:o"),
            {"o": UUID(owner)},
        ).all()
    assert versions == [module.atlas_version()]


def test_year_filter_and_deleted_activities(clients):  # noqa: F811
    a, b, _, app = clients
    quiet(a, b)
    owner = register(a)
    old = add_activity(app, owner, [SHANGHAI], day=date(2024, 6, 1), geographic=True)
    add_activity(app, owner, [BEIJING], day=date(2025, 6, 1), geographic=True)
    module.fill_province_caches(app.state.session_factory)
    data = read(a, 2025)
    assert (data["year"], data["activity_count"], counts(data)) == (2025, 1, {110000: 1})
    assert counts(read(a)) == {310000: 1, 110000: 1}
    with app.state.session_factory.begin() as db:
        db.execute(text("DELETE FROM activities WHERE id=:id"), {"id": UUID(old)})
    assert cache_rows(app, owner) == 1  # the cache row followed its activity
    assert counts(read(a)) == {110000: 1}


def test_a_worker_scan_fills_missing_province_rows(clients):  # noqa: F811
    from app.modules.footprints.worker import run_scan

    a, b, _, app = clients
    quiet(a, b)
    owner = register(a)
    add_activity(app, owner, [SHANGHAI], geographic=True)
    assert cache_rows(app, owner) == 0
    run_scan(
        app.state.session_factory,
        app.state.clock(),
        app.state.expected_revision,
        limit=0,  # no snapshot work: this scan only exercises the province fill
    )
    assert cache_rows(app, owner) == 1
