from datetime import UTC, timedelta
from zoneinfo import ZoneInfo

from pydantic import ValidationError
from sqlalchemy import delete, func, select, update

from app.core.errors import ApiError
from app.modules.ai_reports.model import AIReport
from app.modules.ai_reports.provider import PROMPT_VERSION
from app.modules.ai_reports.schema import (
    AnalysisContext,
    AnalysisText,
    ProviderResult,
    ReportList,
    ReportView,
)
from app.modules.ai_reports.snapshot import build_snapshot, default_range, validate_range
from app.modules.users.model import User


def lock_user(db, owner):
    return db.scalar(
        select(User)
        .where(User.id == owner)
        .with_for_update()
        .execution_options(populate_existing=True)
    )


def recover(db, owner, now, settings):
    db.execute(
        update(AIReport)
        .where(
            AIReport.user_id == owner,
            AIReport.status == "pending",
            AIReport.created_at <= now - timedelta(seconds=settings.ai_total_timeout_seconds + 60),
        )
        .values(status="failed", error_code="AI_TIMEOUT", finished_at=now)
    )
    # Only already-deleted content is eligible for metadata cleanup.
    db.execute(
        delete(AIReport).where(
            AIReport.user_id == owner, AIReport.deleted_at <= now - timedelta(days=30)
        )
    )


