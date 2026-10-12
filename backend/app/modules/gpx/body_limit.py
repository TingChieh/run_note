"""ASGI receive guard, including chunked bodies, before multipart allocation."""

from uuid import uuid4

from starlette.requests import Request

from app.core.errors import ApiError, error_response

MAX_BODY = 11 * 1024 * 1024


class GpxBodyLimit:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if (
            scope["type"] != "http"
            or scope.get("path") != "/api/v1/gpx-imports"
            or scope.get("method") != "POST"
        ):
            return await self.app(scope, receive, send)
        scope.setdefault("state", {}).setdefault("request_id", uuid4().hex)
        headers = dict(scope.get("headers", []))
        length = headers.get(b"content-length")
        try:
            excessive = length is not None and int(length) > MAX_BODY
        except ValueError:
            excessive = True
        if excessive:
            response = error_response(
                Request(scope), 413, "GPX_TOO_LARGE", "上传请求不能超过 11 MiB"
            )
            return await response(scope, receive, send)
        consumed = 0

        async def limited_receive():
            nonlocal consumed
            message = await receive()
            if message["type"] == "http.request":
                consumed += len(message.get("body", b""))
                if consumed > MAX_BODY:
                    raise ApiError(413, "GPX_TOO_LARGE", "上传请求不能超过 11 MiB")
            return message

        await self.app(scope, limited_receive, send)
