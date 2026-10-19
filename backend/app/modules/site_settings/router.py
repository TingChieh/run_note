from typing import Annotated

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile
from starlette.exceptions import HTTPException

from app.api.dependencies import get_session, require_admin_write
from app.core.errors import ApiError
from app.core.responses import ApiResponse
from app.modules.auth.router import envelope
from app.modules.site_settings import service
from app.modules.site_settings.images import MAX_IMAGE_BYTES
from app.modules.site_settings.schema import SitePatch, SiteView

router = APIRouter(prefix="/api/v1/site", tags=["site"])
DB = Annotated[Session, Depends(get_session)]
Write = Annotated[tuple, Depends(require_admin_write)]


def png_response(data: bytes) -> Response:
    return Response(
        content=data,
        media_type="image/png",
        headers={
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'",
        },
    )


async def read_upload(request: Request) -> bytes:
    try:
        async with request.form(max_files=1, max_fields=0, max_part_size=4096) as form:
            values = form.multi_items()
            file = form.get("file")
            if len(values) != 1 or not isinstance(file, UploadFile):
                raise ApiError(422, "VALIDATION_ERROR", "请选择单个图片文件")
            raw = bytearray()
            while chunk := await file.read(1024 * 1024):
                raw.extend(chunk)
                if len(raw) > MAX_IMAGE_BYTES:
                    raise ApiError(413, "IMAGE_TOO_LARGE", "图片不能超过 5 MiB")
            return bytes(raw)
    except HTTPException:
        raise ApiError(422, "VALIDATION_ERROR", "表单超出限制，请只上传一个图片文件") from None


@router.get("", response_model=ApiResponse[SiteView])
def read(request: Request, db: DB):
    return envelope(request, service.read_site(db))


@router.patch("", response_model=ApiResponse[SiteView])
def update(payload: SitePatch, request: Request, db: DB, identity: Write):
    data = service.update_site(db, payload)
    db.commit()
    return envelope(request, data)


@router.put("/images/{kind}", response_model=ApiResponse[SiteView])
async def upload(kind: str, request: Request, db: DB, identity: Write):
    service.checked_kind(kind)  # Reject unknown kinds before buffering the body.
    db.commit()  # Release the identity lock before reading and decoding the upload.
    raw = await read_upload(request)
    data = await run_in_threadpool(service.put_image, db, kind, raw)
    await run_in_threadpool(db.commit)
    return envelope(request, data)


@router.delete("/images/{kind}", response_model=ApiResponse[SiteView])
def remove(kind: str, request: Request, db: DB, identity: Write):
    data = service.remove_image(db, kind)
    db.commit()
    return envelope(request, data)


@router.get("/images/{kind}")
def image(kind: str, db: DB):
    return png_response(service.image_bytes(db, kind))
