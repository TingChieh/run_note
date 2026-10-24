from uuid import UUID

from app.core.errors import ApiError
from app.modules.route_groups import queries


def list_groups(db, owner: UUID, limit: int, offset: int, sort: str) -> dict:
    return {
        "items": [dict(row) for row in queries.list_rows(db, owner, limit, offset, sort)],
        "total": queries.count_groups(db, owner),
        "limit": limit,
        "offset": offset,
        "building": queries.has_unprocessed(db, owner),
    }


def group_detail(db, owner: UUID, identifier: UUID) -> dict:
    row = queries.group_row(db, owner, identifier)
    if row is None:
        raise ApiError(404, "ROUTE_NOT_FOUND", "路线不存在")
    return {**row, "runs": [dict(run) for run in queries.run_rows(db, owner, identifier)]}
