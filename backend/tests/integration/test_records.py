from datetime import UTC, date, datetime
from decimal import Decimal

import pytest

from app.modules.activities.model import Activity
from tests.integration.test_gpx_import import clients, register  # noqa: F401

pytestmark = pytest.mark.integration

OWNER_RUNS = [
    ("2024-01-10", 5000, 1500, "complete"),
    ("2024-03-05", 5000, 1400, "complete"),
    ("2024-03-06", 4000, 1250, "complete"),
    ("2024-07-01", 10000, 3300, "complete"),
    ("2024-07-02", 10500, 3600, "complete"),
    ("2024-07-05", 10000, None, "incomplete"),
    ("2024-08-01", 8000, 2000, "complete"),
    ("2024-08-02", 5000, 1400, "complete"),
    ("2023-05-01", 5000, 1600, "complete"),
    ("2023-06-01", 10000, 3600, "complete"),
]


def add_run(db, user, day, distance, seconds, quality):
    row = Activity(
        user_id=user,
        source="gpx",
        title="Synthetic record run",
        activity_date=date.fromisoformat(day),
        date_source="timestamp",
        timezone="Asia/Shanghai",
        started_at=datetime(2023, 12, 31, 16, tzinfo=UTC),
        ended_at=None,
        distance_m=Decimal(distance),
        elapsed_seconds=seconds,
        avg_pace_seconds_per_km=None,
        temporal_quality=quality,
        quality_summary={"warnings": ["TIME_INCOMPLETE"] if seconds is None else []},
        metrics_version="gpx-v1",
    )
    db.add(row)
    db.flush()
    return row.id


@pytest.fixture
def records_history(clients):  # noqa: F811 -- imported pytest fixture
    a, b, engine, app = clients
    owner, other = register(a), register(b)
    ids = {}
    with app.state.session_factory.begin() as db:
        for run in OWNER_RUNS:
            ids[run[0]] = add_run(db, owner, *run)
        ids["other"] = add_run(db, other, "2024-01-01", 5000, 1000, "complete")
    return a, b, app, ids


QUERY = "year=2024&compare_year=2023"


def test_personal_bests_rank_by_pace_over_all_history(records_history):
    a, _, _, ids = records_history
    data = a.get(f"/api/v1/statistics/records?{QUERY}").json()["data"]
    five, ten = data["personal_bests"]
    assert [five["category"], ten["category"]] == ["5km", "10km"]
    # 2024-03-05 and 2024-08-02 tie on pace; the earlier date wins.
    assert five["best"]["activity_id"] == str(ids["2024-03-05"])
    assert Decimal(five["best"]["avg_pace_seconds_per_km"]) == Decimal("280")
    assert Decimal(five["best"]["duration_seconds"]) == Decimal("1400")
    assert five["best"]["qualifying_count"] == 5
    assert ten["best"]["activity_id"] == str(ids["2024-07-01"])
    assert ten["best"]["qualifying_count"] == 3  # the run without a duration is excluded


def test_monthly_weekday_and_year_comparison_for_a_past_year(records_history):
    a, _, _, _ = records_history
    data = a.get(f"/api/v1/statistics/records?{QUERY}").json()["data"]
    assert (data["year"], data["compare_year"]) == (2024, 2023)
    assert (data["cutoff_date"], data["compare_cutoff_date"]) == ("2024-12-31", "2023-12-31")
    assert [m["month"] for m in data["monthly"]] == list(range(1, 13))
    march = data["monthly"][2]
    assert march["activity_count"] == 2 and Decimal(march["distance_m"]) == 9000
    assert Decimal(march["avg_pace_seconds_per_km"]) == Decimal("294.444")
    assert data["monthly"][3]["avg_pace_seconds_per_km"] is None
    assert [d["activity_count"] for d in data["weekday"]] == [1, 2, 2, 1, 2, 0, 0]
    assert len(data["weekly"]) == 26
    assert len(data["compare_monthly"]) == 12
    current, previous, delta = (data["comparison"][k] for k in ("current", "previous", "delta"))
    assert (current["year"], current["activity_count"]) == (2024, 8)
    assert Decimal(current["distance_m"]) == 57500
    assert Decimal(current["avg_pace_seconds_per_km"]) == Decimal("304.211")
    assert (previous["year"], previous["activity_count"]) == (2023, 2)
    assert Decimal(previous["avg_pace_seconds_per_km"]) == Decimal("346.667")
    assert delta["activity_count"] == 6 and Decimal(delta["distance_m"]) == 42500
    assert Decimal(delta["avg_pace_seconds_per_km"]) == Decimal("-42.456")


