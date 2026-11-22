"""Server-only read-only AI assistant tools.

Every tool injects owner identity, timezone, and clock date from the authenticated
server context; no arbitrary SQL, no write operations, and no cross-user parameters exist.
"""

from dataclasses import dataclass
from datetime import date, timedelta
from decimal import ROUND_HALF_EVEN, Decimal
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ValidationError
from sqlalchemy import func, select, text
from sqlalchemy.exc import DBAPIError

from app.core.errors import ApiError
from app.modules.activities import service as activities_service
from app.modules.activities.model import Activity as A
from app.modules.ai_assistant.blocks import build_ui_blocks
from app.modules.ai_assistant.privacy import MAX_TOOL_OUTPUT_BYTES, sanitize_tool_output
from app.modules.ai_assistant.schema import (
    ActivityDetailInput,
    ComparePeriodsInput,
    FootprintSummaryInput,
    FrequentRoutesInput,
    PeriodReportInput,
    PersonalRecordsInput,
    RunningSummaryInput,
    RunningTrendsInput,
    SearchActivitiesInput,
    StreaksAndGoalsInput,
    UIBlock,
)
from app.modules.footprints import global_atlas, provinces
from app.modules.footprints.model import ActivityGlobalFootprintCache, ActivityProvinceCache
from app.modules.gpx.model import ActivitySegment
from app.modules.route_groups import service as route_groups_service
from app.modules.running_goals.model import RunningGoal
from app.modules.statistics import records as records_service
from app.modules.statistics import service as statistics_service
from app.modules.statistics import streaks as streaks_service
from app.modules.statistics.device_metrics import (
    change_rate,
    device_summaries,
    device_summary_for_range,
)
from app.modules.statistics.device_metrics import (
    finalize as finalize_device_metrics,
)

DEFAULT_STATEMENT_TIMEOUT_MS = 3000
FOOTPRINT_STATEMENT_TIMEOUT_MS = 5000
MAX_TREND_BUCKETS = 60
MAX_MONTHLY_RECORD_POINTS = 36
MAX_ROUTE_GROUP_RUNS = 10


@dataclass(frozen=True)
class ToolContext:
    owner_id: UUID
    timezone: str
    today: date


@dataclass(frozen=True)
class ToolExecutionResult:
    tool_name: str
    model_payload: dict[str, Any]
    ui_blocks: list[UIBlock]
    degraded: bool = False
    truncated: bool = False


class ToolInputError(ApiError):
    def __init__(self, message: str):
        super().__init__(422, "AI_TOOL_INPUT_INVALID", message)


def _dec_str(value: Decimal | float | int | None, step: str = ".001") -> str | None:
    if value is None:
        return None
    return str(Decimal(str(value)).quantize(Decimal(step), rounding=ROUND_HALF_EVEN))


def _summary_limitations(summary_data: dict[str, Any]) -> list[str]:
    notes = [
        "指标按活动本地日期归属，用时优先采用设备用时，否则采用轨迹经过时间。",
        "平均配速按可靠距离与有效用时加权计算，缺失耗时不按零计算。",
        "平均心率按有效用时加权估计，热量与步数为已知记录小计，缺失记录不参与。",
    ]
    if summary_data["activity_count"] == 0:
        notes.append("所选范围内没有运动记录。")
    elif summary_data["quality_warning_count"] > 0:
        notes.append("部分活动存在时间质量警告，分析结论需结合原记录核对。")
    return notes


def _run_get_running_summary(db, ctx: ToolContext, args: RunningSummaryInput) -> dict[str, Any]:
    total = statistics_service.summary(db, ctx.owner_id, args.date_from, args.date_to)
    device = device_summary_for_range(db, ctx.owner_id, args.date_from, args.date_to)
    summary_json = total.model_dump(mode="json")
    return {
        "date_from": args.date_from.isoformat() if args.date_from else None,
        "date_to": args.date_to.isoformat() if args.date_to else None,
        "scope": "all_time" if args.date_from is None else "range",
        "summary": summary_json,
        "device_metrics": device,
        "limitations": _summary_limitations(summary_json),
    }


