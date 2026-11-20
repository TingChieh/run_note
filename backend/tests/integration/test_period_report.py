from datetime import UTC, date, datetime
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.modules.activities.model import Activity
from app.modules.users.model import User
from tests.conftest import register

pytestmark = pytest.mark.integration

OWNER_URL = "/api/v1/statistics/report"
SHOWCASE_URL = "/api/v1/showcase/statistics/report"


def add_activity(
    db,
    user,
    day: str,
    distance,
    elapsed,
    quality: str = "complete",
    *,
    timer=None,
    title: str = "Synthetic report run",
    notes: str = "private-note-never-leaked",
):
    db.add(
        Activity(
            user_id=user,
            source="gpx",
            title=title,
            notes=notes,
            activity_date=date.fromisoformat(day),
            date_source="timestamp",
            timezone="Asia/Shanghai",
            started_at=datetime(2023, 12, 31, 16, tzinfo=UTC),
            ended_at=None,
            distance_m=Decimal(distance),
            elapsed_seconds=None if elapsed is None else Decimal(elapsed),
            timer_seconds=None if timer is None else Decimal(timer),
            avg_pace_seconds_per_km=None,
            temporal_quality=quality,
            quality_summary={"warnings": ["TIME_INCOMPLETE"] if elapsed is None else []},
            metrics_version="gpx-v1",
        )
    )


def freeze(*clients_or_app, now: datetime):
    for item in clients_or_app:
        getattr(item, "app", item).state.clock = lambda: now


@pytest.fixture
def report_history(clients):
    """Reuses the deterministic 2024 sample from test_statistics.py plus other-owner isolation."""
    a, b, engine, app = clients
    owner, other = register(a), register(b)
    with app.state.session_factory.begin() as db:
        # Exact 2024 baseline sample from test_statistics.py:
        # Jan 2024: 3 runs / 6 km / 1500 s / 375 s/km; full 2024: 4 runs / 6 km / 1500 s / 375 s/km.
        for user, day, distance, duration, quality in [
            (owner, "2024-01-01", 1000, 600, "complete"),
            (owner, "2024-01-01", 2000, None, "incomplete"),
            (owner, "2024-01-02", 3000, 900, "complete"),
            (owner, "2024-02-29", 0, 0, "complete"),
            (owner, "2025-01-01", 5000, 3000, "complete"),
            (other, "2024-01-01", 10000, 3600, "complete"),
        ]:
            add_activity(db, user, day, distance, duration, quality)
    freeze(a, b, app, now=datetime(2026, 3, 6, 12, tzinfo=UTC))
    return a, b, app, owner, other


def test_monthly_and_yearly_2024_sample_cross_month_cross_year_leap_day_and_empty(report_history):
    a, _, _, _, _ = report_history

    jan = a.get(f"{OWNER_URL}?period=month&year=2024&month=1")
    assert jan.status_code == 200
    d = jan.json()["data"]
    assert (d["period"], d["year"], d["month"]) == ("month", 2024, 1)
    assert (d["date_from"], d["date_to"]) == ("2024-01-01", "2024-02-01")
    assert d["is_partial"] is False and d["cutoff_date"] is None
    assert d["today"] == "2026-03-06"
    assert d["activity_count"] == 3 and d["activity_days"] == 2
    assert Decimal(d["distance_m"]) == 6000
    assert Decimal(d["duration_sum_seconds"]) == 1500
    assert (d["known_duration_count"], d["missing_duration_count"]) == (2, 1)
    assert d["pace_eligible_count"] == 2 and Decimal(d["pace_eligible_distance_m"]) == 4000
    assert Decimal(d["avg_pace_seconds_per_km"]) == Decimal("375.000")
    assert d["date_assignment"] == "activity_local_date"

    feb = a.get(f"{OWNER_URL}?period=month&year=2024&month=2").json()["data"]
    assert (feb["date_from"], feb["date_to"]) == ("2024-02-01", "2024-03-01")
    assert feb["activity_count"] == 1 and feb["activity_days"] == 1
    assert Decimal(feb["distance_m"]) == 0 and Decimal(feb["duration_sum_seconds"]) == 0
    assert feb["pace_eligible_count"] == 0 and feb["avg_pace_seconds_per_km"] is None

    dec = a.get(f"{OWNER_URL}?period=month&year=2024&month=12").json()["data"]
    assert (dec["date_from"], dec["date_to"]) == ("2024-12-01", "2025-01-01")
    assert dec["activity_count"] == 0 and Decimal(dec["distance_m"]) == 0
    assert dec["duration_sum_seconds"] is None and dec["avg_pace_seconds_per_km"] is None

    y2024 = a.get(f"{OWNER_URL}?period=year&year=2024").json()["data"]
    assert (y2024["period"], y2024["year"], y2024["month"]) == ("year", 2024, None)
    assert (y2024["date_from"], y2024["date_to"]) == ("2024-01-01", "2025-01-01")
    assert y2024["is_partial"] is False and y2024["cutoff_date"] is None
    assert y2024["activity_count"] == 4 and y2024["activity_days"] == 3
    assert Decimal(y2024["distance_m"]) == 6000
    assert Decimal(y2024["duration_sum_seconds"]) == 1500
    assert Decimal(y2024["avg_pace_seconds_per_km"]) == Decimal("375.000")

    jan2025 = a.get(f"{OWNER_URL}?period=month&year=2025&month=1").json()["data"]
    assert jan2025["activity_count"] == 1 and Decimal(jan2025["distance_m"]) == 5000
    assert Decimal(jan2025["duration_sum_seconds"]) == 3000
    assert Decimal(jan2025["avg_pace_seconds_per_km"]) == Decimal("600.000")

    empty_year = a.get(f"{OWNER_URL}?period=year&year=2023").json()["data"]
    assert empty_year["activity_count"] == 0 and Decimal(empty_year["distance_m"]) == 0
    assert empty_year["duration_sum_seconds"] is None
    assert empty_year["avg_pace_seconds_per_km"] is None


