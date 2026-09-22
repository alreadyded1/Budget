"""The household's pay schedule and the periods it generates."""

from datetime import date

from sqlalchemy import Boolean, CheckConstraint, Date, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

FREQUENCIES = ("weekly", "biweekly", "semimonthly", "monthly")
WEEKEND_RULES = ("none", "previous_business_day", "next_business_day")


def _in_list(column: str, values: tuple[str, ...]) -> str:
    joined = ", ".join(f"'{value}'" for value in values)
    return f"{column} IN ({joined})"


class PaySchedule(TimestampMixin, Base):
    """One row per schedule. A change is a new row with a later effective_from."""

    __tablename__ = "pay_schedules"
    __table_args__ = (
        CheckConstraint(_in_list("frequency", FREQUENCIES), name="ck_pay_schedules_frequency"),
        CheckConstraint(
            _in_list("weekend_rule", WEEKEND_RULES), name="ck_pay_schedules_weekend_rule"
        ),
        CheckConstraint(
            "day_of_month_1 IS NULL OR day_of_month_1 BETWEEN 1 AND 31",
            name="ck_pay_schedules_day_1",
        ),
        CheckConstraint(
            "day_of_month_2 IS NULL OR day_of_month_2 BETWEEN 1 AND 31",
            name="ck_pay_schedules_day_2",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    frequency: Mapped[str] = mapped_column(String(16))
    anchor_date: Mapped[date | None] = mapped_column(Date, default=None)
    day_of_month_1: Mapped[int | None] = mapped_column(Integer, default=None)
    day_of_month_2: Mapped[int | None] = mapped_column(Integer, default=None)
    weekend_rule: Mapped[str] = mapped_column(String(32), default="none", server_default="none")
    effective_from: Mapped[date] = mapped_column(Date, unique=True, index=True)
    notes: Mapped[str | None] = mapped_column(Text, default=None)

    periods: Mapped[list["PayPeriod"]] = relationship(back_populates="schedule")


class PayPeriod(TimestampMixin, Base):
    """A pay period. `start_date` is the actual pay date; `end_date` is inclusive."""

    __tablename__ = "pay_periods"
    __table_args__ = (
        Index("ix_pay_periods_range", "start_date", "end_date"),
        CheckConstraint("end_date >= start_date", name="ck_pay_periods_order"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    start_date: Mapped[date] = mapped_column(Date, unique=True, index=True)
    end_date: Mapped[date] = mapped_column(Date)
    schedule_id: Mapped[int] = mapped_column(ForeignKey("pay_schedules.id"), index=True)
    is_transition: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")

    schedule: Mapped[PaySchedule] = relationship(back_populates="periods")