def _run_get_running_trends(db, ctx: ToolContext, args: RunningTrendsInput) -> dict[str, Any]:
    trend = statistics_service.trends(db, ctx.owner_id, args.date_from, args.date_to, args.period)
    device_weeks: dict[date, dict[str, Any]] = {}
    if args.include_device_metrics and args.period == "week":
        _, device_weeks = device_summaries(db, ctx.owner_id, args.date_from, args.date_to)
    raw_buckets = trend.buckets
    truncated = len(raw_buckets) > MAX_TREND_BUCKETS
    if truncated:
        raw_buckets = raw_buckets[-MAX_TREND_BUCKETS:]
    buckets = []
    previous: Decimal | None = None
    for bucket in raw_buckets:
        values = bucket.model_dump(mode="json")
        values["distance_change_pct"] = (
            None if previous is None else change_rate(bucket.distance_m, previous)
        )
        if args.include_device_metrics and args.period == "week":
            # device_summaries keys each week by Monday (date_trunc('week', ...)) while still
            # filtering to [date_from, date_to), so partial first weeks look up their Monday key.
            week_monday = bucket.bucket_start - timedelta(days=bucket.bucket_start.weekday())
            values["device_metrics"] = device_weeks.get(week_monday, finalize_device_metrics({}))
        buckets.append(values)
        previous = bucket.distance_m
    return {
        "period": trend.period,
        "date_from": trend.date_from.isoformat(),
        "date_to": trend.date_to.isoformat(),
        "week_start": trend.week_start,
        "date_assignment": trend.date_assignment,
        "truncated": truncated,
        "buckets": buckets,
    }


def _run_get_period_report(db, ctx: ToolContext, args: PeriodReportInput) -> dict[str, Any]:
    report = statistics_service.period_report(
        db, ctx.owner_id, args.period, args.year, args.month, ctx.today
    )
    return report.model_dump(mode="json")


def _run_compare_periods(db, ctx: ToolContext, args: ComparePeriodsInput) -> dict[str, Any]:
    a_sum = statistics_service.summary(
        db, ctx.owner_id, args.period_a.date_from, args.period_a.date_to
    )
    b_sum = statistics_service.summary(
        db, ctx.owner_id, args.period_b.date_from, args.period_b.date_to
    )
    a_dev = device_summary_for_range(
        db, ctx.owner_id, args.period_a.date_from, args.period_a.date_to
    )
    b_dev = device_summary_for_range(
        db, ctx.owner_id, args.period_b.date_from, args.period_b.date_to
    )
    pace_diff = (
        _dec_str(a_sum.avg_pace_seconds_per_km - b_sum.avg_pace_seconds_per_km)
        if a_sum.avg_pace_seconds_per_km is not None and b_sum.avg_pace_seconds_per_km is not None
        else None
    )
    hr_diff = (
        _dec_str(Decimal(a_dev["avg_heart_rate_bpm"]) - Decimal(b_dev["avg_heart_rate_bpm"]))
        if a_dev["avg_heart_rate_bpm"] is not None and b_dev["avg_heart_rate_bpm"] is not None
        else None
    )
    return {
        "period_a": {
            "label": args.period_a.label or "period_a",
            "date_from": args.period_a.date_from.isoformat(),
            "date_to": args.period_a.date_to.isoformat(),
            "summary": a_sum.model_dump(mode="json"),
            "device_metrics": a_dev,
        },
        "period_b": {
            "label": args.period_b.label or "period_b",
            "date_from": args.period_b.date_from.isoformat(),
            "date_to": args.period_b.date_to.isoformat(),
            "summary": b_sum.model_dump(mode="json"),
            "device_metrics": b_dev,
        },
        "delta": {
            "activity_count_diff": a_sum.activity_count - b_sum.activity_count,
            "activity_days_diff": a_sum.activity_days - b_sum.activity_days,
            "distance_m_diff": _dec_str(a_sum.distance_m - b_sum.distance_m),
            "distance_change_pct": change_rate(a_sum.distance_m, b_sum.distance_m),
            "avg_pace_seconds_per_km_diff": pace_diff,
            "avg_heart_rate_bpm_diff": hr_diff,
        },
    }


