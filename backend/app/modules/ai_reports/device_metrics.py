"""Owner-scoped device summaries; no route points or source documents are read."""

from decimal import ROUND_HALF_EVEN, Decimal

from sqlalchemy import Date, func, select

from app.modules.activities.model import Activity as A

DEVICE_METRIC_KEYS = (
    "heart_rate_record_count",
    "heart_rate_weighted_count",
    "heart_rate_weighted_duration_seconds",
    "avg_heart_rate_bpm",
    "calories_record_count",
    "calories_kcal",
    "steps_record_count",
    "steps",
)


def finalize(raw):
    weighted_count = int(raw.get("heart_rate_weighted_count", 0))
    duration = Decimal(raw.get("weighted_duration", 0))
    weighted_sum = Decimal(raw.get("weighted_sum", 0))
    calories_count = int(raw.get("calories_record_count", 0))
    steps_count = int(raw.get("steps_record_count", 0))
    return {
        "heart_rate_record_count": int(raw.get("heart_rate_record_count", 0)),
        "heart_rate_weighted_count": weighted_count,
        "heart_rate_weighted_duration_seconds": (
            str(duration.quantize(Decimal(".001"), rounding=ROUND_HALF_EVEN))
            if weighted_count
            else None
        ),
        "avg_heart_rate_bpm": (
            str((weighted_sum / duration).quantize(Decimal(".001"), rounding=ROUND_HALF_EVEN))
            if weighted_count
            else None
        ),
        "calories_record_count": calories_count,
        "calories_kcal": int(raw.get("calories_kcal", 0)) if calories_count else None,
        "steps_record_count": steps_count,
        "steps": int(raw.get("steps", 0)) if steps_count else None,
    }


def device_summaries(db, owner, start, end):
    # Keep SQL sums unrounded across weeks so the overall mean is weighted by
    # duration, never by the number of weeks or rounded weekly means.
    duration = func.coalesce(A.timer_seconds, A.elapsed_seconds)
    has_heart_rate = A.avg_heart_rate_bpm.is_not(None)
    weighted = has_heart_rate & (duration > 0)
    week = func.date_trunc("week", A.activity_date).cast(Date)
    statement = (
        select(
            week.label("week"),
            func.count().filter(has_heart_rate).label("heart_rate_record_count"),
            func.count().filter(weighted).label("heart_rate_weighted_count"),
            func.sum(duration).filter(weighted).label("weighted_duration"),
            func.sum(A.avg_heart_rate_bpm * duration).filter(weighted).label("weighted_sum"),
            func.count(A.calories_kcal).label("calories_record_count"),
            func.sum(A.calories_kcal).label("calories_kcal"),
            func.count(A.steps).label("steps_record_count"),
            func.sum(A.steps).label("steps"),
        )
        .where(A.user_id == owner, A.activity_date >= start, A.activity_date < end)
        .group_by(week)
        .order_by(week)
    )
    totals, weeks = {}, {}
    for row in db.execute(statement).mappings():
        raw = {
            key: value if value is not None else 0 for key, value in row.items() if key != "week"
        }
        weeks[row["week"]] = finalize(raw)
        for key, value in raw.items():
            totals[key] = totals.get(key, 0) + value
    return finalize(totals), weeks
