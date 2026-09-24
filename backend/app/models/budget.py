"""The plan for each pay period: one planned amount per category.

Actuals are never stored; they are summed from transaction splits (DATA_MODEL).
"""

from sqlalchemy import CheckConstraint, ForeignKey, Integer, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class PeriodPlan(TimestampMixin, Base):
    __tablename__ = "period_plans"
    __table_args__ = (
        UniqueConstraint("pay_period_id", "category_id", name="uq_period_plans_period_category"),
        CheckConstraint("planned_cents >= 0", name="ck_period_plans_planned_non_negative"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    pay_period_id: Mapped[int] = mapped_column(
        ForeignKey("pay_periods.id", ondelete="CASCADE"), index=True
    )
    #: Deleting a category takes its plan rows with it; they are only a plan.
    category_id: Mapped[int] = mapped_column(
        ForeignKey("categories.id", ondelete="CASCADE"), index=True
    )
    planned_cents: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    note: Mapped[str | None] = mapped_column(Text, default=None)
