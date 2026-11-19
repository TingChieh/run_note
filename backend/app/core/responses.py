from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field


class ResponseMeta(BaseModel):
    request_id: str


class ErrorInfo(BaseModel):
    code: str
    message: str
    details: list[dict[str, str]] = Field(default_factory=list)


class ExactView(BaseModel):
    """A response model for a payload a service builds as a dict.

    Undeclared keys and mismatched types raise instead of being dropped or coerced, so adding a
    response_model cannot silently change what a route sends. (A whole number in a float field is
    written as 1.0 instead of 1; the value is unchanged.)
    """

    model_config = ConfigDict(extra="forbid", strict=True)


# Fixed-length coordinate arrays. Lax so the lists parsed from GeoJSON validate as tuples.
LonLat = Annotated[tuple[float, float], Field(strict=False)]
Bounds = Annotated[tuple[float, float, float, float], Field(strict=False)]


class ApiResponse[T](BaseModel):
    data: T | None = None
    error: ErrorInfo | None = None
    meta: ResponseMeta
