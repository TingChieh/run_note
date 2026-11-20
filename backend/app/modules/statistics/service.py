"""Owner-filtered aggregate queries on activity summaries, never track points."""

from datetime import date, timedelta
from decimal import ROUND_HALF_EVEN, Decimal
from typing import Literal

from sqlalchemy import case, func, select

from app.core.errors import ApiError
from app.modules.activities.model import Activity as A
from app.modules.statistics.schema import (
    Bucket,
    Calendar,
    CalendarDay,
    PeriodReport,
    Summary,
    Trends,
)


def validate_range(start, end, *, optional=False):
    if optional and start is None and end is None:
        return
    if start is None or end is None or start >= end:
        raise ApiError(422, "VALIDATION_ERROR", "请提供有效的起止日期（结束日期不包含在内）")
    if start < date(1900, 1, 1) or start > date(2100, 12, 31) or end > date(2101, 1, 1):
        raise ApiError(422, "VALIDATION_ERROR", "统计日期支持1900–2100年")
    ceiling = (
        start.replace(year=start.year + 5, day=min(start.day, 28))
        if start.month == 2
        else start.replace(year=start.year + 5)
    )
    if end > ceiling:
        raise ApiError(422, "VALIDATION_ERROR", "统计日期支持1900–2100年，单次范围最多5年")


def duration_expression():
    return func.coalesce(A.timer_seconds, A.elapsed_seconds)


def eligible_expression():
    return (
        (A.distance_m > 0)
        & (duration_expression() > 0)
        & (A.timer_seconds.is_not(None) | A.temporal_quality.in_(["complete", "manual"]))
    )


def expressions():
    duration = duration_expression()
    known = duration.is_not(None)
    eligible = eligible_expression()
    warnings = A.quality_summary["warnings"]
    warning_count = case(
        (func.jsonb_typeof(warnings) == "array", func.jsonb_array_length(warnings)), else_=0
    )
    return [
        func.count().label("activity_count"),
        func.coalesce(func.sum(A.distance_m), 0).label("distance_m"),
        func.count(func.distinct(A.activity_date)).label("activity_days"),
        func.sum(duration).label("duration_sum_seconds"),
        func.count().filter(known).label("known_duration_count"),
        func.count().filter(~known).label("missing_duration_count"),
        func.count().filter(eligible).label("pace_eligible_count"),
        func.coalesce(func.sum(A.distance_m).filter(eligible), 0).label("pace_eligible_distance_m"),
        func.coalesce(func.sum(duration).filter(eligible), 0).label("eligible_duration"),
        func.count()
        .filter((warning_count > 0) | A.temporal_quality.in_(["incomplete", "invalid"]))
        .label("quality_warning_count"),
    ]


def query(db, owner, start=None, end=None, *, daily=False, public_only=False):
    statement = select(*([A.activity_date.label("date")] if daily else []), *expressions()).where(
        A.user_id == owner
    )
    if public_only:
        statement = statement.where(A.visibility == "public")
    if start is not None:
        statement = statement.where(A.activity_date >= start, A.activity_date < end)
    if daily:
        statement = statement.group_by(A.activity_date).order_by(A.activity_date)
    return [dict(row) for row in db.execute(statement).mappings()]


def pace_seconds_per_km(elapsed: Decimal, distance: Decimal) -> Decimal:
    """Seconds per kilometre, half-even to three decimals.

    Summaries and single-run records both call this, so a rounding change cannot
    make the same distance and time report two different paces.
    """
    return (elapsed * 1000 / distance).quantize(Decimal(".001"), rounding=ROUND_HALF_EVEN)


def finalize(raw):
    values = {
        key: raw.get(key, 0)
        for key in Summary.model_fields
        if key not in {"duration_sum_seconds", "avg_pace_seconds_per_km", "date_assignment"}
    }
    values["duration_sum_seconds"] = (
        raw.get("duration_sum_seconds") if values["known_duration_count"] else None
    )
    distance = Decimal(values["pace_eligible_distance_m"])
    elapsed = Decimal(raw.get("eligible_duration", 0))
    values["avg_pace_seconds_per_km"] = (
        pace_seconds_per_km(elapsed, distance) if distance > 0 and elapsed > 0 else None
    )
    return Summary(**values)


