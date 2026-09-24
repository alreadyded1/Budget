"""Savings goals and sinking funds (SPEC §13, DATA_MODEL "Goals")."""

from datetime import date

from sqlalchemy import Boolean, CheckConstraint, Date, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin

GOAL_TYPES = ("savings", "sinking_fund")


class Goal(TimestampMixin, Base):
    __tablename__ = "goals"
    __table_args__ = (
        CheckConstraint("type IN ('savings', 'sinking_fund')", name="ck_goals_type"),
        CheckConstraint("target_cents > 0", name="ck_goals_target_positive"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    type: Mapped[str] = mapped_column(String(16))
    target_cents: Mapped[int] = mapped_column(Integer)
    target_date: Mapped[date | None] = mapped_column(Date, default=None)
    #: Savings goals: the account whose balance is the progress.
    account_id: Mapped[int | None] = mapped_column(
        ForeignKey("accounts.id", ondelete="SET NULL"), default=None
    )
    #: Sinking funds: the fund's category. Savings goals: the optional plan category that
    #: "Use suggested contribution" writes to (D-092).
    category_id: Mapped[int | None] = mapped_column(
        ForeignKey("categories.id", ondelete="SET NULL"), default=None, index=True
    )
    #: Sinking funds: the money already set aside on start_date. Savings goals: the part of
    #: the account balance that does not count toward this goal.
    starting_balance_cents: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    #: The first day of the pay period the goal starts counting from (D-088).
    start_date: Mapped[date] = mapped_column(Date)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    notes: Mapped[str | None] = mapped_column(Text, default=None)
