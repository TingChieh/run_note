"""Personal bests and same-period comparisons built from activity summaries only."""

from datetime import date, timedelta
from decimal import ROUND_HALF_EVEN, Decimal
from typing import Annotated

from fastapi import Query
from sqlalchemy import func, select

from app.core.errors import ApiError
from app.modules.activities.classify import DISTANCE_BANDS
from app.modules.activities.model import Activity as A
from app.modules.statistics import service
from app.modules.statistics.schema import (
    CategoryBest,
    ComparisonDelta,
    MonthPoint,
    PersonalBest,
    Records,
    Trends,
    WeekdayPoint,
    WeekPoint,
    YearComparison,
    YearTotals,
)

OptionalYear = Annotated[int | None, Query(ge=1900, le=2100)]
BEST_CATEGORIES = ("5km", "10km")
BEST_BANDS: dict[str, tuple[Decimal, Decimal]] = {
    label: (low, high) for label, low, high in DISTANCE_BANDS if label in BEST_CATEGORIES
}
WEEKS = 26


def resolve_years(today: date, year: int | None, compare_year: int | None) -> tuple[int, int]:
    year = today.year if year is None else year
    compare_year = year - 1 if compare_year is None else compare_year
    if compare_year < 1900 or compare_year == year:
        raise ApiError(422, "VALIDATION_ERROR", "请选择不同且在 1900–2100 年内的对比年份")
    return year, compare_year


def year_cutoff(year: int, today: date) -> date:
    return today if year == today.year else date(year, 12, 31)


def shift_to_year(day: date, year: int) -> date:
    try:
        return day.replace(year=year)
    except ValueError:  # February 29 in a non-leap target year
        return day.replace(year=year, day=28)


def resolve_cutoffs(today: date, year: int, compare_year: int) -> tuple[date, date]:
    """Inclusive cutoff days for `year` and `compare_year`.

    A year that is the current year is cut at today. When only the comparison year is the
    current one, both sides are cut at the same calendar day so a partial year is never
    compared with a full one; otherwise a past year runs to December 31.
    """
    if compare_year == today.year and year != today.year:
        return shift_to_year(today, year), today
    cutoff = year_cutoff(year, today)
    return cutoff, shift_to_year(cutoff, compare_year)


def weekly_active_days(activity_dates, today: date, weeks: int = WEEKS) -> list[WeekPoint]:
    current = today - timedelta(days=today.weekday())
    starts = [current - timedelta(weeks=weeks - 1 - i) for i in range(weeks)]
    counts = dict.fromkeys(starts, 0)
    for day in set(activity_dates):
        monday = day - timedelta(days=day.weekday())
        if day <= today and monday in counts:
            counts[monday] += 1
    return [WeekPoint(week_start=start, active_days=counts[start]) for start in starts]


def weekday_counts(daily) -> list[WeekdayPoint]:
    counts = [0] * 7
    for day, count in daily:
        counts[day.weekday()] += count
    return [WeekdayPoint(weekday=i, activity_count=n) for i, n in enumerate(counts)]


def month_points(trends: Trends) -> list[MonthPoint]:
    return [
        MonthPoint(
            month=bucket.bucket_start.month,
            activity_count=bucket.activity_count,
            distance_m=bucket.distance_m,
            avg_pace_seconds_per_km=bucket.avg_pace_seconds_per_km,
        )
        for bucket in trends.buckets
    ]


def padded_month_points(trends: Trends) -> list[MonthPoint]:
    """Month points for a range that may end mid-year, zero-filled up to 12 entries."""
    points = month_points(trends)
    seen = {point.month for point in points}
    points += [
        MonthPoint(
            month=month, activity_count=0, distance_m=Decimal(0), avg_pace_seconds_per_km=None
        )
        for month in range(1, 13)
        if month not in seen
    ]
    return sorted(points, key=lambda point: point.month)


