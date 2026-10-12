"""Model layer; phase one defines only the declarative base, not business tables."""

from app.db.base import Base

__all__ = ["Base"]
