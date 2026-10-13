import logging
import re
from uuid import uuid4

from fastapi import FastAPI, Request


class ShareTokenFilter(logging.Filter):
    def filter(self, record):
        def redact(value):
            return re.sub(r"(/shared/)[^\s/?\"']+", r"\1[redacted]", value)

        if (
            record.name == "uvicorn.access"
            and isinstance(record.args, tuple)
            and len(record.args) == 5
        ):
            # Uvicorn AccessFormatter unpacks this tuple; preserve its structure.
            record.args = (*record.args[:2], redact(str(record.args[2])), *record.args[3:])
        else:
            record.msg = redact(record.getMessage())
            record.args = ()
        return True


def configure_logging() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)
    for name in ("uvicorn.access", "httpx", "httpx2"):
        logger = logging.getLogger(name)
        if not any(isinstance(f, ShareTokenFilter) for f in logger.filters):
            logger.addFilter(ShareTokenFilter())


def register_request_metadata(app: FastAPI) -> None:
    @app.middleware("http")
    async def request_metadata(request: Request, call_next):
        request.state.request_id = uuid4().hex
        response = await call_next(request)
        response.headers["X-Request-ID"] = request.state.request_id
        response.headers["Cache-Control"] = "no-store"
        if request.url.path.startswith(("/api/v1/shared/", "/api/v1/public/")):
            response.headers["Referrer-Policy"] = "no-referrer"
            response.headers["X-Robots-Tag"] = "noindex, nofollow"
        return response
