from typing import Annotated

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.api.dependencies import get_session
from app.core.responses import ApiResponse
from app.modules.auth.router import envelope
from app.modules.together.schema import TogetherView
from app.modules.together.service import overview

router = APIRouter(prefix="/api/v1/together", tags=["together"])


@router.get("", response_model=ApiResponse[TogetherView])
def together(request: Request, db: Annotated[Session, Depends(get_session)]):
    data = overview(db, request.app.state.settings, request.app.state.clock())
    db.commit()
    return envelope(request, data)
