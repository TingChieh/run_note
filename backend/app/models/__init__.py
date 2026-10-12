"""Import all phase-two entities into the single shared migration metadata."""

from app.db.base import Base
from app.modules.activities.model import Activity
from app.modules.auth.model import AuthRateBucket, AuthSession
from app.modules.gpx.model import ActivityPoint, ActivitySegment, GpxImport
from app.modules.users.model import User

__all__ = [
    "Base",
    "User",
    "AuthSession",
    "AuthRateBucket",
    "Activity",
    "GpxImport",
    "ActivitySegment",
    "ActivityPoint",
]