def _run_get_personal_records(db, ctx: ToolContext, args: PersonalRecordsInput) -> dict[str, Any]:
    wanted = set(args.sections)
    result: dict[str, Any] = {"date_assignment": "activity_local_date"}
    if "personal_bests" in wanted:
        result["personal_bests"] = [
            records_service.category_best(db, ctx.owner_id, label, low, high).model_dump(
                mode="json"
            )
            for label, (low, high) in records_service.BEST_BANDS.items()
        ]
    if "totals" in wanted:
        result["totals"] = records_service.all_time_totals(db, ctx.owner_id).model_dump(mode="json")
    if "yearly" in wanted:
        result["yearly"] = [
            row.model_dump(mode="json")
            for row in records_service.yearly_rows(db, ctx.owner_id, ctx.today)
        ]
    if "weekday" in wanted:
        daily = statistics_service.query(db, ctx.owner_id, daily=True)
        result["weekday"] = [
            row.model_dump(mode="json")
            for row in records_service.weekday_counts(
                (item["date"], item["activity_count"]) for item in daily
            )
        ]
    if "weekly" in wanted:
        current_week = ctx.today - timedelta(days=ctx.today.weekday())
        week_dates = db.scalars(
            select(A.activity_date)
            .where(
                A.user_id == ctx.owner_id,
                A.activity_date >= current_week - timedelta(weeks=records_service.WEEKS - 1),
                A.activity_date <= ctx.today,
            )
            .distinct()
        ).all()
        result["weekly"] = [
            row.model_dump(mode="json")
            for row in records_service.weekly_active_days(week_dates, ctx.today)
        ]
    if "monthly" in wanted:
        monthly = records_service.monthly_series(db, ctx.owner_id, ctx.today)
        if len(monthly) > MAX_MONTHLY_RECORD_POINTS:
            monthly = monthly[-MAX_MONTHLY_RECORD_POINTS:]
            result["monthly_truncated"] = True
        result["monthly"] = [row.model_dump(mode="json") for row in monthly]
    return result


def _run_get_streaks_and_goals(db, ctx: ToolContext, _args: StreaksAndGoalsInput) -> dict[str, Any]:
    streaks = streaks_service.read_streaks(db, ctx.owner_id, ctx.today)
    goal_rows = db.scalars(select(RunningGoal).where(RunningGoal.user_id == ctx.owner_id)).all()
    targets = {row.period: Decimal(str(row.target_km)) for row in goal_rows}

    monday = ctx.today - timedelta(days=ctx.today.weekday())
    month_start = ctx.today.replace(day=1)
    year_start = date(ctx.today.year, 1, 1)
    tomorrow = ctx.today + timedelta(days=1)

    goals: dict[str, dict[str, Any]] = {}
    for period, start in (("week", monday), ("month", month_start), ("year", year_start)):
        period_sum = statistics_service.summary(db, ctx.owner_id, start, tomorrow)
        completed_km = (period_sum.distance_m / Decimal(1000)).quantize(
            Decimal(".001"), rounding=ROUND_HALF_EVEN
        )
        target_km = targets.get(period)
        progress_pct = (
            str((completed_km * 100 / target_km).quantize(Decimal(".1"), rounding=ROUND_HALF_EVEN))
            if target_km and target_km > 0
            else None
        )
        goals[period] = {
            "target_km": str(target_km) if target_km is not None else None,
            "completed_km": str(completed_km),
            "progress_pct": progress_pct,
        }
    return {"today": ctx.today.isoformat(), "streaks": streaks, "goals": goals}


