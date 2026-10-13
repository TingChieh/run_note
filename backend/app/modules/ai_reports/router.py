from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Request, Response
from sqlalchemy.orm import Session

from app.api.dependencies import get_identity, get_session, require_write
from app.core.responses import ApiResponse
from app.modules.activities.router import envelope
from app.modules.ai_reports import service
from app.modules.ai_reports.schema import AnalysisContext, ReportCreate, ReportList, ReportView

router = APIRouter(prefix="/api/v1/ai-reports", tags=["AI reports"])
DB = Annotated[Session, Depends(get_session)]
Read = Annotated[tuple, Depends(get_identity)]
Write = Annotated[tuple, Depends(require_write)]


@router.get("/context", response_model=ApiResponse[AnalysisContext])
def context(
    request: Request,
    identity: Read,
    db: DB,
    date_from: date | None = None,
    date_to: date | None = None,
):
    return envelope(
        request,
        service.context(
            db,
            identity[1].id,
            request.app.state.clock(),
            request.app.state.settings,
            date_from,
            date_to,
        ),
    )


@router.get("", response_model=ApiResponse[ReportList])
def listing(
    request: Request,
    identity: Read,
    db: DB,
    limit: Annotated[int, Query(ge=1, le=50)] = 10,
    offset: Annotated[int, Query(ge=0, le=1000000)] = 0,
):
    return envelope(
        request,
        service.listing(
            db, identity[1].id, request.app.state.clock(), request.app.state.settings, limit, offset
        ),
    )


@router.post("", response_model=ApiResponse[ReportView], status_code=201)
def create(
    payload: ReportCreate,
    request: Request,
    response: Response,
    identity: Write,
    db: DB,
    idempotency_key: Annotated[UUID, Header()],
):
    result, status = service.create(
        db,
        identity[1].id,
        payload,
        idempotency_key,
        request.app.state.clock(),
        request.app.state.settings,
        request.app.state.ai_provider,
        request.app.state.clock,
    )
    response.status_code = status
    return envelope(request, result)


@router.get("/{identifier}", response_model=ApiResponse[ReportView])
def detail(identifier: UUID, request: Request, identity: Read, db: DB):
    return envelope(
        request,
        service.detail(
            db, identity[1].id, identifier, request.app.state.clock(), request.app.state.settings
        ),
    )


@router.delete("/{identifier}")
def remove(identifier: UUID, request: Request, identity: Write, db: DB):
    return envelope(
        request,
        service.remove(
            db, identity[1].id, identifier, request.app.state.clock(), request.app.state.settings
        ),
    )
