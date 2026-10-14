from datetime import date

from app.modules.statistics.streaks import streak_summary


def test_empty_streak_and_week_are_real_zeros():
    data = streak_summary([], date(2026, 10, 14))
    assert data["current_days"] == data["longest_days"] == 0
    assert data["current_weeks"] == data["longest_weeks"] == 0
    assert len(data["week"]) == 7
    assert data["week"][0] == {"date": "2026-10-12", "active": False}


def test_deduplicates_dates_ignores_future_and_continues_yesterday():
    days = [date(2026, 10, d) for d in [5, 6, 7, 12, 12, 13, 15]]
    data = streak_summary(days, date(2026, 10, 14))
    assert data["current_days"] == 2
    assert data["longest_days"] == 3
    assert data["current_weeks"] == data["longest_weeks"] == 2
    assert [d["active"] for d in data["week"]] == [True, True, False, False, False, False, False]


def test_cross_year_and_leap_day_streaks_and_expired_grace():
    days = [date(2023, 12, 31), date(2024, 1, 1), date(2024, 2, 28), date(2024, 2, 29)]
    data = streak_summary(days, date(2024, 3, 1))
    assert data["current_days"] == data["longest_days"] == 2
    assert data["longest_weeks"] == 2
    assert streak_summary(days, date(2024, 3, 2))["current_days"] == 0
