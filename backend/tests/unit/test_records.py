from datetime import date, timedelta
from decimal import Decimal

import pytest

from app.core.errors import ApiError
from app.modules.statistics.records import (
    BEST_BANDS,
    WEEKS,
    comparison_delta,
    resolve_cutoffs,
    resolve_years,
    shift_to_year,
    weekday_counts,
    weekly_active_days,
    year_cutoff,
)
from app.modules.statistics.schema import WeekdayPoint, WeekPoint, YearTotals


def totals(year, count, distance, pace):
    return YearTotals(
        year=year,
        activity_count=count,
        distance_m=Decimal(distance),
        activity_days=count,
        avg_pace_seconds_per_km=None if pace is None else Decimal(pace),
    )


def test_best_bands_follow_the_distance_classifier():
    assert BEST_BANDS == {
        "5km": (Decimal(4000), Decimal(7500)),
        "10km": (Decimal(9000), Decimal(12000)),
    }


def test_years_default_to_today_and_the_year_before():
    assert resolve_years(date(2026, 10, 26), None, None) == (2026, 2025)
    assert resolve_years(date(2026, 10, 26), 2024, None) == (2024, 2023)
    assert resolve_years(date(2026, 10, 26), 2024, 2020) == (2024, 2020)


@pytest.mark.parametrize(("year", "compare"), [(2024, 2024), (1900, None), (None, 1899)])
def test_equal_or_out_of_range_comparison_year_is_rejected(year, compare):
    with pytest.raises(ApiError) as error:
        resolve_years(date(1900, 6, 1) if year == 1900 else date(2026, 10, 26), year, compare)
    assert error.value.status_code == 422
    assert error.value.code == "VALIDATION_ERROR"


def test_cutoff_is_today_for_the_current_year_and_year_end_otherwise():
    today = date(2026, 10, 26)
    assert year_cutoff(2026, today) == today
    assert year_cutoff(2025, today) == date(2025, 12, 31)
    assert year_cutoff(2027, today) == date(2027, 12, 31)


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


def test_delta_subtracts_previous_and_keeps_missing_pace_missing():
    delta = comparison_delta(
        totals(2024, 8, "57500", "304.211"), totals(2023, 2, "15000", "346.667")
    )
    assert delta.activity_count == 6
    assert delta.distance_m == Decimal("42500")
    assert delta.avg_pace_seconds_per_km == Decimal("-42.456")
    assert (
        comparison_delta(
            totals(2024, 1, "1", None), totals(2023, 1, "1", "300")
        ).avg_pace_seconds_per_km
        is None
    )


def test_records_route_is_registered_for_owner_showcase_and_named_showcase():
    from app.modules.showcase.router import named_router
    from app.modules.showcase.router import router as showcase_router
    from app.modules.statistics.router import router as statistics_router

    for router in (statistics_router, showcase_router, named_router):
        assert any(
            route.path.endswith("/statistics/records") or route.path == "/api/v1/statistics/records"
            for route in router.routes
        )


def test_cutoffs_use_today_for_the_current_year_and_its_calendar_twin():
    today = date(2026, 10, 26)
    assert resolve_cutoffs(today, 2026, 2025) == (date(2026, 10, 26), date(2025, 10, 26))
    assert resolve_cutoffs(today, 2024, 2023) == (date(2024, 12, 31), date(2023, 12, 31))


def test_comparing_a_past_year_with_the_current_year_cuts_both_at_today():
    today = date(2026, 10, 26)
    assert resolve_cutoffs(today, 2025, 2026) == (date(2025, 10, 26), date(2026, 10, 26))
    assert resolve_cutoffs(today, 2020, 2026) == (date(2020, 10, 26), date(2026, 10, 26))
    # a future year against a past year keeps the full-year rule
    assert resolve_cutoffs(today, 2027, 2025) == (date(2027, 12, 31), date(2025, 12, 31))


def test_cutoff_leap_day_is_shifted_for_the_other_year():
    leap_today = date(2024, 2, 29)
    assert resolve_cutoffs(leap_today, 2024, 2023) == (date(2024, 2, 29), date(2023, 2, 28))
    assert resolve_cutoffs(leap_today, 2023, 2024) == (date(2023, 2, 28), date(2024, 2, 29))