def _run_search_activities(db, ctx: ToolContext, args: SearchActivitiesInput) -> dict[str, Any]:
    if args.date_from is not None and args.date_to is not None:
        statistics_service.validate_range(args.date_from, args.date_to)
    filters = [A.user_id == ctx.owner_id]
    if args.date_from is not None:
        filters.append(A.activity_date >= args.date_from)
    if args.date_to is not None:
        filters.append(A.activity_date < args.date_to)
    if args.category is not None:
        filters.append(A.category == args.category)
    if args.min_distance_m is not None:
        filters.append(A.distance_m >= Decimal(args.min_distance_m))
    if args.max_distance_m is not None:
        filters.append(A.distance_m <= Decimal(args.max_distance_m))

    order_map = {
        "date_desc": (A.activity_date.desc(), A.id.desc()),
        "date_asc": (A.activity_date.asc(), A.id.asc()),
        "distance_desc": (A.distance_m.desc(), A.activity_date.desc(), A.id.desc()),
        "pace_asc": (
            A.avg_pace_seconds_per_km.asc().nulls_last(),
            A.activity_date.desc(),
            A.id.desc(),
        ),
    }
    duration = func.coalesce(A.timer_seconds, A.elapsed_seconds).label("duration_seconds")
    # Never select title, tags, or notes here (D3 & L3 privacy isolation).
    rows = (
        db.execute(
            select(
                A.id,
                A.activity_date,
                A.category,
                A.distance_m,
                duration,
                A.avg_pace_seconds_per_km,
                A.avg_heart_rate_bpm,
                A.temporal_quality,
            )
            .where(*filters)
            .order_by(*order_map[args.sort])
            .limit(args.limit)
        )
        .mappings()
        .all()
    )
    ids = [row["id"] for row in rows]
    routed = (
        set(
            db.scalars(
                select(ActivitySegment.activity_id)
                .where(ActivitySegment.activity_id.in_(ids))
                .distinct()
            )
        )
        if ids
        else set()
    )
    total = int(db.scalar(select(func.count()).select_from(A).where(*filters)) or 0)
    return {
        "total": total,
        "items": [
            {
                "activity_id": str(row["id"]),
                "activity_date": row["activity_date"].isoformat(),
                "category": row["category"],
                "distance_m": _dec_str(row["distance_m"]),
                "duration_seconds": _dec_str(row["duration_seconds"]),
                "avg_pace_seconds_per_km": _dec_str(row["avg_pace_seconds_per_km"]),
                "avg_heart_rate_bpm": row["avg_heart_rate_bpm"],
                "temporal_quality": row["temporal_quality"],
                "has_route": row["id"] in routed,
            }
            for row in rows
        ],
    }


def _cached_activity_places(db, owner_id: UUID, activity_id: UUID) -> tuple[list[str], list[str]]:
    prov_codes = db.scalar(
        select(ActivityProvinceCache.province_codes).where(
            ActivityProvinceCache.user_id == owner_id,
            ActivityProvinceCache.activity_id == activity_id,
            ActivityProvinceCache.atlas_version == provinces.atlas_version(),
        )
    )
    prov_names_map = provinces.province_names()
    prov_names = [prov_names_map[c] for c in (prov_codes or []) if c in prov_names_map]

    city_codes = db.scalar(
        select(ActivityGlobalFootprintCache.city_codes).where(
            ActivityGlobalFootprintCache.user_id == owner_id,
            ActivityGlobalFootprintCache.activity_id == activity_id,
            ActivityGlobalFootprintCache.atlas_version == global_atlas.atlas_version(),
        )
    )
    cities_by_code = global_atlas._atlas()["cities_by_code"] if city_codes else {}
    city_names = [cities_by_code[c]["name"] for c in (city_codes or []) if c in cities_by_code]
    return prov_names, city_names