def test_current_year_compares_up_to_the_owners_local_today(records_history):
    a, _, app, _ = records_history
    app.state.clock = lambda: datetime(2024, 3, 6, 12, tzinfo=UTC)
    data = a.get(f"/api/v1/statistics/records?{QUERY}").json()["data"]
    assert (data["cutoff_date"], data["compare_cutoff_date"]) == ("2024-03-06", "2023-03-06")
    current, previous, delta = (data["comparison"][k] for k in ("current", "previous", "delta"))
    assert current["activity_count"] == 3 and Decimal(current["distance_m"]) == 14000
    assert previous["activity_count"] == 0 and previous["avg_pace_seconds_per_km"] is None
    assert delta["avg_pace_seconds_per_km"] is None
    assert data["weekly"][-1] == {"week_start": "2024-03-04", "active_days": 2}


def test_defaults_validation_and_owner_isolation(records_history):
    a, b, _, ids = records_history
    default = a.get("/api/v1/statistics/records").json()["data"]
    assert default["compare_year"] == default["year"] - 1
    for query in ("year=2024&compare_year=2024", "year=1900", "year=1800"):
        assert a.get(f"/api/v1/statistics/records?{query}").status_code == 422
    mine = a.get(f"/api/v1/statistics/records?{QUERY}").json()["data"]
    theirs = b.get(f"/api/v1/statistics/records?{QUERY}").json()["data"]
    assert theirs["personal_bests"][0]["best"]["activity_id"] == str(ids["other"])
    assert theirs["personal_bests"][0]["best"]["qualifying_count"] == 1
    assert theirs["comparison"]["current"]["activity_count"] == 1
    assert mine != theirs


def test_showcase_serves_the_site_owner_and_rejects_owner_parameters(records_history):
    a, _, _, _ = records_history
    shown = a.get(f"/api/v1/showcase/statistics/records?{QUERY}")
    assert shown.status_code == 200
    assert shown.json()["data"] == a.get(f"/api/v1/statistics/records?{QUERY}").json()["data"]
    for key in ("owner", "user_id", "email", "username"):
        assert a.get(f"/api/v1/showcase/statistics/records?{QUERY}&{key}=x").status_code == 422
    text = shown.text
    for forbidden in ("Synthetic record run", "email", "filename", "notes"):
        assert forbidden not in text


@pytest.fixture
def march_history(clients):  # noqa: F811 -- imported pytest fixture
    a, _, _, app = clients
    owner = register(a)
    with app.state.session_factory.begin() as db:
        for run in (
            ("2024-03-05", 5000, 1400, "complete"),
            ("2023-03-05", 5000, 1500, "complete"),
            ("2023-03-20", 8000, 2400, "complete"),
            ("2023-05-01", 5000, 1600, "complete"),
        ):
            add_run(db, owner, *run)
    app.state.clock = lambda: datetime(2024, 3, 6, 12, tzinfo=UTC)
    return a


