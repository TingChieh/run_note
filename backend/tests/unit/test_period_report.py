from datetime import date

import pytest

from app.core.errors import ApiError
from app.modules.statistics.service import period_bounds


def test_past_month_uses_natural_half_open_bounds_including_leap_february_and_december():
    assert period_bounds("month", 2024, 1, today=date(2026, 3, 6)) == (
        date(2024, 1, 1),
        date(2024, 2, 1),
        False,
        None,
    )
    assert period_bounds("month", 2024, 2, today=date(2026, 3, 6)) == (
        date(2024, 2, 1),
        date(2024, 3, 1),
        False,
        None,
    )
    assert period_bounds("month", 2023, 2, today=date(2026, 3, 6)) == (
        date(2023, 2, 1),
        date(2023, 3, 1),
        False,
        None,
    )
    assert period_bounds("month", 2024, 12, today=date(2026, 3, 6)) == (
        date(2024, 12, 1),
        date(2025, 1, 1),
        False,
        None,
    )


def test_past_year_uses_natural_half_open_bounds_including_extremes():
    assert period_bounds("year", 2024, None, today=date(2026, 3, 6)) == (
        date(2024, 1, 1),
        date(2025, 1, 1),
        False,
        None,
    )
    assert period_bounds("year", 1900, None, today=date(2026, 3, 6)) == (
        date(1900, 1, 1),
        date(1901, 1, 1),
        False,
        None,
    )
    assert period_bounds("month", 2100, 12, today=date(2101, 1, 1)) == (
        date(2100, 12, 1),
        date(2101, 1, 1),
        False,
        None,
    )


def test_current_month_and_current_year_cut_off_after_today():
    today = date(2026, 3, 6)
    assert period_bounds("month", 2026, 3, today=today) == (
        date(2026, 3, 1),
        date(2026, 3, 7),
        True,
        today,
    )
    assert period_bounds("year", 2026, None, today=today) == (
        date(2026, 1, 1),
        date(2026, 3, 7),
        True,
        today,
    )


def test_current_period_on_leap_day_or_year_end_stops_at_natural_end():
    leap = date(2024, 2, 29)
    assert period_bounds("month", 2024, 2, today=leap) == (
        date(2024, 2, 1),
        date(2024, 3, 1),
        True,
        leap,
    )
    year_end = date(2026, 12, 31)
    assert period_bounds("year", 2026, None, today=year_end) == (
        date(2026, 1, 1),
        date(2027, 1, 1),
        True,
        year_end,
    )


def test_future_month_and_future_year_yield_empty_half_open_window():
    today = date(2026, 3, 6)
    assert period_bounds("month", 2026, 4, today=today) == (
        date(2026, 4, 1),
        date(2026, 4, 1),
        False,
        None,
    )
    assert period_bounds("year", 2027, None, today=today) == (
        date(2027, 1, 1),
        date(2027, 1, 1),
        False,
        None,
    )


@pytest.mark.parametrize(
    ("period", "year", "month"),
    [
        ("month", 2024, None),
        ("month", 2024, 0),
        ("month", 2024, 13),
        ("year", 2024, 1),
        ("year", 1899, None),
        ("year", 2101, None),
    ],
)
def test_invalid_period_arguments_raise_422(period, year, month):
    with pytest.raises(ApiError) as error:
        period_bounds(period, year, month, today=date(2026, 3, 6))
    assert error.value.status_code == 422
    assert error.value.code == "VALIDATION_ERROR"


def test_report_route_is_registered_for_owner_showcase_and_named_showcase():
    from app.modules.showcase.router import named_router
    from app.modules.showcase.router import router as showcase_router
    from app.modules.statistics.router import router as statistics_router

    for router in (statistics_router, showcase_router, named_router):
        assert any(
            route.path.endswith("/statistics/report") or route.path == "/api/v1/statistics/report"
            for route in router.routes
        )
