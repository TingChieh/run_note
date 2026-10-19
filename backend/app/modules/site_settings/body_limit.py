"""Reject oversized image upload bodies before multipart parsing allocates them."""

from uuid import uuid4

from starlette.requests import Request

from app.core.errors import ApiError, error_response

MAX_IMAGE_BODY = 6 * 1024 * 1024
PATHS = {"/api/v1/site/images/favicon", "/api/v1/site/images/logo", "/api/v1/me/avatar"}


class ImageBodyLimit:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if (
            scope["type"] != "http"
            or scope.get("method") != "PUT"
            or scope.get("path") not in PATHS
        ):
            return await self.app(scope, receive, send)
        scope.setdefault("state", {}).setdefault("request_id", uuid4().hex)
        length = dict(scope.get("headers", [])).get(b"content-length")
        try:
            excessive = length is not None and int(length) > MAX_IMAGE_BODY
        except ValueError:
            excessive = True
        if excessive:
            response = error_response(Request(scope), 413, "IMAGE_TOO_LARGE", "图片上传请求过大")
            return await response(scope, receive, send)
        consumed = 0

        async def limited_receive():
            nonlocal consumed
            message = await receive()
            if message["type"] == "http.request":
                consumed += len(message.get("body", b""))
                if consumed > MAX_IMAGE_BODY:
                    raise ApiError(413, "IMAGE_TOO_LARGE", "图片上传请求过大")
            return message

        await self.app(scope, limited_receive, send)
