from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.modules.health.schema import ReadyStatus


def check_readiness(session: Session, expected_revision: str) -> ReadyStatus:
    try:
        session.execute(text("SELECT 1"))
        postgis = session.scalar(text("SELECT PostGIS_Version()"))
        revisions = session.scalars(text("SELECT version_num FROM alembic_version")).all()
    except SQLAlchemyError:
        raise ApiError(503, "DEPENDENCY_UNAVAILABLE", "数据库或迁移尚未就绪") from None
    if not postgis or revisions != [expected_revision]:
        raise ApiError(503, "DEPENDENCY_UNAVAILABLE", "数据库或迁移尚未就绪")
    return ReadyStatus()