def test_timer_priority_and_missing_duration_conventions(clients):
    a, _, _, app = clients
    owner = register(a)
    with app.state.session_factory.begin() as db:
        # Device timer_seconds (1200) must take precedence over elapsed_seconds (1500).
        add_activity(db, owner, "2024-05-01", 4000, 1500, "complete", timer=1200)
        # Incomplete track timestamps still qualify when device timer_seconds is present.
        add_activity(db, owner, "2024-05-02", 2000, None, "incomplete", timer=600)
        # Missing duration only month: duration and pace stay null.
        add_activity(db, owner, "2024-06-01", 3000, None, "incomplete")
    freeze(a, app, now=datetime(2026, 3, 6, 12, tzinfo=UTC))

    may = a.get(f"{OWNER_URL}?period=month&year=2024&month=5").json()["data"]
    assert may["activity_count"] == 2 and Decimal(may["distance_m"]) == 6000
    assert Decimal(may["duration_sum_seconds"]) == 1800
    assert may["pace_eligible_count"] == 2
    assert Decimal(may["avg_pace_seconds_per_km"]) == Decimal("300.000")

    jun = a.get(f"{OWNER_URL}?period=month&year=2024&month=6").json()["data"]
    assert jun["activity_count"] == 1 and Decimal(jun["distance_m"]) == 3000
    assert jun["duration_sum_seconds"] is None and jun["missing_duration_count"] == 1
    assert jun["avg_pace_seconds_per_km"] is None and jun["pace_eligible_count"] == 0


