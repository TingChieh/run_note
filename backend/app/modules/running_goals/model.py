from decimal import Decimal
from uuid import UUID

from sqlalchemy import CheckConstraint, ForeignKey, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class RunningGoal(Base):
    __tablename__ = "running_goals"
    __table_args__ = (
        CheckConstraint("period IN ('week','month','year')", name="period"),
        CheckConstraint("target_km > 0 AND target_km <= 100000", name="target_range"),
    )

    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    period: Mapped[str] = mapped_column(String(5), primary_key=True)
    target_km: Mapped[Decimal] = mapped_column(Numeric(7, 1))
