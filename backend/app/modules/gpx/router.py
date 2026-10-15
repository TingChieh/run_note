from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile
from starlette.exceptions import HTTPException

from app.api.dependencies import get_session, require_write
from app.core.errors import ApiError
from app.core.responses import ApiResponse, ResponseMeta
from app.modules.activities.schema import ImportView
from app.modules.gpx import service
from app.modules.users.schema import valid_timezone

router = APIRouter(prefix="/api/v1/gpx-imports", tags=["gpx"])


@router.post("", status_code=201, response_model=ApiResponse[ImportView])
async def import_gpx(
    request: Request,
    identity: Annotated[tuple, Depends(require_write)],
    db: Annotated[Session, Depends(get_session)],
):
    return await import_file(request, identity, db, "gpx")


async def import_file(request, identity, db, format):
    label = format.upper()
    allowed = {"file", "title", "timezone", "activity_date"}
    if format == "tcx":
        allowed.add("time_mode")
    owner, default_timezone = identity[1].id, identity[1].timezone
    db.commit()  # Authentication's user lock must not cover reading/parsing a file.
    try:
        async with request.form(
            max_files=1, max_fields=len(allowed) - 1, max_part_size=4096
        ) as form:
            values = form.multi_items()
            if len(values) != len({key for key, _ in values}) or any(
                key not in allowed for key, _ in values
            ):
                raise ApiError(422, "VALIDATION_ERROR", "只允许单个轨迹文件和受支持的导入选项")
            file = form.get("file")
            if not isinstance(file, UploadFile):
                raise ApiError(422, "VALIDATION_ERROR", "请选择单个轨迹文件")
            fields = {key: value for key, value in values if key != "file"}
            if any(not isinstance(v, str) for v in fields.values()):
                raise ApiError(422, "VALIDATION_ERROR", "表单字段不合法")
            time_mode = fields.get("time_mode") or "absolute"
            if time_mode not in {"absolute", "local"}:
                raise ApiError(422, "VALIDATION_ERROR", "时间解释方式不合法")
            title = fields.get("title") or None
            timezone = fields.get("timezone") or default_timezone
            if title and (len(title) > 120 or not title.strip()):
                raise ApiError(422, "VALIDATION_ERROR", "标题需为1–120个字符")
            if len(timezone) > 64:
                raise ApiError(422, "VALIDATION_ERROR", "时区不合法")
            try:
                valid_timezone(timezone)
                activity_date = (
                    date.fromisoformat(fields["activity_date"])
                    if fields.get("activity_date")
                    else None
                )
            except ValueError:
                raise ApiError(422, "VALIDATION_ERROR", "日期或时区不合法") from None
            raw = bytearray()
            while chunk := await file.read(1024 * 1024):
                raw.extend(chunk)
                if len(raw) > 10485760:
                    raise ApiError(413, f"{label}_TOO_LARGE", "轨迹文件不能超过 10 MiB")
            importer = service.import_gpx if format == "gpx" else service.import_track
            options = {"format": "tcx", "time_mode": time_mode} if format == "tcx" else {}
            data = await run_in_threadpool(
                importer,
                request,
                db,
                owner,
                bytes(raw),
                file.filename,
                title,
                timezone,
                activity_date,
                **options,
            )
    except HTTPException:
        raise ApiError(
            422, "VALIDATION_ERROR", "表单超出限制，请只上传一个文件并检查字段长度"
        ) from None
    return ApiResponse(data=data, meta=ResponseMeta(request_id=request.state.request_id))
