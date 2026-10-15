from datetime import date, timedelta
from decimal import ROUND_HALF_EVEN, Decimal

from app.core.errors import ApiError
from app.modules.ai_reports.device_metrics import device_summaries, finalize
from app.modules.statistics import service as statistics


def default_range(today: date) -> tuple[date, date]:
    end = today - timedelta(days=today.weekday())
    return end - timedelta(days=28), end


def validate_range(start: date, end: date):
    statistics.validate_range(start, end)
    if (end - start).days > 366 or start.weekday() != 0 or end.weekday() != 0:
        raise ApiError(422, "VALIDATION_ERROR", "请选择完整自然周，起止日期均为周一，最多366天")


def change_rate(current, previous) -> str | None:
    previous = Decimal(previous)
    if previous <= 0:
        return None
    return str(
        ((Decimal(current) - previous) * 100 / previous).quantize(
            Decimal(".001"), rounding=ROUND_HALF_EVEN
        )
    )


def build_snapshot(db, owner, start: date, end: date) -> dict:
    validate_range(start, end)
    total = statistics.summary(db, owner, start, end)
    trend = statistics.trends(db, owner, start, end, "week")
    device_total, device_weeks = device_summaries(db, owner, start, end)
    weeks = []
    previous = None
    for bucket in trend.buckets:
        values = bucket.model_dump(mode="json")
        values["device_metrics"] = device_weeks.get(bucket.bucket_start, finalize({}))
        values["distance_change_pct"] = (
            None if previous is None else change_rate(bucket.distance_m, previous)
        )
        weeks.append(values)
        previous = bucket.distance_m
    limited = total.activity_count < 3 or sum(b.activity_count > 0 for b in trend.buckets) < 2
    return {
        "schema_version": "running-summary-v2",
        "date_from": start.isoformat(),
        "date_to": end.isoformat(),
        "week_start": "monday",
        "date_assignment": "activity_local_date",
        "summary": total.model_dump(mode="json"),
        "device_metrics": device_total,
        "weeks": weeks,
        "average_runs_per_week": str(
            (Decimal(total.activity_count) / len(weeks)).quantize(Decimal(".001"))
        ),
        "evidence_limited": limited,
        "limitations": [
            "指标基于所导入的运动记录，未自动识别运动类型。",
            "配速仅使用距离和耗时可靠的记录；缺失耗时不按零计算。",
            "用时优先采用设备用时，否则采用轨迹经过时间。",
            "平均心率按有心率和正有效用时的记录加权估计，非逐点心率；缺失记录不参与。",
            "热量和步数仅为已知记录小计；设备热量为估计值，总步数不等于跑步步频。",
            "周汇总不能证明心率与配速的对应关系；训练条件可能不同，不能据此推断健康或能力变化。",
            *(["活动较少或覆盖周数有限，分析依据有限，不能推断长期表现。"] if limited else []),
            *(
                ["部分活动有质量警告，统计应结合原记录核对。"]
                if total.quality_warning_count
                else []
            ),
        ],
    }