def comparison_delta(current: YearTotals, previous: YearTotals) -> ComparisonDelta:
    missing = current.avg_pace_seconds_per_km is None or previous.avg_pace_seconds_per_km is None
    return ComparisonDelta(
        activity_count=current.activity_count - previous.activity_count,
        distance_m=current.distance_m - previous.distance_m,
        activity_days=current.activity_days - previous.activity_days,
        avg_pace_seconds_per_km=None
        if missing
        else current.avg_pace_seconds_per_km - previous.avg_pace_seconds_per_km,
    )


def year_totals(db, owner, year: int, cutoff: date) -> YearTotals:
    summary = service.summary(db, owner, date(year, 1, 1), cutoff + timedelta(days=1))
    return YearTotals(
        year=year,
        activity_count=summary.activity_count,
        distance_m=summary.distance_m,
        activity_days=summary.activity_days,
        avg_pace_seconds_per_km=summary.avg_pace_seconds_per_km,
    )


def personal_best(db, owner, low: Decimal, high: Decimal) -> PersonalBest | None:
    """Fastest reliable whole activity within [low, high]; ties go to the earlier date."""
    duration = service.duration_expression()
    pace = duration * 1000 / A.distance_m
    row = db.execute(
        select(
            A.id,
            A.activity_date,
            A.distance_m,
            duration.label("duration_seconds"),
            func.count().over().label("qualifying_count"),
        )
        .where(
            A.user_id == owner,
            service.eligible_expression(),
            A.distance_m >= low,
            A.distance_m <= high,
        )
        .order_by(pace.asc(), A.activity_date.asc(), A.id.asc())
        .limit(1)
    ).one_or_none()
    if row is None:
        return None
    distance, seconds = Decimal(row.distance_m), Decimal(row.duration_seconds)
    return PersonalBest(
        activity_id=row.id,
        activity_date=row.activity_date,
        distance_m=distance,
        duration_seconds=seconds,
        avg_pace_seconds_per_km=(seconds * 1000 / distance).quantize(
            Decimal(".001"), rounding=ROUND_HALF_EVEN
        ),
        qualifying_count=row.qualifying_count,
    )


def build_records(
    db, owner, today: date, year: int | None = None, compare_year: int | None = None
) -> Records:
    year, compare_year = resolve_years(today, year, compare_year)
    cutoff, compare_cutoff = resolve_cutoffs(today, year, compare_year)
    first, following = date(year, 1, 1), date(year + 1, 1, 1)
    monthly = service.trends(db, owner, first, following, "month")
    # Same period: the comparison series ends at its own cutoff; later months are zero.
    compare_monthly = service.trends(
        db, owner, date(compare_year, 1, 1), compare_cutoff + timedelta(days=1), "month"
    )
    daily = service.query(db, owner, first, following, daily=True)
    current_week = today - timedelta(days=today.weekday())
    week_dates = db.scalars(
        select(A.activity_date)
        .where(
            A.user_id == owner,
            A.activity_date >= current_week - timedelta(weeks=WEEKS - 1),
            A.activity_date <= today,
        )
        .distinct()
    ).all()
    current = year_totals(db, owner, year, cutoff)
    previous = year_totals(db, owner, compare_year, compare_cutoff)
    return Records(
        year=year,
        compare_year=compare_year,
        cutoff_date=cutoff,
        compare_cutoff_date=compare_cutoff,
        personal_bests=[
            CategoryBest(category=label, best=personal_best(db, owner, low, high))
            for label, (low, high) in BEST_BANDS.items()
        ],
        monthly=month_points(monthly),
        compare_monthly=padded_month_points(compare_monthly),
        weekly=weekly_active_days(week_dates, today),
        weekday=weekday_counts((row["date"], row["activity_count"]) for row in daily),
        comparison=YearComparison(
            current=current, previous=previous, delta=comparison_delta(current, previous)
        ),
    )
