from pydantic import BaseModel, Field


class ResponseMeta(BaseModel):
    request_id: str


class ErrorInfo(BaseModel):
    code: str
    message: str
    details: list[dict[str, str]] = Field(default_factory=list)


class ApiResponse[T](BaseModel):
    data: T | None = None
    error: ErrorInfo | None = None
    meta: ResponseMeta
