from datetime import UTC, date, datetime
from decimal import Decimal

import pytest

from app.modules.activities.model import Activity
from tests.integration.test_gpx_import import clients, register  # noqa: F401

pytestmark = pytest.mark.integration


@pytest.fixture
def history(clients):  # noqa: F811 -- imported pytest fixture
    a, b, engine, app = clients
    owner, other = register(a), register(b)
    with app.state.session_factory.begin() as db:
        for user, day, distance, duration, quality in [
            (owner, "2024-01-01", 1000, 600, "complete"),
            (owner, "2024-01-01", 2000, None, "incomplete"),
            (owner, "2024-01-02", 3000, 900, "complete"),
            (owner, "2024-02-29", 0, 0, "complete"),
            (owner, "2025-01-01", 5000, 3000, "complete"),
            (other, "2024-01-01", 10000, 3600, "complete"),
        ]:
            db.add(
                Activity(
                    user_id=user,
                    source="gpx",
                    title="Synthetic history",
                    activity_date=date.fromisoformat(day),
                    date_source="timestamp",
                    timezone="Asia/Shanghai",
                    started_at=datetime(2023, 12, 31, 16, tzinfo=UTC),
                    ended_at=None,
                    distance_m=Decimal(distance),
                    elapsed_seconds=duration,
                    avg_pace_seconds_per_km=None,
                    temporal_quality=quality,
                    quality_summary={"warnings": ["TIME_INCOMPLETE"] if duration is None else []},
                    metrics_version="gpx-v1",
                )
            )
    return a, b, engine, app


def test_calendar_aggregates_local_dates_leap_zero_and_private_owner(history):
    a, b, _, _ = history
    r = a.get("/api/v1/statistics/calendar?year=2024&metric=distance")
    assert r.status_code == 200
    c = r.json()["data"]
    assert len(c["days"]) == 366 and c["activity_count"] == 4
    assert Decimal(c["distance_m"]) == 6000
    days = {d["date"]: d for d in c["days"]}
    assert days["2024-01-01"]["activity_count"] == 2
    assert Decimal(days["2024-01-01"]["distance_m"]) == 3000
    assert days["2024-01-01"]["known_duration_count"] == 1
    assert days["2024-01-01"]["missing_duration_count"] == 1
    assert days["2024-01-03"]["duration_sum_seconds"] is None
    assert days["2024-01-03"]["activity_count"] == 0
    assert days["2024-02-29"]["activity_count"] == 1
    assert len(a.get("/api/v1/statistics/calendar?year=2023").json()["data"]["days"]) == 365
    assert (
        b.get("/api/v1/statistics/calendar?year=2024&metric=count").json()["data"]["activity_count"]
        == 1
    )
    rows = a.get("/api/v1/activities?limit=20&offset=0&activity_date=2024-01-01").json()["data"]
    assert rows["total"] == 2
    assert all(row["activity_date"] == "2024-01-01" for row in rows["items"])


def test_summary_weighted_pace_known_coverage_and_empty(history):
    a, _, _, _ = history
    r = a.get("/api/v1/statistics/summary")
    assert r.status_code == 200
    s = r.json()["data"]
    assert s["activity_count"] == 5 and s["activity_days"] == 4
    assert Decimal(s["distance_m"]) == 11000
    assert Decimal(s["duration_sum_seconds"]) == 4500
    assert (s["known_duration_count"], s["missing_duration_count"]) == (4, 1)
    assert s["pace_eligible_count"] == 3
    assert Decimal(s["pace_eligible_distance_m"]) == 9000
    assert Decimal(s["avg_pace_seconds_per_km"]) == 500
    assert s["quality_warning_count"] == 1
    empty = a.get("/api/v1/statistics/summary?date_from=2023-01-01&date_to=2024-01-01").json()[
        "data"
    ]
    assert empty["activity_count"] == 0
    assert empty["duration_sum_seconds"] is None
    assert empty["avg_pace_seconds_per_km"] is None


def test_natural_week_month_partial_and_zero_buckets(history):
    a, _, _, _ = history
    r = a.get("/api/v1/statistics/trends?date_from=2024-01-02&date_to=2024-03-02&period=week")
    assert r.status_code == 200
    t = r.json()["data"]
    assert t["week_start"] == "monday"
    first, last = t["buckets"][0], t["buckets"][-1]
    assert first["bucket_start"] == "2024-01-02" and first["bucket_end"] == "2024-01-08"
    assert first["is_partial"] is True and Decimal(first["distance_m"]) == 3000
    assert last["bucket_end"] == "2024-03-02" and last["is_partial"] is True
    assert any(
        x["activity_count"] == 0 and x["avg_pace_seconds_per_km"] is None for x in t["buckets"]
    )
    monthly = a.get(
        "/api/v1/statistics/trends?date_from=2024-01-01&date_to=2025-01-01&period=month"
    ).json()["data"]
    assert len(monthly["buckets"]) == 12
    assert Decimal(monthly["buckets"][0]["distance_m"]) == 6000
    assert monthly["buckets"][1]["activity_count"] == 1


def test_statistics_auth_and_query_validation(history):
    a, b, _, _ = history
    b.cookies.clear()
    for path in ["calendar?year=2024", "summary", "trends?date_from=2024-01-01&date_to=2025-01-01"]:
        assert b.get("/api/v1/statistics/" + path).status_code == 401
    for query in ["year=1899", "year=2101", "year=2024&metric=unknown"]:
        assert a.get("/api/v1/statistics/calendar?" + query).status_code == 422
    for query in [
        "date_from=2024-01-01",
        "date_from=2024-01-01&date_to=2024-01-01",
        "date_from=2024-01-01&date_to=2030-01-01",
    ]:
        assert a.get("/api/v1/statistics/summary?" + query).status_code == 422


def test_unknown_only_duration_null_and_extreme_year_validation(history):
    a, _, _, app = history
    owner = a.get("/api/v1/auth/session").json()["data"]["user"]["id"]
    with app.state.session_factory.begin() as db:
        db.add(
            Activity(
                user_id=owner,
                source="manual",
                title="Unknown duration",
                activity_date=date(2026, 1, 1),
                date_source="manual",
                timezone="Pacific/Honolulu",
                distance_m=1000,
                elapsed_seconds=None,
                avg_pace_seconds_per_km=None,
                temporal_quality="manual",
                quality_summary={},
                metrics_version="manual-v1",
            )
        )
    data = a.get("/api/v1/statistics/summary?date_from=2026-01-01&date_to=2026-01-02").json()[
        "data"
    ]
    assert data["duration_sum_seconds"] is None and data["missing_duration_count"] == 1
    assert data["avg_pace_seconds_per_km"] is None
    assert data["pace_eligible_count"] == 0
    assert (
        a.get("/api/v1/statistics/summary?date_from=9998-01-01&date_to=9999-01-01").status_code
        == 422
    )
    assert len(a.get("/api/v1/statistics/calendar?year=2100").json()["data"]["days"]) == 365
