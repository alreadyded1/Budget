"""The household's debt payoff plan (SPEC §14): one row."""

from sqlalchemy import JSON, CheckConstraint, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin

DEBT_PLAN_ID = 1


class DebtPlan(TimestampMixin, Base):
    __tablename__ = "debt_plan"
    __table_args__ = (
        CheckConstraint(
            "strategy IN ('snowball', 'avalanche', 'custom')", name="ck_debt_plan_strategy"
        ),
        CheckConstraint("extra_monthly_cents >= 0", name="ck_debt_plan_extra"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    strategy: Mapped[str] = mapped_column(String(16), default="avalanche")
    extra_monthly_cents: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    #: Account ids in the household's own order, for the custom strategy.
    custom_order: Mapped[list] = mapped_column(JSON, default=list)
