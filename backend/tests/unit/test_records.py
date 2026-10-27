from datetime import date, timedelta
from decimal import Decimal
from uuid import uuid4

from app.modules.statistics import service
from app.modules.statistics.records import (
    BEST_BANDS,
    WEEKS,
    build_year_rows,
    fill_months,
    pace_gain,
    shift_to_year,
    weekday_counts,
    weekly_active_days,
)
from app.modules.statistics.schema import (
    FirstRun,
    MonthPoint,
    PersonalBest,
    WeekdayPoint,
    WeekPoint,
)


def summary(count, distance, pace_seconds=None):
    """A Summary for `count` activities of `distance` metres total at the given pace."""
    raw = {
        "activity_count": count,
        "distance_m": Decimal(distance),
        "activity_days": count,
        "known_duration_count": count,
        "duration_sum_seconds": Decimal(0),
    }
    if pace_seconds is not None:
        raw |= {
            "pace_eligible_count": count,
            "pace_eligible_distance_m": Decimal(distance),
            "eligible_duration": Decimal(distance) / 1000 * Decimal(pace_seconds),
        }
    return service.finalize(raw)


def month(day, count=1, distance="5000", pace="300"):
    return MonthPoint(
        month_start=day,
        activity_count=count,
        distance_m=Decimal(distance),
        avg_pace_seconds_per_km=None if pace is None else Decimal(pace),
    )


def best(pace, activity_id=None):
    return PersonalBest(
        activity_id=activity_id or uuid4(),
        activity_date=date(2026, 3, 5),
        distance_m=Decimal(5000),
        duration_seconds=Decimal(pace) * 5,
        avg_pace_seconds_per_km=Decimal(pace),
        qualifying_count=3,
    )


def first(pace, activity_id=None):
    return FirstRun(
        activity_id=activity_id or uuid4(),
        activity_date=date(2024, 1, 10),
        distance_m=Decimal(5000),
        duration_seconds=Decimal(pace) * 5,
        avg_pace_seconds_per_km=Decimal(pace),
    )


def test_best_bands_follow_the_distance_classifier():
    assert BEST_BANDS == {
        "5km": (Decimal(4000), Decimal(7500)),
        "10km": (Decimal(9000), Decimal(12000)),
    }


def test_leap_day_moves_to_february_28_only_when_needed():
    assert shift_to_year(date(2024, 2, 29), 2023) == date(2023, 2, 28)
    assert shift_to_year(date(2024, 2, 29), 2028) == date(2028, 2, 29)
    assert shift_to_year(date(2026, 10, 26), 2025) == date(2025, 10, 26)


def test_weekly_active_days_counts_distinct_days_and_ignores_future_and_old_weeks():
    today = date(2026, 10, 14)  # Wednesday
    days = [
        date(2026, 10, 12),
        date(2026, 10, 12),
        date(2026, 10, 13),
        date(2026, 10, 15),
        date(2026, 10, 5),
        date(2026, 4, 13),
    ]
    weeks = weekly_active_days(days, today)
    assert len(weeks) == WEEKS == 26
    assert weeks[-1] == WeekPoint(week_start=date(2026, 10, 12), active_days=2)
    assert weeks[-2] == WeekPoint(week_start=date(2026, 10, 5), active_days=1)
    assert weeks[0].week_start == date(2026, 10, 12) - timedelta(weeks=25)
    assert sum(week.active_days for week in weeks) == 3


def test_weekday_counts_start_on_monday_and_include_zero_days():
    daily = [(date(2024, 7, 1), 2), (date(2024, 7, 2), 1), (date(2024, 7, 8), 1)]
    points = weekday_counts(daily)
    assert [p.weekday for p in points] == list(range(7))
    assert [p.activity_count for p in points] == [3, 1, 0, 0, 0, 0, 0]
    assert points[0] == WeekdayPoint(weekday=0, activity_count=3)


def test_records_route_is_registered_for_owner_showcase_and_named_showcase():
    from app.modules.showcase.router import named_router
    from app.modules.showcase.router import router as showcase_router
    from app.modules.statistics.router import router as statistics_router

    for router in (statistics_router, showcase_router, named_router):
        assert any(
            route.path.endswith("/statistics/records") or route.path == "/api/v1/statistics/records"
            for route in router.routes
        )


def test_records_routes_accept_no_year_parameters():
    from app.modules.showcase.router import router as showcase_router
    from app.modules.statistics.router import router as statistics_router

    for router in (statistics_router, showcase_router):
        route = next(r for r in router.routes if r.path.endswith("/statistics/records"))
        names = {param.name for param in route.dependant.query_params}
        assert not names & {"year", "compare_year"}


def test_no_months_without_activity():
    assert fill_months([], date(2026, 10, 26)) == []


def test_months_are_continuous_from_the_first_month_to_the_current_month():
    points = fill_months(
        [month(date(2026, 7, 1)), month(date(2026, 9, 1), count=2, distance="9000")],
        date(2026, 10, 26),
    )
    assert [p.month_start for p in points] == [
        date(2026, 7, 1),
        date(2026, 8, 1),
        date(2026, 9, 1),
        date(2026, 10, 1),
    ]
    gap, current = points[1], points[3]
    for empty in (gap, current):
        assert empty.activity_count == 0
        assert empty.distance_m == Decimal(0)
        assert empty.avg_pace_seconds_per_km is None
    assert points[2].activity_count == 2 and points[2].distance_m == Decimal(9000)


