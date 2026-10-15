from contextlib import asynccontextmanager

from fastapi import FastAPI

import app.models  # noqa: F401 -- register the complete shared ORM metadata at startup
from app.core.config import Settings
from app.core.errors import register_error_handlers
from app.core.logging import configure_logging, register_request_metadata
from app.core.security import utc_now
from app.db.schema import get_expected_revision
from app.db.session import create_session_factory
from app.modules.activities.router import router as activities_router
from app.modules.ai_reports.provider import OpenAIProvider
from app.modules.ai_reports.router import router as ai_router
from app.modules.auth.router import router as auth_router
from app.modules.footprints.router import router as footprints_router
from app.modules.gpx.body_limit import GpxBodyLimit
from app.modules.gpx.router import router as gpx_router
from app.modules.health.router import router
from app.modules.running_goals.router import router as running_goals_router
from app.modules.sharing.router import router as sharing_router
from app.modules.statistics.router import router as statistics_router
from app.modules.tcx.router import router as tcx_router
from app.modules.users.router import router as users_router


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    expected_revision = get_expected_revision()
    configure_logging()
    engine, session_factory = create_session_factory(settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        try:
            yield
        finally:
            engine.dispose()

    app = FastAPI(title="Run Note API", version="0.1.0", lifespan=lifespan)
    app.state.settings = settings
    app.state.ai_provider = OpenAIProvider()
    app.state.clock = utc_now
    app.state.session_factory = session_factory
    app.state.expected_revision = expected_revision
    app.add_middleware(GpxBodyLimit)
    register_request_metadata(app)
    register_error_handlers(app)
    app.include_router(router)
    app.include_router(gpx_router)
    app.include_router(tcx_router)
    app.include_router(activities_router)
    app.include_router(statistics_router)
    app.include_router(footprints_router)
    app.include_router(auth_router)
    app.include_router(users_router)
    app.include_router(running_goals_router)
    app.include_router(sharing_router)
    app.include_router(ai_router)
    return app
