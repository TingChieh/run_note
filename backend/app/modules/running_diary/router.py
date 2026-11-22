from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.api.dependencies import get_identity, get_read_identity, get_session, require_write
from app.core.responses import ApiResponse
from app.modules.auth.router import envelope
from app.modules.running_diary import service
from app.modules.running_diary.schema import DiaryDeleted, DiaryDetail, DiaryInput, DiaryPhotoView
from app.modules.site_settings.images import normalize_image
from app.modules.site_settings.router import read_upload

router = APIRouter(prefix="/api/v1/me/activities", tags=["running_diary"])
Read = Annotated[tuple, Depends(get_read_identity)]
Write = Annotated[tuple, Depends(require_write)]
DB = Annotated[Session, Depends(get_session)]


@router.get("/{identifier}/diary", response_model=ApiResponse[DiaryDetail])
def detail(identifier: UUID, request: Request, identity: Read, db: DB):
    return envelope(request, service.detail(db, identity[1].id, identifier))


@router.put("/{identifier}/diary", response_model=ApiResponse[DiaryDetail])
def save(identifier: UUID, payload: DiaryInput, request: Request, identity: Write, db: DB):
    data = service.save(db, identity[1].id, identifier, payload, request.app.state.clock())
    db.commit()
    return envelope(request, data)


@router.delete("/{identifier}/diary", response_model=ApiResponse[DiaryDeleted])
def delete(identifier: UUID, request: Request, identity: Write, db: DB):
    service.delete(db, identity[1].id, identifier)
    db.commit()
    return envelope(request, DiaryDeleted())


@router.post(
    "/{identifier}/diary/photos", status_code=201, response_model=ApiResponse[DiaryPhotoView]
)
async def upload_photo(identifier: UUID, request: Request, identity: Write, db: DB):
    # Decode without keeping the identity transaction open. Recheck it before writing.
    await run_in_threadpool(db.commit)
    raw = await read_upload(request)

    def store_photo():
        image = normalize_image(raw, "diary")
        current_identity = require_write(request, get_identity(request, db))
        data = service.add_photo(db, current_identity[1].id, identifier, image)
        db.commit()
        return data

    return envelope(request, await run_in_threadpool(store_photo))


@router.get("/{identifier}/diary/photos/{photo_id}", response_class=Response)
def read_photo(identifier: UUID, photo_id: UUID, identity: Read, db: DB):
    return Response(
        service.read_photo(db, identity[1].id, identifier, photo_id),
        media_type="image/png",
        headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"},
    )


@router.delete("/{identifier}/diary/photos/{photo_id}", response_model=ApiResponse[DiaryDeleted])
def delete_photo(identifier: UUID, photo_id: UUID, request: Request, identity: Write, db: DB):
    service.delete_photo(db, identity[1].id, identifier, photo_id)
    db.commit()
    return envelope(request, DiaryDeleted())
