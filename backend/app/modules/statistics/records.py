"""Personal bests, first runs and all-history overviews built from activity summaries only."""

from collections.abc import Mapping
from datetime import date, timedelta
from decimal import ROUND_HALF_EVEN, Decimal

from sqlalchemy import DateTime, cast, extract, func, select

from app.modules.activities.classify import DISTANCE_BANDS
from app.modules.activities.model import Activity as A
from app.modules.statistics import service
from app.modules.statistics.schema import (
    CategoryBest,
    FirstRun,
    MonthPoint,
    PersonalBest,
    Records,
    Summary,
    Totals,
    WeekdayPoint,
    WeekPoint,
    YearDelta,
    YearRow,
)

BEST_CATEGORIES = ("5km", "10km")
BEST_BANDS: dict[str, tuple[Decimal, Decimal]] = {
    label: (low, high) for label, low, high in DISTANCE_BANDS if label in BEST_CATEGORIES
}
WEEKS = 26
PACE_STEP = Decimal(".001")


def shift_to_year(day: date, year: int) -> date:
    try:
        return day.replace(year=year)
    except ValueError:  # February 29 in a non-leap target year
        return day.replace(year=year, day=28)


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


def pick_run(db, owner, low: Decimal, high: Decimal, *order):
    """First reliable whole activity within [low, high] for the given ordering, with its count."""
    duration = service.duration_expression()
    return db.execute(
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
        .order_by(*order)
        .limit(1)
    ).one_or_none()


def run_values(row) -> dict:
    distance, seconds = Decimal(row.distance_m), Decimal(row.duration_seconds)
    return {
        "activity_id": row.id,
        "activity_date": row.activity_date,
        "distance_m": distance,
        "duration_seconds": seconds,
        "avg_pace_seconds_per_km": (seconds * 1000 / distance).quantize(
            PACE_STEP, rounding=ROUND_HALF_EVEN
        ),
    }


def personal_best(db, owner, low: Decimal, high: Decimal) -> PersonalBest | None:
    """Fastest reliable whole activity within [low, high]; ties go to the earlier date."""
    pace = service.duration_expression() * 1000 / A.distance_m
    row = pick_run(db, owner, low, high, pace.asc(), A.activity_date.asc(), A.id.asc())
    if row is None:
        return None
    return PersonalBest(**run_values(row), qualifying_count=row.qualifying_count)


def first_run(db, owner, low: Decimal, high: Decimal) -> FirstRun | None:
    """Earliest reliable whole activity within [low, high], under the same rules as the best."""
    row = pick_run(
        db, owner, low, high, A.activity_date.asc(), A.started_at.asc().nulls_last(), A.id.asc()
    )
    return None if row is None else FirstRun(**run_values(row))


def pace_gain(best: PersonalBest | None, first: FirstRun | None) -> Decimal | None:
    """Seconds per km the best is faster than the first run; None unless it is a real gain."""
    if best is None or first is None or best.activity_id == first.activity_id:
        return None
    gain = (first.avg_pace_seconds_per_km - best.avg_pace_seconds_per_km).quantize(
        PACE_STEP, rounding=ROUND_HALF_EVEN
    )
    return gain if gain > 0 else None


def month_after(day: date) -> date:
    return date(day.year + (day.month == 12), day.month % 12 + 1, 1)


def fill_months(points: list[MonthPoint], today: date) -> list[MonthPoint]:
    """Continuous month timeline from the first month with data to the current month."""
    if not points:
        return []
    known = {point.month_start: point for point in points}
    cursor = min(known)
    end = max(max(known), today.replace(day=1))
    filled = []
    while cursor <= end:
        filled.append(
            known.get(cursor)
            or MonthPoint(
                month_start=cursor,
                activity_count=0,
                distance_m=Decimal(0),
                avg_pace_seconds_per_km=None,
            )
        )
        cursor = month_after(cursor)
    return filled


