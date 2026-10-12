from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.modules.health.schema import ReadyStatus

INITIAL_REVISION = "0001_postgis"


def check_readiness(session: Session) -> ReadyStatus:
    try:
        session.execute(text("SELECT 1"))
        postgis = session.scalar(text("SELECT PostGIS_Version()"))
        revision = session.scalar(text("SELECT version_num FROM alembic_version"))
    except SQLAlchemyError:
        raise ApiError(503, "DEPENDENCY_UNAVAILABLE", "数据库或迁移尚未就绪") from None
    if not postgis or revision != INITIAL_REVISION:
        raise ApiError(503, "DEPENDENCY_UNAVAILABLE", "数据库或迁移尚未就绪")
    return ReadyStatus()