def _run_get_activity_detail(db, ctx: ToolContext, args: ActivityDetailInput) -> dict[str, Any]:
    view = activities_service.detail(db, ctx.owner_id, args.activity_id)
    duration = view.timer_seconds if view.timer_seconds is not None else view.elapsed_seconds
    warnings = (
        view.quality_summary.get("warnings", []) if isinstance(view.quality_summary, dict) else []
    )
    prov_names, city_names = _cached_activity_places(db, ctx.owner_id, args.activity_id)
    return {
        "activity_id": str(view.id),
        "activity_date": view.activity_date.isoformat(),
        "timezone": view.timezone,
        "category": view.category,
        "distance_m": _dec_str(view.distance_m),
        "elapsed_seconds": _dec_str(view.elapsed_seconds),
        "timer_seconds": _dec_str(view.timer_seconds),
        "duration_seconds": _dec_str(duration),
        "avg_pace_seconds_per_km": _dec_str(view.avg_pace_seconds_per_km),
        "calories_kcal": view.calories_kcal,
        "steps": view.steps,
        "avg_heart_rate_bpm": view.avg_heart_rate_bpm,
        "max_heart_rate_bpm": view.max_heart_rate_bpm,
        "min_heart_rate_bpm": view.min_heart_rate_bpm,
        "avg_cadence_spm": _dec_str(view.avg_cadence_spm),
        "max_cadence_spm": _dec_str(view.max_cadence_spm),
        "vo2_max_ml_kg_min": _dec_str(view.vo2_max_ml_kg_min),
        "training_load": _dec_str(view.training_load),
        "aerobic_training_effect": _dec_str(view.aerobic_training_effect),
        "anaerobic_training_effect": _dec_str(view.anaerobic_training_effect),
        "temporal_quality": view.temporal_quality,
        "quality_warnings": [str(w) for w in warnings if isinstance(w, str)][:10],
        "has_route": view.has_route,
        "provinces": prov_names,
        "cities": city_names,
    }


def _cached_china_provinces_only(
    db, owner_id: UUID, year: int | None, limit: int
) -> dict[str, Any]:
    params: dict[str, Any] = {"owner": owner_id, "version": provinces.atlas_version()}
    date_filter = ""
    if year is not None:
        params.update(start=date(year, 1, 1), end=date(year + 1, 1, 1))
        date_filter = " AND a.activity_date >= :start AND a.activity_date < :end"
    total_activities = int(
        db.scalar(
            text(f"SELECT count(*) FROM activities a WHERE a.user_id = :owner{date_filter}"), params
        )
        or 0
    )
    rows = db.execute(
        text(
            f"""SELECT c.province_codes FROM activity_province_caches c
            JOIN activities a ON a.id = c.activity_id
            WHERE c.user_id = :owner AND c.atlas_version = :version{date_filter}"""
        ),
        params,
    ).scalars()
    counts: dict[int, int] = {}
    located = 0
    for codes in rows:
        if codes:
            located += 1
        for code in codes:
            counts[code] = counts.get(code, 0) + 1
    names = provinces.province_names()
    items = sorted(
        (
            {"code": code, "name": names[code], "activity_count": count}
            for code, count in counts.items()
            if code in names
        ),
        key=lambda item: (-item["activity_count"], item["code"]),
    )
    return {
        "scope": "china",
        "year": year,
        "total_provinces": 34,
        "visited_province_count": len(items),
        "activity_count": total_activities,
        "located_activity_count": located,
        "cached_only": True,
        "provinces": items[:limit],
    }


