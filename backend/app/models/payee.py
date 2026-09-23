"""Payees. Names are unique case-insensitively; a rename onto an existing name is a merge."""

from sqlalchemy import Boolean, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin
from app.models.category import Category


class Payee(TimestampMixin, Base):
    __tablename__ = "payees"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120, collation="NOCASE"), unique=True, index=True)
    #: The pinned default category. Without one, the last category used wins (computed, not stored).
    default_category_id: Mapped[int | None] = mapped_column(
        ForeignKey("categories.id", ondelete="SET NULL"), default=None, index=True
    )
    notes: Mapped[str | None] = mapped_column(Text, default=None)
    is_hidden: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")

    default_category: Mapped[Category | None] = relationship()