def test_months_cross_year_boundaries_and_keep_the_current_month_when_it_has_runs():
    points = fill_months([month(date(2025, 11, 1)), month(date(2026, 2, 1))], date(2026, 2, 3))
    assert [p.month_start for p in points] == [
        date(2025, 11, 1),
        date(2025, 12, 1),
        date(2026, 1, 1),
        date(2026, 2, 1),
    ]
    assert [p.activity_count for p in points] == [1, 0, 0, 1]


def test_future_dated_months_extend_the_timeline_past_today():
    points = fill_months([month(date(2026, 9, 1)), month(date(2026, 12, 1))], date(2026, 10, 26))
    assert [p.month_start for p in points][-1] == date(2026, 12, 1)
    assert [p.activity_count for p in points] == [1, 0, 0, 1]


def test_a_single_month_in_the_past_is_extended_to_today():
    points = fill_months([month(date(2026, 9, 1))], date(2026, 10, 1))
    assert [p.month_start for p in points] == [date(2026, 9, 1), date(2026, 10, 1)]


def test_years_are_ascending_and_empty_years_are_zero_filled():
    rows = build_year_rows(
        {2023: summary(2, 15000, 340), 2025: summary(3, 20000, 300)}, date(2026, 10, 26), None
    )
    assert [r.year for r in rows] == [2023, 2024, 2025, 2026]
    empty = rows[1]
    assert empty.activity_count == 0 and empty.distance_m == Decimal(0)
    assert empty.activity_days == 0 and empty.avg_pace_seconds_per_km is None


def test_first_year_has_no_delta_and_later_years_compare_with_the_previous_year():
    rows = build_year_rows(
        {2023: summary(2, 15000, 340), 2024: summary(8, 57500, 300)}, date(2026, 10, 26), None
    )
    first_row, second = rows[0], rows[1]
    assert first_row.delta is None and first_row.delta_basis is None
    assert second.delta_basis == "previous_year"
    assert second.delta.activity_count == 6
    assert second.delta.distance_m == Decimal(42500)
    assert second.delta.avg_pace_seconds_per_km == Decimal("-40")
    # 2025 is a year without runs: compared with 2024 it goes to zero, pace unknown
    gap = rows[2]
    assert gap.delta.activity_count == -8 and gap.delta.distance_m == Decimal(-57500)
    assert gap.delta.avg_pace_seconds_per_km is None


def test_the_current_year_is_partial_and_compares_with_the_same_period_of_last_year():
    today = date(2026, 10, 26)
    rows = build_year_rows(
        {2025: summary(20, 100000, 330), 2026: summary(4, 22000, 300)},
        today,
        summary(3, 15000, 320),
    )
    previous, current = rows
    assert (previous.is_partial, current.is_partial) == (False, True)
    assert previous.delta_basis is None  # first year
    assert current.delta_basis == "previous_year_same_period"
    assert current.delta.activity_count == 1
    assert current.delta.distance_m == Decimal(7000)
    assert current.delta.avg_pace_seconds_per_km == Decimal("-20")


def test_the_current_year_without_runs_still_has_a_row_with_zero_totals():
    rows = build_year_rows({2025: summary(2, 10000, 300)}, date(2026, 1, 5), summary(0, 0))
    current = rows[-1]
    assert current.year == 2026 and current.is_partial
    assert current.activity_count == 0 and current.distance_m == Decimal(0)
    assert current.delta.activity_count == 0 and current.delta.avg_pace_seconds_per_km is None


def test_when_the_current_year_is_the_first_year_there_is_no_delta():
    rows = build_year_rows({2026: summary(1, 5000, 300)}, date(2026, 10, 26), None)
    assert len(rows) == 1
    assert rows[0].is_partial and rows[0].delta is None and rows[0].delta_basis is None


def test_future_years_extend_the_rows_and_only_the_current_year_is_partial():
    rows = build_year_rows(
        {2026: summary(1, 5000, 300), 2027: summary(1, 5000, 290)},
        date(2026, 10, 26),
        summary(0, 0),
    )
    assert [r.year for r in rows] == [2026, 2027]
    assert [r.is_partial for r in rows] == [True, False]
    assert rows[1].delta_basis == "previous_year"


def test_no_years_without_activity():
    assert build_year_rows({}, date(2026, 10, 26), None) == []


def test_pace_gain_is_first_minus_best_with_three_decimals():
    gain = pace_gain(best("280"), first(Decimal("322.4567")))
    assert gain == Decimal("42.457")
    assert pace_gain(best("280.5"), first("322.5")) == Decimal("42.000")


def test_pace_gain_is_missing_when_either_side_is_missing_or_not_an_improvement():
    shared = uuid4()
    assert pace_gain(None, first("300")) is None
    assert pace_gain(best("280"), None) is None
    assert pace_gain(best("280", shared), first("280", shared)) is None
    assert pace_gain(best("300"), first("300")) is None  # different runs, no gain
    assert pace_gain(best("310"), first("300")) is None  # defensive: never a negative gain