def monthly_series(db, owner, today: date) -> list[MonthPoint]:
    # group/order by the output label: a repeated expression would bind "month" twice and
    # PostgreSQL then cannot prove the select list matches GROUP BY.
    month = func.date_trunc("month", cast(A.activity_date, DateTime)).label("m")
    rows = (
        db.execute(
            select(month, *service.expressions())
            .where(A.user_id == owner)
            .group_by(month)
            .order_by(month)
        )
        .mappings()
        .all()
    )
    points = []
    for row in rows:
        total = service.finalize(row)
        points.append(
            MonthPoint(
                month_start=row["m"].date(),
                activity_count=total.activity_count,
                distance_m=total.distance_m,
                avg_pace_seconds_per_km=total.avg_pace_seconds_per_km,
            )
        )
    return fill_months(points, today)


def year_delta(current: Summary, previous: Summary) -> YearDelta:
    missing = current.avg_pace_seconds_per_km is None or previous.avg_pace_seconds_per_km is None
    return YearDelta(
        activity_count=current.activity_count - previous.activity_count,
        distance_m=current.distance_m - previous.distance_m,
        avg_pace_seconds_per_km=None
        if missing
        else current.avg_pace_seconds_per_km - previous.avg_pace_seconds_per_km,
    )


def build_year_rows(
    totals: Mapping[int, Summary], today: date, same_period_previous: Summary | None
) -> list[YearRow]:
    """Ascending yearly rows from the first year to the current one, empty years included.

    The current year is partial: it is compared with `same_period_previous` (last year up to
    the same calendar day) instead of a full previous year.
    """
    if not totals:
        return []
    empty = service.finalize({})
    rows = []
    for year in range(min(totals), max(max(totals), today.year) + 1):
        current = totals.get(year, empty)
        delta, basis = None, None
        if year > min(totals):
            if year == today.year:
                previous, basis = same_period_previous or empty, "previous_year_same_period"
            else:
                previous, basis = totals.get(year - 1, empty), "previous_year"
            delta = year_delta(current, previous)
        rows.append(
            YearRow(
                year=year,
                activity_count=current.activity_count,
                distance_m=current.distance_m,
                activity_days=current.activity_days,
                avg_pace_seconds_per_km=current.avg_pace_seconds_per_km,
                is_partial=year == today.year,
                delta=delta,
                delta_basis=basis,
            )
        )
    return rows


def yearly_rows(db, owner, today: date) -> list[YearRow]:
    year = extract("year", A.activity_date)
    grouped = db.execute(
        select(year.label("y"), *service.expressions())
        .where(A.user_id == owner)
        .group_by(year)
        .order_by(year)
    ).mappings()
    totals = {int(row["y"]): service.finalize(row) for row in grouped}
    same_period = None
    if totals and today.year > min(totals):
        end = shift_to_year(today, today.year - 1) + timedelta(days=1)
        same_period = service.summary(db, owner, date(today.year - 1, 1, 1), end)
    return build_year_rows(totals, today, same_period)


def all_time_totals(db, owner) -> Totals:
    total = service.finalize(service.query(db, owner)[0])
    return Totals(
        activity_count=total.activity_count,
        distance_m=total.distance_m,
        activity_days=total.activity_days,
        avg_pace_seconds_per_km=total.avg_pace_seconds_per_km,
        first_activity_date=db.scalar(select(func.min(A.activity_date)).where(A.user_id == owner)),
    )


def category_best(db, owner, label: str, low: Decimal, high: Decimal) -> CategoryBest:
    best, first = personal_best(db, owner, low, high), first_run(db, owner, low, high)
    return CategoryBest(
        category=label, best=best, first=first, pace_gain_seconds_per_km=pace_gain(best, first)
    )


def build_records(db, owner, today: date) -> Records:
    daily = service.query(db, owner, daily=True)
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
    return Records(
        personal_bests=[
            category_best(db, owner, label, low, high) for label, (low, high) in BEST_BANDS.items()
        ],
        totals=all_time_totals(db, owner),
        monthly=monthly_series(db, owner, today),
        weekly=weekly_active_days(week_dates, today),
        weekday=weekday_counts((row["date"], row["activity_count"]) for row in daily),
        yearly=yearly_rows(db, owner, today),
    )
