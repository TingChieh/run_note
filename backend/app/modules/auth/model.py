from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import CHAR, CheckConstraint, DateTime, ForeignKey, Index, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class AuthSession(Base):
    __tablename__ = "auth_sessions"
    __table_args__ = (
        Index("ix_auth_sessions_user_id", "user_id"),
        Index("ix_auth_sessions_expires_at", "expires_at"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    user_id: Mapped[UUID | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    token_hash: Mapped[str] = mapped_column(CHAR(64), unique=True)
    csrf_token: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class MobileSession(Base):
    __tablename__ = "mobile_sessions"
    __table_args__ = (
        Index("ix_mobile_sessions_user_id", "user_id"),
        Index("ix_mobile_sessions_token_family_id", "token_family_id"),
        Index("ix_mobile_sessions_refresh_expires_at", "refresh_expires_at"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    token_family_id: Mapped[UUID] = mapped_column(default=uuid4)
    access_token_hash: Mapped[str] = mapped_column(CHAR(64), unique=True)
    refresh_token_hash: Mapped[str] = mapped_column(CHAR(64), unique=True)
    device_label: Mapped[str] = mapped_column(String(80), server_default="")
    client_version: Mapped[str] = mapped_column(String(32), server_default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_used_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    access_expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    refresh_expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    rotated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AuthRateBucket(Base):
    __tablename__ = "auth_rate_buckets"
    __table_args__ = (
        CheckConstraint("attempts >= 0", name="attempts_nonnegative"),
        CheckConstraint(
            "scope IN ('login-account','login-ip','register-ip','csrf-ip','mobile-refresh-ip')",
            name="scope",
        ),
    )

    scope: Mapped[str] = mapped_column(String(32), primary_key=True)
    subject_hash: Mapped[str] = mapped_column(CHAR(64), primary_key=True)
    window_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True)
    attempts: Mapped[int] = mapped_column(server_default="0")
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
