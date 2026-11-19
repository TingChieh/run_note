from typing import Annotated

from fastapi import APIRouter, Depends, Request

from app.api.dependencies import require_admin
from app.core.responses import ApiResponse
from app.modules.auth.router import envelope
from app.modules.version import service
from app.modules.version.schema import VersionInfo

router = APIRouter(prefix="/api/v1/admin/version", tags=["version"])
Read = Annotated[tuple, Depends(require_admin)]


@router.get("", response_model=ApiResponse[VersionInfo])
def read(request: Request, identity: Read):
    return envelope(request, service.version_info())
