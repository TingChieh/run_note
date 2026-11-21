from datetime import date
from typing import Annotated, Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Path, Query, Request, Response
from sqlalchemy.orm import Session

from app.api.dependencies import get_read_identity, get_session
from app.core.errors import ApiError
from app.core.responses import ApiResponse
from app.modules.activities.router import envelope
from app.modules.footprints.cache import all_footprints_response
from app.modules.footprints.exploration import catalog, cells, detail, parse_viewport
from app.modules.footprints.exploration_schema import (
    ExplorationCatalog,
    ExplorationCells,
    ExplorationDetail,
    Layer,
    Scope,
)
from app.modules.footprints.global_atlas import global_summary
from app.modules.footprints.provinces import province_summary
from app.modules.footprints.schema import (
    AllFootprintView,
    FootprintCollection,
    GlobalFootprintSummary,
    ProvinceSummary,
)
from app.modules.footprints.service import footprints

router = APIRouter(prefix="/api/v1/footprints", tags=["footprints"])
exploration_router = APIRouter(prefix="/api/v1/me/footprints/exploration", tags=["footprints"])
ScopeCode = Annotated[str, Path(min_length=1, max_length=32, pattern=r"^[A-Za-z0-9_-]+$")]
Year = Annotated[int, Query(ge=1900, le=2100)]


def _exploration_response(request, response, db, data, allowed):
    if request.query_params.keys() - allowed or any(
        len(request.query_params.getlist(key)) > 1 for key in request.query_params
    ):
        raise ApiError(422, "VALIDATION_ERROR", "城市探索查询包含不支持的参数")
    response.headers["Cache-Control"] = "private, no-store"
    db.commit()
    return envelope(request, data)


@exploration_router.get("/cities", response_model=ApiResponse[ExplorationCatalog])
def exploration_cities(
    request: Request,
    response: Response,
    identity: Annotated[tuple, Depends(get_read_identity)],
    db: Annotated[Session, Depends(get_session)],
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0, le=1000000)] = 0,
):
    user = identity[1]
    data = catalog(
        request.app.state.exploration_reads, user.id, user.activity_data_version, limit, offset
    )
    return _exploration_response(request, response, db, data, {"limit", "offset"})


@exploration_router.get("/{scope}/{code}", response_model=ApiResponse[ExplorationDetail])
def exploration_detail(
    request: Request,
    response: Response,
    identity: Annotated[tuple, Depends(get_read_identity)],
    db: Annotated[Session, Depends(get_session)],
    scope: Scope,
    code: ScopeCode,
    year: Year,
):
    user = identity[1]
    today = request.app.state.clock().astimezone(ZoneInfo(user.timezone)).date()
    data = detail(
        request.app.state.exploration_reads,
        user.id,
        user.activity_data_version,
        scope,
        code,
        year,
        today,
    )
    return _exploration_response(request, response, db, data, {"year"})


@exploration_router.get("/{scope}/{code}/cells", response_model=ApiResponse[ExplorationCells])
def exploration_cells(
    request: Request,
    response: Response,
    identity: Annotated[tuple, Depends(get_read_identity)],
    db: Annotated[Session, Depends(get_session)],
    scope: Scope,
    code: ScopeCode,
    year: Year,
    zoom: Annotated[float, Query(ge=0, le=22)],
    layer: Layer = "heatmap",
    bbox: Annotated[str | None, Query(max_length=100)] = None,
):
    user = identity[1]
    data = cells(
        request.app.state.exploration_reads,
        user.id,
        user.activity_data_version,
        scope,
        code,
        year,
        parse_viewport(bbox),
        zoom,
        layer,
    )
    return _exploration_response(request, response, db, data, {"year", "zoom", "layer", "bbox"})


@router.get("/all", response_model=ApiResponse[AllFootprintView])
def read_all(
    request: Request,
    identity: Annotated[tuple, Depends(get_read_identity)],
    db: Annotated[Session, Depends(get_session)],
    mode: Literal["tracks", "heatmap"] = "tracks",
    encoding: Literal["delta"] | None = None,
):
    if set(request.query_params) - {"mode", "encoding"}:
        raise ApiError(422, "VALIDATION_ERROR", "足迹查询包含不支持的参数")
    response = all_footprints_response(request, db, identity[1].id, mode, encoding)
    db.commit()
    return response


@router.get("/provinces", response_model=ApiResponse[ProvinceSummary])
def provinces(
    request: Request,
    identity: Annotated[tuple, Depends(get_read_identity)],
    db: Annotated[Session, Depends(get_session)],
    year: Annotated[int | None, Query(ge=1900, le=2100)] = None,
):
    data = province_summary(db, identity[1].id, year)
    db.commit()
    return envelope(request, data)


@router.get("/global", response_model=ApiResponse[GlobalFootprintSummary])
def global_footprints(
    request: Request,
    identity: Annotated[tuple, Depends(get_read_identity)],
    db: Annotated[Session, Depends(get_session)],
    year: Annotated[int | None, Query(ge=1900, le=2100)] = None,
):
    data = global_summary(db, identity[1].id, year)
    db.commit()
    return envelope(request, data)


@router.get("", response_model=ApiResponse[FootprintCollection])
def read_footprints(
    request: Request,
    identity: Annotated[tuple, Depends(get_read_identity)],
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
