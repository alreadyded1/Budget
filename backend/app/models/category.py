"""Category groups and the categories inside them."""

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

GROUP_KINDS = ("expense", "income")


class CategoryGroup(TimestampMixin, Base):
    __tablename__ = "category_groups"
    __table_args__ = (
        CheckConstraint("kind IN ('expense', 'income')", name="ck_category_groups_kind"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120, collation="NOCASE"), unique=True, index=True)
    kind: Mapped[str] = mapped_column(String(16), default="expense", server_default="expense")
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    is_hidden: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")

    categories: Mapped[list["Category"]] = relationship(
        back_populates="group", cascade="all, delete-orphan", order_by="Category.sort_order"
    )


class Category(TimestampMixin, Base):
    __tablename__ = "categories"
    __table_args__ = (UniqueConstraint("group_id", "name", name="uq_categories_group_name"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    group_id: Mapped[int] = mapped_column(ForeignKey("category_groups.id"), index=True)
    name: Mapped[str] = mapped_column(String(120, collation="NOCASE"))
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    is_hidden: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    is_sinking_fund: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    #: The budget template amount for one period, in cents.
    default_planned_cents: Mapped[int] = mapped_column(Integer, default=0, server_default="0")

    group: Mapped[CategoryGroup] = relationship(back_populates="categories")