def _cached_global_footprints_only(
    db, owner_id: UUID, year: int | None, limit: int
) -> dict[str, Any]:
    params: dict[str, Any] = {"owner": owner_id, "version": global_atlas.atlas_version()}
    date_filter = ""
    if year is not None:
        params.update(start=date(year, 1, 1), end=date(year + 1, 1, 1))
        date_filter = " AND a.activity_date >= :start AND a.activity_date < :end"
    total_activities = int(
        db.scalar(
            text(f"SELECT count(*) FROM activities a WHERE a.user_id = :owner{date_filter}"), params
        )
        or 0
    )
    cached = db.execute(
        text(
            f"""SELECT c.region_codes, c.city_codes, COALESCE(a.distance_m, 0)
            FROM activity_global_footprint_caches c
            JOIN activities a ON a.id = c.activity_id
            WHERE c.user_id = :owner AND c.atlas_version = :version{date_filter}"""
        ),
        params,
    ).all()
    atlas = global_atlas._atlas()
    regions_by_code = atlas["regions_by_code"]
    cities_by_code = atlas["cities_by_code"]
    located = 0
    countries_map: dict[str, dict[str, Any]] = {}
    regions_map: dict[str, dict[str, Any]] = {}
    region_counts: dict[str, int] = {}
    region_distances: dict[str, float] = {}
    city_counts: dict[str, int] = {}
    city_distances: dict[str, float] = {}
    country_counts: dict[str, int] = {}
    country_distances: dict[str, float] = {}

    for r_codes, c_codes, dist in cached:
        dist_f = float(dist or 0)
        if r_codes or c_codes:
            located += 1
        hit_countries = set()
        for rc in r_codes:
            region_counts[rc] = region_counts.get(rc, 0) + 1
            region_distances[rc] = region_distances.get(rc, 0.0) + dist_f
            if rc in regions_by_code:
                hit_countries.add(regions_by_code[rc]["country_code"])
        for cc in hit_countries:
            country_counts[cc] = country_counts.get(cc, 0) + 1
            country_distances[cc] = country_distances.get(cc, 0.0) + dist_f
        for city_code in c_codes:
            city_counts[city_code] = city_counts.get(city_code, 0) + 1
            city_distances[city_code] = city_distances.get(city_code, 0.0) + dist_f

    for rc, count in region_counts.items():
        reg = regions_by_code.get(rc)
        if not reg:
            continue
        cc = reg["country_code"]
        c_entry = countries_map.setdefault(
            cc,
            {
                "code": cc,
                "name": reg["country_name"],
                "activity_count": country_counts.get(cc, 0),
                "distance_m": round(country_distances.get(cc, 0.0), 1),
                "regions": [],
            },
        )
        r_entry = {
            "code": rc,
            "name": reg["name"],
            "activity_count": count,
            "distance_m": round(region_distances.get(rc, 0.0), 1),
            "cities": [],
        }
        c_entry["regions"].append(r_entry)
        regions_map[rc] = r_entry

    for city_code, count in city_counts.items():
        city = cities_by_code.get(city_code)
        if not city:
            continue
        r_entry = regions_map.get(city["region_code"])
        if not r_entry:
            continue
        r_entry["cities"].append(
            {
                "code": city_code,
                "name": city["name"],
                "activity_count": count,
                "distance_m": round(city_distances.get(city_code, 0.0), 1),
            }
        )

    countries = []
    for c_entry in countries_map.values():
        for r_entry in c_entry["regions"]:
            r_entry["cities"].sort(key=lambda x: (-x["activity_count"], x["code"]))
        c_entry["regions"].sort(key=lambda x: (-x["activity_count"], x["code"]))
        c_entry["region_count"] = len(c_entry["regions"])
        c_entry["city_count"] = sum(len(r["cities"]) for r in c_entry["regions"])
        countries.append(c_entry)
    countries.sort(key=lambda x: (-x["activity_count"], x["code"]))

    return {
        "scope": "global",
        "year": year,
        "activity_count": total_activities,
        "located_activity_count": located,
        "country_count": len(countries),
        "region_count": len(region_counts),
        "city_count": len(city_counts),
        "cached_only": True,
        "countries": countries[:limit],
    }


def _run_get_footprint_summary(db, ctx: ToolContext, args: FootprintSummaryInput) -> dict[str, Any]:
    if args.scope == "china":
        try:
            data = provinces.province_summary(db, ctx.owner_id, args.year)
        except ApiError as error:
            if error.code == "PROVINCE_LIMIT":
                return _cached_china_provinces_only(db, ctx.owner_id, args.year, args.limit)
            raise
        items = sorted(data["provinces"], key=lambda item: (-item["activity_count"], item["code"]))
        return {
            "scope": "china",
            "year": data["year"],
            "total_provinces": data["total"],
            "visited_province_count": len(items),
            "activity_count": data["activity_count"],
            "located_activity_count": data["located_activity_count"],
            "cached_only": False,
            "provinces": items[: args.limit],
        }

    try:
        data = global_atlas.global_summary(db, ctx.owner_id, args.year)
    except ApiError as error:
        if error.code == "FOOTPRINT_LIMIT":
            return _cached_global_footprints_only(db, ctx.owner_id, args.year, args.limit)
        raise
    countries = data["countries"]
    return {
        "scope": "global",
        "year": data["year"],
        "activity_count": data["activity_count"],
        "located_activity_count": data["located_activity_count"],
        "country_count": len(countries),
        "region_count": data["region_count"],
        "city_count": data["city_count"],
        "cached_only": False,
        "countries": countries[: args.limit],
    }


