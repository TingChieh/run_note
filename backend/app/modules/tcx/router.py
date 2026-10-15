from typing import Annotated

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.api.dependencies import get_session, require_write
from app.core.responses import ApiResponse
from app.modules.activities.schema import ImportView
from app.modules.gpx.router import import_file

router = APIRouter(prefix="/api/v1/tcx-imports", tags=["tcx"])


@router.post("", status_code=201, response_model=ApiResponse[ImportView])
async def import_tcx(
    request: Request,
    identity: Annotated[tuple, Depends(require_write)],
    db: Annotated[Session, Depends(get_session)],
):
    return await import_file(request, identity, db, "tcx")