def test_current_year_compare_monthly_stops_at_the_compare_cutoff(march_history):
    data = march_history.get(f"/api/v1/statistics/records?{QUERY}").json()["data"]
    compare = data["compare_monthly"]
    assert [m["month"] for m in compare] == list(range(1, 13))
    march = compare[2]
    # 2023-03-20 and 2023-05-01 are after the compare cutoff (2023-03-06): not counted.
    assert march["activity_count"] == 1 and Decimal(march["distance_m"]) == 5000
    assert Decimal(march["avg_pace_seconds_per_km"]) == Decimal("300")
    for later in compare[3:]:
        assert later["activity_count"] == 0 and Decimal(later["distance_m"]) == 0
        assert later["avg_pace_seconds_per_km"] is None
    assert data["comparison"]["previous"]["activity_count"] == 1
    # a past year keeps its full-year series
    past = march_history.get("/api/v1/statistics/records?year=2023&compare_year=2022")
    months = past.json()["data"]["monthly"]
    assert (months[2]["activity_count"], months[4]["activity_count"]) == (2, 1)


def test_comparing_a_past_year_with_the_current_year_cuts_both_sides_at_today(march_history):
    data = march_history.get("/api/v1/statistics/records?year=2023&compare_year=2024").json()[
        "data"
    ]
    assert (data["cutoff_date"], data["compare_cutoff_date"]) == ("2023-03-06", "2024-03-06")
    assert data["comparison"]["current"]["activity_count"] == 1
    assert data["comparison"]["previous"]["activity_count"] == 1
    # the primary series stays the full calendar year; only the totals are cut at today
    assert data["monthly"][2]["activity_count"] == 2 and data["monthly"][4]["activity_count"] == 1


def test_a_range_without_runs_has_empty_shapes_and_matches_summary(records_history):
    a, _, _, _ = records_history
    data = a.get("/api/v1/statistics/records?year=2010&compare_year=2009").json()["data"]
    assert data["personal_bests"][0]["best"] is not None  # bests span all history
    assert [len(data[k]) for k in ("monthly", "compare_monthly", "weekly", "weekday")] == [
        12,
        12,
        26,
        7,
    ]
    for key in ("monthly", "compare_monthly"):
        assert all(
            m["activity_count"] == 0 and m["avg_pace_seconds_per_km"] is None for m in data[key]
        )
    assert all(d["activity_count"] == 0 for d in data["weekday"])
    current, previous, delta = (data["comparison"][k] for k in ("current", "previous", "delta"))
    assert current["activity_count"] == previous["activity_count"] == 0
    assert Decimal(current["distance_m"]) == Decimal(previous["distance_m"]) == 0
    assert current["avg_pace_seconds_per_km"] is None and delta["avg_pace_seconds_per_km"] is None
    summary = a.get("/api/v1/statistics/summary?date_from=2010-01-01&date_to=2011-01-01")
    assert summary.status_code == 200
    totals = summary.json()["data"]
    assert totals["activity_count"] == current["activity_count"]
    assert Decimal(totals["distance_m"]) == Decimal(current["distance_m"])


def test_user_without_any_run_has_null_bests_and_zero_comparison(clients):  # noqa: F811
    a, b, _, _ = clients
    register(a)
    register(b)
    data = b.get(f"/api/v1/statistics/records?{QUERY}").json()["data"]
    assert [item["best"] for item in data["personal_bests"]] == [None, None]
    assert [len(data[k]) for k in ("monthly", "compare_monthly", "weekly", "weekday")] == [
        12,
        12,
        26,
        7,
    ]
    current, previous = data["comparison"]["current"], data["comparison"]["previous"]
    assert current["activity_count"] == previous["activity_count"] == 0
    assert current["avg_pace_seconds_per_km"] is None
    summary = b.get("/api/v1/statistics/summary?date_from=2024-01-01&date_to=2025-01-01")
    assert summary.json()["data"]["activity_count"] == current["activity_count"] == 0


def test_equal_years_are_rejected_with_a_validation_error_code(records_history):
    a, _, _, _ = records_history
    response = a.get("/api/v1/statistics/records?year=2024&compare_year=2024")
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
