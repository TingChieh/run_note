"""Import all phase-two entities into the single shared migration metadata."""

from app.db.base import Base
from app.modules.activities.model import Activity
from app.modules.ai_reports.model import AIReport
from app.modules.auth.model import AuthRateBucket, AuthSession
from app.modules.gpx.model import ActivityPoint, ActivitySegment, GpxImport
from app.modules.running_goals.model import RunningGoal
from app.modules.sharing.model import ActivityShareLink
from app.modules.tcx.model import TcxImport
from app.modules.users.model import User

__all__ = [
    "Base",
    "RunningGoal",
    "AIReport",
    "ActivityShareLink",
    "User",
    "AuthSession",
    "AuthRateBucket",
    "Activity",
    "GpxImport",
    "TcxImport",
    "ActivitySegment",
    "ActivityPoint",
]
