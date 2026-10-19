from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Integer, LargeBinary, SmallInteger, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

DEFAULTS = {
    "title": "RunNote",
    "subtitle": "跑步与足迹",
    "footer_tagline": "记录每一步，看见你的进步。",
    "description": "汇总你的跑步数据、活动日历与运动趋势，从这里探索记录、足迹和 AI 分析。",
    "default_theme": "system",
}


class SiteSettings(Base):
    __tablename__ = "site_settings"
    __table_args__ = (
        CheckConstraint("id = 1", name="singleton"),
        CheckConstraint("char_length(btrim(title)) > 0", name="title_present"),
        CheckConstraint("default_theme IN ('system','light','dark')", name="default_theme_valid"),
    )

    id: Mapped[int] = mapped_column(SmallInteger, primary_key=True, default=1)
    title: Mapped[str] = mapped_column(String(40), server_default=DEFAULTS["title"])
    subtitle: Mapped[str] = mapped_column(String(40), server_default=DEFAULTS["subtitle"])
    footer_tagline: Mapped[str] = mapped_column(
        String(80), server_default=DEFAULTS["footer_tagline"]
    )
    description: Mapped[str] = mapped_column(String(200), server_default=DEFAULTS["description"])
    default_theme: Mapped[str] = mapped_column(String(10), server_default=DEFAULTS["default_theme"])
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class SiteImage(Base):
    __tablename__ = "site_images"
    __table_args__ = (
        CheckConstraint("kind IN ('favicon','logo')", name="kind_valid"),
        CheckConstraint("octet_length(png_bytes) > 0", name="png_present"),
    )

    kind: Mapped[str] = mapped_column(String(10), primary_key=True)
    png_bytes: Mapped[bytes] = mapped_column(LargeBinary, deferred=True)
    width: Mapped[int] = mapped_column(Integer)
    height: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String(64))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
