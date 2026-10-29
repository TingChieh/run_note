"""Import all phase-two entities into the single shared migration metadata."""

from app.db.base import Base
from app.modules.activities.model import Activity
from app.modules.ai_reports.model import AIReport
from app.modules.auth.model import AuthRateBucket, AuthSession
from app.modules.footprints.model import (
    ActivityProvinceCache,
    FootprintActivityCache,
    FootprintSnapshot,
)
from app.modules.gpx.model import ActivityPoint, ActivitySegment, GpxImport
from app.modules.mifitness.model import MifitnessImport
from app.modules.place_titles.model import ActivityPlaceName, PlaceFeature
from app.modules.route_groups.model import RouteFingerprint, RouteGroup, RouteGroupMember
from app.modules.running_goals.model import RunningGoal
from app.modules.sharing.model import ActivityShareLink
from app.modules.site_settings.model import SiteImage, SiteSettings
from app.modules.tcx.model import TcxImport
from app.modules.users.model import User, UserAvatar
from app.modules.wellbeing.model import (
    DailyEntry,
    DoseEvent,
    Medication,
    StockMovement,
    SymptomEvent,
    SymptomName,
)

__all__ = [
    "Base",
    "RunningGoal",
    "AIReport",
    "ActivityShareLink",
    "User",
    "UserAvatar",
    "SiteSettings",
    "SiteImage",
    "AuthSession",
    "AuthRateBucket",
    "Activity",
    "GpxImport",
    "TcxImport",
    "MifitnessImport",
    "ActivitySegment",
    "ActivityPoint",
    "ActivityProvinceCache",
    "FootprintActivityCache",
    "FootprintSnapshot",
    "RouteFingerprint",
    "RouteGroup",
    "RouteGroupMember",
    "ActivityPlaceName",
    "PlaceFeature",
    "DailyEntry",
    "DoseEvent",
    "SymptomEvent",
    "Medication",
    "SymptomName",
    "StockMovement",
]
