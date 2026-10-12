import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

from app.core.responses import ApiResponse, ErrorInfo, ResponseMeta

logger = logging.getLogger(__name__)


class ApiError(Exception):
    def __init__(self, status_code: int, code: str, message: str):
        self.status_code = status_code
        self.code = code
        self.message = message
        super().__init__(message)


def error_response(
    request: Request,
    status: int,
    code: str,
    message: str,
    details: list[dict[str, str]] | None = None,
) -> JSONResponse:
    body = ApiResponse[None](
        error=ErrorInfo(code=code, message=message, details=details or []),
        meta=ResponseMeta(request_id=request.state.request_id),
    )
    return JSONResponse(
        body.model_dump(),
        status_code=status,
        headers={"X-Request-ID": request.state.request_id, "Cache-Control": "no-store"},
    )


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def api_error(request: Request, exc: ApiError):
        return error_response(request, exc.status_code, exc.code, exc.message)

    @app.exception_handler(HTTPException)
    async def http_error(request: Request, exc: HTTPException):
        code = "RESOURCE_NOT_FOUND" if exc.status_code == 404 else "HTTP_ERROR"
        message = "资源不存在" if exc.status_code == 404 else "请求无法处理"
        return error_response(request, exc.status_code, code, message)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError):
        details = [
            {"field": ".".join(map(str, item["loc"])), "reason": item["type"]}
            for item in exc.errors()
        ]
        return error_response(request, 422, "VALIDATION_ERROR", "请求参数不合法", details)

    @app.exception_handler(Exception)
    async def unexpected_error(request: Request, exc: Exception):
        logger.error(
            "Unhandled request error: %s request_id=%s",
            type(exc).__name__,
            request.state.request_id,
        )
        return error_response(request, 500, "INTERNAL_ERROR", "服务暂时无法处理请求")
