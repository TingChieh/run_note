"""Consecutive local activity dates; no location or public-record inference."""

from datetime import date, timedelta

from sqlalchemy import select

from app.modules.activities.model import Activity


def runs(days, today, step):
    longest = current = length = 0
    previous = None
    for day in sorted(set(days)):
        length = length + 1 if previous is not None and day - previous == step else 1
        longest = max(longest, length)
        previous = day
    if previous is not None and today - previous in (timedelta(0), step):
        current = length
    return current, longest


def streak_summary(activity_dates, today: date):
    days = {day for day in activity_dates if day <= today}
    monday = today - timedelta(days=today.weekday())
    weeks = {day - timedelta(days=day.weekday()) for day in days}
    current_days, longest_days = runs(days, today, timedelta(days=1))
    current_weeks, longest_weeks = runs(weeks, monday, timedelta(days=7))
    return {
        "today": today.isoformat(),
        "current_days": current_days,
        "longest_days": longest_days,
        "current_weeks": current_weeks,
        "longest_weeks": longest_weeks,
        "week": [
            {
                "date": (monday + timedelta(days=i)).isoformat(),
                "active": monday + timedelta(days=i) in days,
            }
            for i in range(7)
        ],
    }


def read_streaks(db, owner, today):
    days = db.scalars(
        select(Activity.activity_date)
        .where(Activity.user_id == owner, Activity.activity_date <= today)
        .distinct()
    )
    return streak_summary(days, today)
