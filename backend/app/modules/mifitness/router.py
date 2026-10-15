from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Request, Response
from pydantic import ValidationError
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile
from starlette.exceptions import HTTPException

from app.api.dependencies import get_session, require_write
from app.core.errors import ApiError
from app.core.responses import ApiResponse
from app.modules.activities.router import envelope
from app.modules.activities.schema import ImportView
from app.modules.mifitness import service
from app.modules.mifitness.schema import MifitnessPreview, MifitnessRecord
from app.modules.users.schema import valid_timezone

router = APIRouter(prefix="/api/v1/mifitness-imports", tags=["mifitness"])


def save(request, db, owner, record, raw, timezone, **options):
    with service.import_record(request, db, owner, record, raw, timezone, **options) as data:
        if not options.get("preview"):
            db.commit()
        return data


@router.post("", status_code=201, response_model=ApiResponse[ImportView | MifitnessPreview])
async def import_mifitness(
    request: Request,
    response: Response,
    identity: Annotated[tuple, Depends(require_write)],
    db: Annotated[Session, Depends(get_session)],
    preview: bool = False,
):
    owner, default_timezone = identity[1].id, identity[1].timezone
    await run_in_threadpool(db.commit)
    allowed = {"record", "file", "timezone", "confirm_similar", "enrich_activity_id"}
    try:
        async with request.form(max_files=1, max_fields=4, max_part_size=4096) as form:
            values = form.multi_items()
            if len(values) != len({key for key, _ in values}) or any(
                key not in allowed for key, _ in values
            ):
                raise ValueError
            fields = {key: value for key, value in values if key != "file"}
            if any(not isinstance(value, str) for value in fields.values()):
                raise ValueError
            encoded = fields.get("record", "").encode("utf-8")
            if len(encoded) > 4096:
                raise ValueError
            record = MifitnessRecord.model_validate_json(encoded)
            timezone = fields.get("timezone") or default_timezone
            if len(timezone) > 64:
                raise ValueError
            valid_timezone(timezone)
            confirm = fields.get("confirm_similar", "false")
            if confirm not in {"true", "false"}:
                raise ValueError
            enrich = (
                UUID(fields["enrich_activity_id"]) if fields.get("enrich_activity_id") else None
            )
            file = form.get("file")
            raw = None
            if "file" in form:
                if not isinstance(file, UploadFile):
                    raise ValueError
                buffer = bytearray()
                while chunk := await file.read(1024 * 1024):
                    buffer.extend(chunk)
                    if len(buffer) > 10485760:
                        raise ApiError(413, "MIFITNESS_TOO_LARGE", "轨迹文件不能超过 10 MiB")
                raw = bytes(buffer)
            data = await run_in_threadpool(
                save,
                request,
                db,
                owner,
                record,
                raw,
                timezone,
                preview=preview,
                confirm_similar=confirm == "true",
                enrich_activity_id=enrich,
            )
    except (HTTPException, ValidationError, ValueError):
        raise ApiError(422, "VALIDATION_ERROR", "请检查设备汇总、时区及单个轨迹文件") from None
    if preview:
        response.status_code = 200
    return envelope(request, data)
