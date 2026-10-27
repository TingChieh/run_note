from datetime import UTC, date, datetime
from decimal import Decimal

import pytest
from sqlalchemy import select

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
    ("2025-02-10", 5000, 1500, "complete"),
    ("2025-03-04", 8000, 2400, "complete"),
    ("2025-03-20", 5000, 1450, "complete"),
    ("2025-11-01", 10000, 3400, "complete"),
    ("2026-01-15", 5000, 1400, "complete"),
    ("2026-03-05", 5000, 1500, "complete"),
]
# The owner's local "today" in the tests below: Friday 2026-03-06 (Asia/Shanghai).
TODAY_UTC = datetime(2026, 3, 6, 12, tzinfo=UTC)


def add_run(db, user, day, distance, seconds, quality, started=None):
    row = Activity(
        user_id=user,
        source="gpx",
        title="Synthetic record run",
        activity_date=date.fromisoformat(day),
        date_source="timestamp",
        timezone="Asia/Shanghai",
        started_at=started or datetime(2023, 12, 31, 16, tzinfo=UTC),
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
    freeze(a, b, app)
    return a, b, app, ids


URL = "/api/v1/statistics/records"


def freeze(*clients_or_app, now=TODAY_UTC):
    """Fix the clock of both app instances behind the paired test clients."""
    for item in clients_or_app:
        getattr(item, "app", item).state.clock = lambda: now


def months_between(first, last):
    out, year, month = [], first[0], first[1]
    while (year, month) <= last:
        out.append(f"{year:04d}-{month:02d}-01")
        year, month = year + (month == 12), month % 12 + 1
    return out


def test_personal_bests_rank_by_pace_over_all_history(records_history):
    a, _, _, ids = records_history
    data = a.get(URL).json()["data"]
    five, ten = data["personal_bests"]
    assert [five["category"], ten["category"]] == ["5km", "10km"]
    # 2024-03-05, 2024-08-02 and 2026-01-15 tie on pace; the earliest date wins.
    assert five["best"]["activity_id"] == str(ids["2024-03-05"])
    assert Decimal(five["best"]["avg_pace_seconds_per_km"]) == Decimal("280")
    assert Decimal(five["best"]["duration_seconds"]) == Decimal("1400")
    assert five["best"]["qualifying_count"] == 9
    assert ten["best"]["activity_id"] == str(ids["2024-07-01"])
    assert ten["best"]["qualifying_count"] == 4  # the run without a duration is excluded


def test_first_run_is_the_earliest_reliable_run_in_each_band(records_history):
    a, _, _, ids = records_history
    five, ten = a.get(URL).json()["data"]["personal_bests"]
    assert five["first"]["activity_id"] == str(ids["2023-05-01"])
    assert five["first"]["activity_date"] == "2023-05-01"
    assert Decimal(five["first"]["distance_m"]) == 5000
    assert Decimal(five["first"]["duration_seconds"]) == 1600
    assert Decimal(five["first"]["avg_pace_seconds_per_km"]) == Decimal("320")
    assert Decimal(five["pace_gain_seconds_per_km"]) == Decimal("40")
    assert ten["first"]["activity_id"] == str(ids["2023-06-01"])
    assert Decimal(ten["pace_gain_seconds_per_km"]) == Decimal("30")
    assert set(five["first"]) == {
        "activity_id",
        "activity_date",
        "distance_m",
        "duration_seconds",
        "avg_pace_seconds_per_km",
    }


def test_first_run_skips_unreliable_activities_like_the_best_does(clients):  # noqa: F811
    a, _, _, app = clients
    owner = register(a)
    with app.state.session_factory.begin() as db:
        add_run(db, owner, "2024-01-01", 10000, None, "incomplete")  # earliest, but no duration
        add_run(db, owner, "2024-01-02", 3000, 900, "complete")  # outside both bands
        first = add_run(db, owner, "2024-02-01", 5000, 1600, "complete")
        best = add_run(db, owner, "2024-02-02", 5000, 1500, "complete")
    freeze(app)
    five, ten = a.get(URL).json()["data"]["personal_bests"]
    assert five["first"] is not None and ten["first"] is None and ten["best"] is None
    assert ten["pace_gain_seconds_per_km"] is None
    assert five["first"]["activity_id"] == str(first)
    assert five["best"]["activity_id"] == str(best)
    assert five["best"]["qualifying_count"] == 2
    assert Decimal(five["pace_gain_seconds_per_km"]) == Decimal("20")


def test_first_run_on_a_shared_date_is_the_one_that_started_first(clients):  # noqa: F811
    a, _, _, app = clients
    owner = register(a)
    with app.state.session_factory.begin() as db:
        # Same local date, created latest-first: ids are random, so only start times order them.
        ids = [
            add_run(
                db,
                owner,
                "2025-05-05",
                5000,
                1500,
                "complete",
                datetime(2025, 5, 5, hour, tzinfo=UTC),
            )
            for hour in (10, 9, 8, 7, 6, 5)
        ]
    freeze(app)
    five = a.get(URL).json()["data"]["personal_bests"][0]
    assert five["first"]["activity_id"] == str(ids[-1])


def test_a_single_qualifying_run_has_no_pace_gain(clients):  # noqa: F811
    a, _, _, app = clients
    owner = register(a)
    with app.state.session_factory.begin() as db:
        only = add_run(db, owner, "2025-05-05", 5000, 1500, "complete")
    freeze(app)
    five = a.get(URL).json()["data"]["personal_bests"][0]
    assert five["best"]["activity_id"] == five["first"]["activity_id"] == str(only)
    assert five["pace_gain_seconds_per_km"] is None


def test_totals_cover_all_history(records_history):
    a, _, _, _ = records_history
    totals = a.get(URL).json()["data"]["totals"]
    assert totals["activity_count"] == 16
    assert totals["activity_days"] == 16
    assert Decimal(totals["distance_m"]) == 110500
    # 100500 m with a duration took 31300 s
    assert Decimal(totals["avg_pace_seconds_per_km"]) == Decimal("311.443")
    assert totals["first_activity_date"] == "2023-05-01"


def test_monthly_is_a_continuous_timeline_from_the_first_month_to_the_current_month(
    records_history,
):
    a, _, _, _ = records_history
    monthly = a.get(URL).json()["data"]["monthly"]
    assert [m["month_start"] for m in monthly] == months_between((2023, 5), (2026, 3))
    by_month = {m["month_start"]: m for m in monthly}
    march = by_month["2024-03-01"]
    assert march["activity_count"] == 2 and Decimal(march["distance_m"]) == 9000
    assert Decimal(march["avg_pace_seconds_per_km"]) == Decimal("294.444")
    for gap in ("2023-07-01", "2024-04-01", "2025-12-01"):
        assert by_month[gap]["activity_count"] == 0
        assert Decimal(by_month[gap]["distance_m"]) == 0
        assert by_month[gap]["avg_pace_seconds_per_km"] is None
    # July 2024 has one run without a duration: counted, but not in the pace
    july = by_month["2024-07-01"]
    assert july["activity_count"] == 3 and Decimal(july["distance_m"]) == 30500


def test_the_current_month_is_included_even_without_activity(records_history):
    a, _, app, _ = records_history
    freeze(app, now=datetime(2026, 6, 15, 12, tzinfo=UTC))
    monthly = a.get(URL).json()["data"]["monthly"]
    assert monthly[-1]["month_start"] == "2026-06-01"
    assert monthly[-1]["activity_count"] == 0 and monthly[-1]["avg_pace_seconds_per_km"] is None
    assert [m["month_start"] for m in monthly] == months_between((2023, 5), (2026, 6))


def test_activities_dated_after_today_extend_the_timeline_without_errors(records_history):
    a, _, app, ids = records_history
    with app.state.session_factory.begin() as db:
        owner = db.scalar(select(Activity.user_id).where(Activity.id == ids["2026-03-05"]))
        add_run(db, owner, "2026-05-10", 5000, 1400, "complete")
        add_run(db, owner, "2027-01-04", 5000, 1400, "complete")
    data = a.get(URL).json()["data"]
    assert data["monthly"][-1]["month_start"] == "2027-01-01"
    assert data["monthly"][-1]["activity_count"] == 1
    assert len(data["monthly"]) == len(months_between((2023, 5), (2027, 1)))
    years = data["yearly"]
    assert [row["year"] for row in years] == [2023, 2024, 2025, 2026, 2027]
    assert [row["is_partial"] for row in years] == [False, False, False, True, False]
    assert years[-1]["delta_basis"] == "previous_year"
    assert len(data["weekly"]) == 26
    assert data["weekly"][-1]["active_days"] == 1  # only 2026-03-05, not the future runs


def test_yearly_rows_ascend_with_deltas_against_the_previous_year(records_history):
    a, _, _, _ = records_history
    years = a.get(URL).json()["data"]["yearly"]
    assert [row["year"] for row in years] == [2023, 2024, 2025, 2026]
    first, y2024, y2025, y2026 = years
    assert first["delta"] is None and first["delta_basis"] is None
    assert (first["activity_count"], first["activity_days"]) == (2, 2)
    assert Decimal(first["distance_m"]) == 15000
    assert Decimal(first["avg_pace_seconds_per_km"]) == Decimal("346.667")
    assert not first["is_partial"]
    assert y2024["activity_count"] == 8 and Decimal(y2024["distance_m"]) == 57500
    assert Decimal(y2024["avg_pace_seconds_per_km"]) == Decimal("304.211")
    assert y2024["delta_basis"] == "previous_year"
    assert y2024["delta"]["activity_count"] == 6
    assert Decimal(y2024["delta"]["distance_m"]) == 42500
    assert Decimal(y2024["delta"]["avg_pace_seconds_per_km"]) == Decimal("-42.456")
    assert y2025["delta_basis"] == "previous_year"
    assert y2025["delta"]["activity_count"] == -4
    assert Decimal(y2025["delta"]["distance_m"]) == -29500
    assert Decimal(y2025["delta"]["avg_pace_seconds_per_km"]) == Decimal("8.289")
    assert set(y2026["delta"]) == {"activity_count", "distance_m", "avg_pace_seconds_per_km"}


def test_the_current_year_is_partial_and_compares_with_last_years_same_period(records_history):
    a, _, _, _ = records_history
    current = a.get(URL).json()["data"]["yearly"][-1]
    assert current["year"] == 2026 and current["is_partial"] is True
    assert current["activity_count"] == 2 and Decimal(current["distance_m"]) == 10000
    assert Decimal(current["avg_pace_seconds_per_km"]) == Decimal("290")
    assert current["delta_basis"] == "previous_year_same_period"
    # 2025 up to 03-06: 02-10 and 03-04 (13000 m, 3900 s); 03-20 and later do not count
    assert current["delta"]["activity_count"] == 0
    assert Decimal(current["delta"]["distance_m"]) == -3000
    assert Decimal(current["delta"]["avg_pace_seconds_per_km"]) == Decimal("-10")


def test_a_current_year_without_runs_still_has_a_row(clients):  # noqa: F811
    a, _, _, app = clients
    owner = register(a)
    with app.state.session_factory.begin() as db:
        add_run(db, owner, "2025-01-10", 5000, 1500, "complete")
        add_run(db, owner, "2025-06-10", 5000, 1500, "complete")
    freeze(a, app)
    data = a.get(URL).json()["data"]
    assert [row["year"] for row in data["yearly"]] == [2025, 2026]
    current = data["yearly"][-1]
    assert current["is_partial"] is True
    assert current["activity_count"] == 0 and Decimal(current["distance_m"]) == 0
    assert current["avg_pace_seconds_per_km"] is None
    assert current["delta_basis"] == "previous_year_same_period"
    # 2025 up to 03-06: only 01-10
    assert current["delta"]["activity_count"] == -1
    assert Decimal(current["delta"]["distance_m"]) == -5000
    assert current["delta"]["avg_pace_seconds_per_km"] is None
    assert data["monthly"][-1]["month_start"] == "2026-03-01"


def test_weekday_covers_all_history_and_weekly_the_last_26_weeks(records_history):
    a, _, _, _ = records_history
    data = a.get(URL).json()["data"]
    expected = [0] * 7
    for run in OWNER_RUNS:
        expected[date.fromisoformat(run[0]).weekday()] += 1
    assert [d["weekday"] for d in data["weekday"]] == list(range(7))
    assert [d["activity_count"] for d in data["weekday"]] == expected
    assert sum(expected) == 16
    assert len(data["weekly"]) == 26
    assert data["weekly"][-1] == {"week_start": "2026-03-02", "active_days": 1}


def test_no_year_parameters_exist_and_stale_ones_are_ignored(records_history):
    a, _, _, _ = records_history
    plain = a.get(URL).json()["data"]
    assert a.get(f"{URL}?year=2024&compare_year=2024").json()["data"] == plain
    assert a.get(f"{URL}?year=1800").status_code == 200
    assert not {"year", "compare_year", "cutoff_date", "comparison", "compare_monthly"} & set(plain)
    assert set(plain) == {
        "personal_bests",
        "totals",
        "monthly",
        "weekly",
        "weekday",
        "yearly",
        "date_assignment",
    }


def test_owner_isolation(records_history):
    a, b, _, ids = records_history
    mine = a.get(URL).json()["data"]
    theirs = b.get(URL).json()["data"]
    five = theirs["personal_bests"][0]
    assert five["best"]["activity_id"] == five["first"]["activity_id"] == str(ids["other"])
    assert five["best"]["qualifying_count"] == 1
    assert five["pace_gain_seconds_per_km"] is None
    assert theirs["totals"]["activity_count"] == 1
    assert theirs["totals"]["first_activity_date"] == "2024-01-01"
    assert theirs["monthly"][0]["month_start"] == "2024-01-01"
    assert [row["year"] for row in theirs["yearly"]] == [2024, 2025, 2026]
    assert mine != theirs


def test_showcase_serves_the_site_owner_and_rejects_owner_parameters(records_history):
    a, _, _, _ = records_history
    shown = a.get("/api/v1/showcase/statistics/records")
    assert shown.status_code == 200
    assert shown.json()["data"] == a.get(URL).json()["data"]
    for key in ("owner", "user_id", "email", "username"):
        assert a.get(f"/api/v1/showcase/statistics/records?{key}=x").status_code == 422
    text = shown.text
    for forbidden in ("Synthetic record run", "email", "filename", "notes"):
        assert forbidden not in text


def test_user_without_any_run_has_empty_overview_shapes(clients):  # noqa: F811
    a, b, _, app = clients
    register(a)
    register(b)
    freeze(a, b, app)
    data = b.get(URL).json()["data"]
    for item in data["personal_bests"]:
        assert item["best"] is None and item["first"] is None
        assert item["pace_gain_seconds_per_km"] is None
    assert data["monthly"] == [] and data["yearly"] == []
    assert [len(data[k]) for k in ("weekly", "weekday")] == [26, 7]
    assert all(d["activity_count"] == 0 for d in data["weekday"])
    totals = data["totals"]
    assert totals["activity_count"] == 0 and totals["activity_days"] == 0
    assert Decimal(totals["distance_m"]) == 0
    assert totals["avg_pace_seconds_per_km"] is None and totals["first_activity_date"] is None
