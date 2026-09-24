"""Subscriptions and bills, their price history, and each due date (DATA_MODEL)."""

from datetime import date

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

SUBSCRIPTION_FREQUENCIES = (
    "weekly",
    "biweekly",
    "monthly",
    "quarterly",
    "semiannual",
    "annual",
    "custom",
)
SUBSCRIPTION_STATUSES = ("active", "paused", "cancelled")
OCCURRENCE_STATUSES = ("upcoming", "paid", "skipped")


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(value) for value in values)})"


class Subscription(TimestampMixin, Base):
    __tablename__ = "subscriptions"
    __table_args__ = (
        CheckConstraint(
            _in("frequency", SUBSCRIPTION_FREQUENCIES), name="ck_subscriptions_frequency"
        ),
        CheckConstraint(_in("status", SUBSCRIPTION_STATUSES), name="ck_subscriptions_status"),
        CheckConstraint(
            "interval_unit IS NULL OR interval_unit IN ('day', 'week', 'month')",
            name="ck_subscriptions_interval_unit",
        ),
        CheckConstraint("amount_cents > 0", name="ck_subscriptions_amount_positive"),
        CheckConstraint("interval_count >= 1", name="ck_subscriptions_interval_count"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    payee_id: Mapped[int | None] = mapped_column(
        ForeignKey("payees.id", ondelete="SET NULL"), default=None, index=True
    )
    category_id: Mapped[int | None] = mapped_column(
        ForeignKey("categories.id", ondelete="SET NULL"), default=None, index=True
    )
    account_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"), default=None)
    #: Positive = what it costs each time.
    amount_cents: Mapped[int] = mapped_column(Integer)
    frequency: Mapped[str] = mapped_column(String(16))
    interval_count: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    interval_unit: Mapped[str | None] = mapped_column(String(8), default=None)
    #: The first due date.
    anchor_date: Mapped[date] = mapped_column(Date)
    day_of_month: Mapped[int | None] = mapped_column(Integer, default=None)
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date, default=None)
    status: Mapped[str] = mapped_column(String(16), default="active", server_default="active")
    auto_post: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    remind_days_before: Mapped[int] = mapped_column(Integer, default=3, server_default="3")
    url: Mapped[str | None] = mapped_column(Text, default=None)
    notes: Mapped[str | None] = mapped_column(Text, default=None)

    prices: Mapped[list["SubscriptionPrice"]] = relationship(
        cascade="all, delete-orphan",
        order_by="[SubscriptionPrice.effective_date, SubscriptionPrice.id]",
    )


class SubscriptionPrice(TimestampMixin, Base):
    __tablename__ = "subscription_price_history"

    id: Mapped[int] = mapped_column(primary_key=True)
    subscription_id: Mapped[int] = mapped_column(
        ForeignKey("subscriptions.id", ondelete="CASCADE"), index=True
    )
    effective_date: Mapped[date] = mapped_column(Date)
    amount_cents: Mapped[int] = mapped_column(Integer)


class SubscriptionOccurrence(TimestampMixin, Base):
    __tablename__ = "subscription_occurrences"
    __table_args__ = (
        UniqueConstraint("subscription_id", "due_date", name="uq_occurrences_subscription_due"),
        CheckConstraint(_in("status", OCCURRENCE_STATUSES), name="ck_occurrences_status"),
        Index("ix_occurrences_due_date", "due_date"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    subscription_id: Mapped[int] = mapped_column(
        ForeignKey("subscriptions.id", ondelete="CASCADE"), index=True
    )
    due_date: Mapped[date] = mapped_column(Date)
    amount_cents: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(16), default="upcoming", server_default="upcoming")
    #: The payment, once linked. A deleted payment puts the occurrence back to upcoming.
    transaction_id: Mapped[int | None] = mapped_column(
        ForeignKey("transactions.id", ondelete="SET NULL"), default=None, index=True
    )

    subscription: Mapped[Subscription] = relationship()
