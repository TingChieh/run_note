from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.core.config import Settings
from app.core.errors import register_error_handlers
from app.core.logging import configure_logging, register_request_metadata
from app.db.session import create_session_factory
from app.modules.health.router import router


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    configure_logging()
    engine, session_factory = create_session_factory(settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        try:
            yield
        finally:
            engine.dispose()

    app = FastAPI(title="Run Note API", version="0.1.0", lifespan=lifespan)
    app.state.session_factory = session_factory
    register_request_metadata(app)
    register_error_handlers(app)
    app.include_router(router)
    return app