def test_current_period_cuts_off_future_activities_using_owner_timezone_clock(clients):
    a, _, _, app = clients
    owner = register(a)
    with app.state.session_factory.begin() as db:
        add_activity(db, owner, "2026-01-10", 4000, 1200, "complete")
        add_activity(db, owner, "2026-03-05", 5000, 1500, "complete")
        add_activity(db, owner, "2026-03-06", 3000, 900, "complete")
        add_activity(db, owner, "2026-03-07", 2000, 600, "complete")  # tomorrow (Asia/Shanghai)
        add_activity(db, owner, "2026-05-10", 5000, 1500, "complete")  # future month in 2026
        add_activity(db, owner, "2027-01-04", 5000, 1500, "complete")  # future year
    # 2026-03-06 12:00 UTC is 2026-03-06 20:00 Asia/Shanghai.
    freeze(a, app, now=datetime(2026, 3, 6, 12, tzinfo=UTC))

    cur_month = a.get(f"{OWNER_URL}?period=month&year=2026&month=3").json()["data"]
    assert cur_month["is_partial"] is True and cur_month["cutoff_date"] == "2026-03-06"
    assert (cur_month["date_from"], cur_month["date_to"]) == ("2026-03-01", "2026-03-07")
    assert cur_month["activity_count"] == 2 and Decimal(cur_month["distance_m"]) == 8000
    assert Decimal(cur_month["duration_sum_seconds"]) == 2400
    assert Decimal(cur_month["avg_pace_seconds_per_km"]) == Decimal("300.000")

    cur_year = a.get(f"{OWNER_URL}?period=year&year=2026").json()["data"]
    assert cur_year["is_partial"] is True and cur_year["cutoff_date"] == "2026-03-06"
    assert (cur_year["date_from"], cur_year["date_to"]) == ("2026-01-01", "2026-03-07")
    assert cur_year["activity_count"] == 3 and Decimal(cur_year["distance_m"]) == 12000
    assert Decimal(cur_year["duration_sum_seconds"]) == 3600

    future_month = a.get(f"{OWNER_URL}?period=month&year=2026&month=5").json()["data"]
    assert future_month["is_partial"] is False and future_month["cutoff_date"] is None
    assert (future_month["date_from"], future_month["date_to"]) == ("2026-05-01", "2026-05-01")
    assert future_month["activity_count"] == 0 and future_month["duration_sum_seconds"] is None

    future_year = a.get(f"{OWNER_URL}?period=year&year=2027").json()["data"]
    assert future_year["is_partial"] is False and future_year["activity_count"] == 0
    assert (future_year["date_from"], future_year["date_to"]) == ("2027-01-01", "2027-01-01")

    # 2026-03-06 16:30 UTC is 2026-03-07 00:30 Asia/Shanghai: 2026-03-07 now counts.
    freeze(a, app, now=datetime(2026, 3, 6, 16, 30, tzinfo=UTC))
    rolled = a.get(f"{OWNER_URL}?period=month&year=2026&month=3").json()["data"]
    assert rolled["today"] == "2026-03-07" and rolled["cutoff_date"] == "2026-03-07"
    assert (rolled["date_from"], rolled["date_to"]) == ("2026-03-01", "2026-03-08")
    assert rolled["activity_count"] == 3 and Decimal(rolled["distance_m"]) == 10000


def test_cross_account_isolation_auth_validation_and_showcase_privacy(report_history):
    a, b, app, _, other = report_history

    mine = a.get(f"{OWNER_URL}?period=month&year=2024&month=1").json()["data"]
    theirs = b.get(f"{OWNER_URL}?period=month&year=2024&month=1").json()["data"]
    assert mine["activity_count"] == 3 and Decimal(mine["distance_m"]) == 6000
    assert theirs["activity_count"] == 1 and Decimal(theirs["distance_m"]) == 10000
    assert Decimal(theirs["duration_sum_seconds"]) == 3600

    # Root showcase matches site owner and never leaks private fields or accepts owner overrides.
    shown = a.get(f"{SHOWCASE_URL}?period=month&year=2024&month=1")
    assert shown.status_code == 200 and shown.json()["data"] == mine
    for forbidden in ("Synthetic report run", "private-note-never-leaked", "email", "filename"):
        assert forbidden not in shown.text
    for key in ("owner", "user_id", "email", "username"):
        assert a.get(f"{SHOWCASE_URL}?period=month&year=2024&month=1&{key}=x").status_code == 422

    # Named showcase serves only enabled accounts and isolates their data.
    with app.state.session_factory.begin() as db:
        other_user = db.scalar(select(User).where(User.id == other))
        other_username = other_user.username
    assert (
        a.get(
            f"/api/v1/showcase/users/{other_username}/statistics/report?period=month&year=2024&month=1"
        ).status_code
        == 404
    )
    with app.state.session_factory.begin() as db:
        other_user = db.scalar(select(User).where(User.id == other))
        other_user.showcase_enabled = True
    named = a.get(
        f"/api/v1/showcase/users/{other_username}/statistics/report?period=month&year=2024&month=1"
    )
    assert named.status_code == 200 and named.json()["data"] == theirs

    # Query validation and auth guard.
    for query in [
        "period=month&year=2024",
        "period=month&year=2024&month=13",
        "period=year&year=2024&month=1",
        "period=week&year=2024",
        "period=year&year=1899",
        "period=year&year=2101",
    ]:
        assert a.get(f"{OWNER_URL}?{query}").status_code == 422
    b.cookies.clear()
    assert b.get(f"{OWNER_URL}?period=month&year=2024&month=1").status_code == 401