def _format_route_group(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "group_id": str(row["id"]),
        "run_count": int(row["run_count"]),
        "first_date": row["first_date"].isoformat(),
        "last_date": row["last_date"].isoformat(),
        "median_distance_m": _dec_str(row["median_distance_m"]),
        "best_duration_seconds": _dec_str(row["best_duration_seconds"]),
        "avg_duration_seconds": _dec_str(row["avg_duration_seconds"]),
        "best_pace_seconds_per_km": _dec_str(row["best_pace_seconds_per_km"]),
        "avg_pace_seconds_per_km": _dec_str(row["avg_pace_seconds_per_km"]),
    }


def _run_get_frequent_routes(db, ctx: ToolContext, args: FrequentRoutesInput) -> dict[str, Any]:
    if args.group_id is not None:
        detail = route_groups_service.group_detail(db, ctx.owner_id, args.group_id)
        runs = detail["runs"]
        return {
            "group": _format_route_group(detail),
            "total_runs": len(runs),
            "runs": [
                {
                    "activity_id": str(run["activity_id"]),
                    "activity_date": run["activity_date"].isoformat(),
                    "distance_m": _dec_str(run["distance_m"]),
                    "duration_seconds": _dec_str(run["duration_seconds"]),
                    "avg_pace_seconds_per_km": _dec_str(run["avg_pace_seconds_per_km"]),
                    "coverage": round(float(run["coverage"]), 3),
                }
                for run in runs[:MAX_ROUTE_GROUP_RUNS]
            ],
        }
    listing = route_groups_service.list_groups(db, ctx.owner_id, args.limit, 0, args.sort)
    return {
        "total": int(listing["total"]),
        "building": bool(listing["building"]),
        "groups": [_format_route_group(item) for item in listing["items"]],
    }


@dataclass(frozen=True)
class _ToolSpec:
    name: str
    description: str
    input_model: type[BaseModel]
    handler: Any
    timeout_ms: int = DEFAULT_STATEMENT_TIMEOUT_MS


_TOOL_SPECS: dict[str, _ToolSpec] = {
    spec.name: spec
    for spec in (
        _ToolSpec(
            name="get_running_summary",
            description="查询当前用户在指定日期范围（左闭右开）或全历史的跑步总次数、距离、天数、有效时长、加权配速与设备指标汇总。",
            input_model=RunningSummaryInput,
            handler=_run_get_running_summary,
        ),
        _ToolSpec(
            name="get_running_trends",
            description="按周、月或年分桶查询当前用户在指定日期范围内的跑量、次数、配速与环比变化趋势。",
            input_model=RunningTrendsInput,
            handler=_run_get_running_trends,
        ),
        _ToolSpec(
            name="get_period_report",
            description="查询当前用户指定自然月或自然年的统计报告，包含截至今日的部分周期标记。",
            input_model=PeriodReportInput,
            handler=_run_get_period_report,
        ),
        _ToolSpec(
            name="compare_periods",
            description="对比当前用户两个日期区间的跑步汇总指标，并在服务端计算精确差值与变化率。",
            input_model=ComparePeriodsInput,
            handler=_run_compare_periods,
        ),
        _ToolSpec(
            name="get_personal_records",
            description=(
                "查询当前用户的 5km/10km 最佳成绩与首跑、全历史总计、"
                "逐年对比、星期分布、近26周活跃天数或月度序列。"
            ),
            input_model=PersonalRecordsInput,
            handler=_run_get_personal_records,
        ),
        _ToolSpec(
            name="get_streaks_and_goals",
            description=(
                "查询当前用户的连续跑步天数/周数、本周活跃情况，"
                "以及周/月/年跑量目标与当前完成进度。"
            ),
            input_model=StreaksAndGoalsInput,
            handler=_run_get_streaks_and_goals,
        ),
        _ToolSpec(
            name="search_activities",
            description=(
                "按日期范围、里程分类、距离范围与排序方式检索当前用户的跑步记录摘要"
                "（最多返回20条，不含备注与坐标）。"
            ),
            input_model=SearchActivitiesInput,
            handler=_run_search_activities,
        ),
        _ToolSpec(
            name="get_activity_detail",
            description=(
                "按 activity_id 查询当前用户单次跑步的详细权威运动指标与所在省市名称"
                "（不含备注与坐标）。"
            ),
            input_model=ActivityDetailInput,
            handler=_run_get_activity_detail,
        ),
        _ToolSpec(
            name="get_footprint_summary",
            description=(
                "查询当前用户跑过的中国省份或全球国家/地区/城市汇总计数与里程"
                "（不含经纬度与轨迹坐标）。"
            ),
            input_model=FootprintSummaryInput,
            handler=_run_get_footprint_summary,
            timeout_ms=FOOTPRINT_STATEMENT_TIMEOUT_MS,
        ),
        _ToolSpec(
            name="get_frequent_routes",
            description=(
                "查询当前用户的常跑路线组汇总统计，或按 group_id 查看某条常跑路线的"
                "近期跑步摘要（不含轨迹坐标）。"
            ),
            input_model=FrequentRoutesInput,
            handler=_run_get_frequent_routes,
        ),
    )
}