def summary(db, owner, start=None, end=None, *, public_only=False):
    validate_range(start, end, optional=True)
    return finalize(query(db, owner, start, end, public_only=public_only)[0])


def period_bounds(
    period: Literal["month", "year"],
    year: int,
    month: int | None,
    *,
    today: date,
) -> tuple[date, date, bool, date | None]:
    """Resolve natural month/year half-open bounds [date_from, date_to) capped at today."""
    if year < 1900 or year > 2100:
        raise ApiError(422, "VALIDATION_ERROR", "统计日期支持1900–2100年")
    if period == "month":
        if month is None or month < 1 or month > 12:
            raise ApiError(422, "VALIDATION_ERROR", "月度报告需要提供 1–12 的月份")
        period_start = date(year, month, 1)
        period_end = date(year + (month == 12), month % 12 + 1, 1)
    elif period == "year":
        if month is not None:
            raise ApiError(422, "VALIDATION_ERROR", "年度报告不支持月份参数")
        period_start = date(year, 1, 1)
        period_end = date(year + 1, 1, 1)
    else:
        raise ApiError(422, "VALIDATION_ERROR", "报告周期仅支持月度或年度")

    if period_start > today:
        return period_start, period_start, False, None
    is_partial = period_start <= today < period_end
    if is_partial:
        return period_start, min(period_end, today + timedelta(days=1)), True, today
    return period_start, period_end, False, None


def period_report(
    db,
    owner,
    period: Literal["month", "year"],
    year: int,
    month: int | None,
    today: date,
) -> PeriodReport:
    date_from, date_to, is_partial, cutoff_date = period_bounds(period, year, month, today=today)
    totals = finalize({}) if date_from == date_to else summary(db, owner, date_from, date_to)
    return PeriodReport(
        period=period,
        year=year,
        month=month,
        date_from=date_from,
        date_to=date_to,
        is_partial=is_partial,
        cutoff_date=cutoff_date,
        today=today,
        **totals.model_dump(),
    )


def calendar(db, owner, year, metric, *, public_only=False):
    start, end = date(year, 1, 1), date(year + 1, 1, 1)
    rows = query(db, owner, start, end, daily=True, public_only=public_only)
    indexed = {r["date"]: r for r in rows}
    days = []
    current = start
    while current < end:
        value = finalize(indexed.get(current, {}))
        days.append(CalendarDay(date=current, **value.model_dump()))
        current += timedelta(days=1)
    return Calendar(
        year=year,
        metric=metric,
        days=days,
        activity_count=sum(d.activity_count for d in days),
        distance_m=sum((d.distance_m for d in days), Decimal(0)),
    )


def next_boundary(current, period):
    if period == "week":
        return current + timedelta(days=7)
    if period == "year":
        return date(current.year + 1, 1, 1)
    return date(current.year + (current.month == 12), current.month % 12 + 1, 1)


def trends(db, owner, start, end, period):
    validate_range(start, end)
    rows = query(db, owner, start, end, daily=True)
    cursor = (
        start - timedelta(days=start.weekday())
        if period == "week"
        else date(start.year, start.month if period == "month" else 1, 1)
    )
    buckets, index = [], 0
    while cursor < end:
        following = next_boundary(cursor, period)
        left, right = max(start, cursor), min(end, following)
        raw = {}
        while index < len(rows) and rows[index]["date"] < right:
            for key, value in rows[index].items():
                if key != "date" and value is not None:
                    raw[key] = raw.get(key, 0) + value
            index += 1
        buckets.append(
            Bucket(
                bucket_start=left,
                bucket_end=right,
                is_partial=left != cursor or right != following,
                **finalize(raw).model_dump(),
            )
        )
        cursor = following
    return Trends(period=period, date_from=start, date_to=end, buckets=buckets)
