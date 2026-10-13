from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ActivityShareLink(Base):
    __tablename__ = "activity_share_links"
    __table_args__ = (
        CheckConstraint("expires_at IS NULL OR expires_at > created_at", name="expiry_order"),
        Index("ix_activity_share_links_activity", "activity_id"),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    activity_id: Mapped[UUID] = mapped_column(ForeignKey("activities.id", ondelete="CASCADE"))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