TOOL_NAMES: tuple[str, ...] = tuple(_TOOL_SPECS)


def tool_definitions() -> list[dict[str, Any]]:
    """Return OpenAI/DeepSeek function-calling schemas for all 10 read-only tools."""
    return [
        {
            "type": "function",
            "function": {
                "name": spec.name,
                "description": spec.description,
                "parameters": spec.input_model.model_json_schema(),
            },
        }
        for spec in _TOOL_SPECS.values()
    ]


def execute_tool(
    db,
    ctx: ToolContext,
    tool_name: str,
    raw_arguments: dict[str, Any] | str | None,
    *,
    max_output_bytes: int = MAX_TOOL_OUTPUT_BYTES,
) -> ToolExecutionResult:
    """Validate tool name + StrictInput arguments, run owner-scoped read query, sanitize output."""
    spec = _TOOL_SPECS.get(tool_name)
    if spec is None:
        raise ToolInputError(f"不支持的工具名称：{tool_name}")

    try:
        if raw_arguments is None:
            parsed = spec.input_model.model_validate({})
        elif isinstance(raw_arguments, str):
            parsed = spec.input_model.model_validate_json(raw_arguments)
        elif isinstance(raw_arguments, dict):
            parsed = spec.input_model.model_validate(raw_arguments)
        else:
            raise ToolInputError("工具参数必须为 JSON 对象")
    except ValidationError:
        raise ToolInputError(f"工具 {tool_name} 参数校验失败") from None

    degraded = False
    try:
        if tool_name == "get_footprint_summary":
            # Footprint summaries enforce their own 5000ms statement_timeout and call
            # db.rollback() on timeout before falling back to cache-only aggregation.
            raw_result = spec.handler(db, ctx, parsed)
        else:
            with db.begin_nested():
                db.execute(text(f"SET LOCAL statement_timeout = '{spec.timeout_ms}ms'"))
                raw_result = spec.handler(db, ctx, parsed)
                db.execute(text("SET LOCAL statement_timeout = DEFAULT"))
    except DBAPIError as error:
        if getattr(error.orig, "sqlstate", None) == "57014":
            degraded = True
            raw_result = {
                "degraded": True,
                "reason": "timeout",
                "message": "该查询耗时较长已降级，请缩小日期范围或稍后重试。",
            }
        else:
            raise

    if raw_result.get("cached_only") is True:
        degraded = True

    sanitized, truncated = sanitize_tool_output(tool_name, raw_result, max_bytes=max_output_bytes)
    blocks = build_ui_blocks(tool_name, sanitized)
    return ToolExecutionResult(
        tool_name=tool_name,
        model_payload=sanitized,
        ui_blocks=blocks,
        degraded=degraded,
        truncated=truncated,
    )