def attempts(db, owner, now):
    start = now.astimezone(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    return db.scalar(
        select(func.count())
        .select_from(AIReport)
        .where(
            AIReport.user_id == owner,
            AIReport.created_at >= start,
            AIReport.created_at < start + timedelta(days=1),
        )
    )


def view(row, version):
    return ReportView(
        id=row.id,
        date_from=row.date_from,
        date_to=row.date_to,
        status=row.status,
        stats_snapshot=row.stats_snapshot,
        analysis=AnalysisText.model_validate_json(row.report_text) if row.report_text else None,
        model=row.model,
        prompt_version=row.prompt_version,
        error_code=row.error_code,
        created_at=row.created_at,
        finished_at=row.finished_at,
        is_stale=row.source_data_version != version,
    )


def owned(db, owner, identifier):
    row = db.scalar(
        select(AIReport).where(
            AIReport.id == identifier, AIReport.user_id == owner, AIReport.deleted_at.is_(None)
        )
    )
    if row is None:
        raise ApiError(404, "RESOURCE_NOT_FOUND", "报告不存在")
    return row


def context(db, owner, now, settings, start=None, end=None):
    user = lock_user(db, owner)
    if start is None and end is None:
        start, end = default_range(now.astimezone(ZoneInfo(user.timezone)).date())
    if start is None or end is None:
        raise ApiError(422, "VALIDATION_ERROR", "请同时提供起止日期")
    recover(db, owner, now, settings)
    used = attempts(db, owner, now)
    result = AnalysisContext(
        configured=settings.ai_configured,
        model=settings.ai_model,
        daily_limit=settings.ai_daily_limit,
        attempts_today=used,
        remaining_today=max(0, settings.ai_daily_limit - used),
        date_from=start,
        date_to=end,
        stats_snapshot=build_snapshot(db, owner, start, end),
    )
    db.commit()
    return result


def listing(db, owner, now, settings, limit, offset):
    user = lock_user(db, owner)
    recover(db, owner, now, settings)
    filters = (AIReport.user_id == owner, AIReport.deleted_at.is_(None))
    total = db.scalar(select(func.count()).select_from(AIReport).where(*filters))
    rows = db.scalars(
        select(AIReport)
        .where(*filters)
        .order_by(AIReport.created_at.desc(), AIReport.id.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    result = ReportList(
        items=[view(row, user.activity_data_version) for row in rows],
        total=total,
        limit=limit,
        offset=offset,
    )
    db.commit()
    return result


def detail(db, owner, identifier, now, settings):
    user = lock_user(db, owner)
    recover(db, owner, now, settings)
    result = view(owned(db, owner, identifier), user.activity_data_version)
    db.commit()
    return result


def remove(db, owner, identifier, now, settings):
    lock_user(db, owner)
    recover(db, owner, now, settings)
    row = owned(db, owner, identifier)
    if row.status == "pending":
        raise ApiError(409, "AI_IN_PROGRESS", "生成中的报告暂不能删除")
    row.deleted_at = now
    row.report_text = None
    row.stats_snapshot = {}
    db.commit()
    return {"deleted": True}


def create(db, owner, payload, key, now, settings, provider, clock):
    validate_range(payload.date_from, payload.date_to)
    user = lock_user(db, owner)
    recover(db, owner, now, settings)
    existing = db.scalar(
        select(AIReport).where(AIReport.user_id == owner, AIReport.request_key == key)
    )
    if existing is not None:
        if (existing.date_from, existing.date_to) != (payload.date_from, payload.date_to):
            raise ApiError(409, "IDEMPOTENCY_CONFLICT", "该请求标识已用于不同日期范围")
        if existing.deleted_at:
            raise ApiError(409, "REPORT_DELETED", "该请求对应报告已删除，请创建新分析")
        if existing.status == "pending":
            raise ApiError(409, "AI_IN_PROGRESS", "分析正在生成，请读取历史记录", retry_after=2)
        result = view(existing, user.activity_data_version)
        db.commit()
        return result, 200
    if not settings.ai_configured:
        raise ApiError(503, "AI_NOT_CONFIGURED", "AI服务尚未配置，运动记录和统计仍可使用")
    if db.scalar(
        select(AIReport.id).where(AIReport.user_id == owner, AIReport.status == "pending")
    ):
        raise ApiError(409, "AI_IN_PROGRESS", "已有分析正在生成，请读取历史记录", retry_after=2)
    if attempts(db, owner, now) >= settings.ai_daily_limit:
        boundary = now.astimezone(UTC).replace(
            hour=0, minute=0, second=0, microsecond=0
        ) + timedelta(days=1)
        raise ApiError(
            429,
            "AI_QUOTA_EXCEEDED",
            "今日分析额度已用完（按UTC日期计算）",
            retry_after=int((boundary - now).total_seconds()),
        )
    snapshot = build_snapshot(db, owner, payload.date_from, payload.date_to)
    if not snapshot["summary"]["activity_count"]:
        raise ApiError(
            422, "AI_DATA_INSUFFICIENT", "该范围没有运动记录，无法分析；不会调用AI或扣减额度"
        )
    row = AIReport(
        user_id=owner,
        request_key=key,
        date_from=payload.date_from,
        date_to=payload.date_to,
        source_data_version=user.activity_data_version,
        status="pending",
        stats_snapshot=snapshot,
        model=settings.ai_model,
        prompt_version=PROMPT_VERSION,
        created_at=now,
    )
    db.add(row)
    db.flush()
    identifier = row.id
    db.commit()  # Free the connection and user lock before external work.
    failure = None
    result = None
    try:
        result = ProviderResult.model_validate(provider.generate(snapshot, settings))
    except ApiError as error:
        code = (
            error.code
            if error.code in {"AI_TIMEOUT", "AI_OUTPUT_INVALID", "AI_PROVIDER_ERROR"}
            else "AI_PROVIDER_ERROR"
        )
        failure = ApiError(
            503 if code == "AI_TIMEOUT" else 502, code, "AI分析失败，请查看历史后主动重试"
        )
    except ValidationError:
        failure = ApiError(502, "AI_OUTPUT_INVALID", "AI输出不符合要求，未展示内容")
    except Exception:
        failure = ApiError(502, "AI_PROVIDER_ERROR", "AI服务暂时不可用")
    finished = clock()
    values = {
        "finished_at": finished,
        "status": "failed" if failure else "succeeded",
        "error_code": failure.code if failure else None,
    }
    if result is not None and failure is None:
        values.update(
            report_text=result.analysis.model_dump_json(),
            input_tokens=result.input_tokens,
            output_tokens=result.output_tokens,
        )
    updated = db.scalar(
        update(AIReport)
        .where(AIReport.id == identifier, AIReport.user_id == owner, AIReport.status == "pending")
        .values(**values)
        .returning(AIReport.id)
    )
    if updated is None:
        db.rollback()
        failure = ApiError(503, "AI_TIMEOUT", "分析已超时，迟到结果未保存")
    else:
        db.commit()
    if failure:
        raise ApiError(
            failure.status_code,
            failure.code,
            failure.message,
            details=[{"report_id": str(identifier)}],
        )
    result = detail(db, owner, identifier, finished, settings)
    return result, 201
