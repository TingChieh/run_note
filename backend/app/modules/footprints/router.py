from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from app.api.dependencies import get_identity, get_session
from app.core.errors import ApiError
from app.core.responses import ApiResponse
from app.modules.activities.router import envelope
from app.modules.footprints.provinces import province_summary
from app.modules.footprints.schema import AllFootprintView
from app.modules.footprints.service import footprints
from app.modules.footprints.snapshot import read_all_footprints

router = APIRouter(prefix="/api/v1/footprints", tags=["footprints"])


@router.get("/all", response_model=ApiResponse[AllFootprintView])
def read_all(
    request: Request,
    identity: Annotated[tuple, Depends(get_identity)],
    db: Annotated[Session, Depends(get_session)],
    mode: Literal["tracks", "heatmap"] = "tracks",
):
    if set(request.query_params) - {"mode"}:
        raise ApiError(422, "VALIDATION_ERROR", "足迹查询包含不支持的参数")
    data = read_all_footprints(db, identity[1].id, mode)
    db.commit()
    return envelope(request, data)


@router.get("/provinces")
def provinces(
    request: Request,
    identity: Annotated[tuple, Depends(get_identity)],
    db: Annotated[Session, Depends(get_session)],
    year: Annotated[int | None, Query(ge=1900, le=2100)] = None,
):
    data = province_summary(db, identity[1].id, year)
    db.commit()
    return envelope(request, data)


@router.get("")
def read_footprints(
    request: Request,
    identity: Annotated[tuple, Depends(get_identity)],
    db: Annotated[Session, Depends(get_session)],
    date_from: date,
    date_to: date,
    mode: Literal["tracks", "heatmap"] = "tracks",
):
    if set(request.query_params) - {"date_from", "date_to", "mode"}:
        raise ApiError(422, "VALIDATION_ERROR", "足迹查询包含不支持的参数")
    data = footprints(db, identity[1].id, date_from, date_to, mode)
    db.commit()
    return envelope(request, data)
