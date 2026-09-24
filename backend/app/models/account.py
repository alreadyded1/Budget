"""Accounts and the dated valuations that manual-valuation accounts use."""

from datetime import date

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

ACCOUNT_TYPES = (
    "checking",
    "savings",
    "credit_card",
    "cash",
    "loan",
    "mortgage",
    "investment",
    "other_asset",
    "other_liability",
)
VALUATION_MODES = ("transactions", "manual")

#: Types that feed the budget unless the household says otherwise (SPEC §3).
DEFAULT_ON_BUDGET_TYPES = frozenset({"checking", "savings", "credit_card", "cash"})
#: Types whose balances are amounts owed, and therefore negative (DATA_MODEL conventions).
LIABILITY_TYPES = frozenset({"credit_card", "loan", "mortgage", "other_liability"})


def _in_list(column: str, values: tuple[str, ...]) -> str:
    joined = ", ".join(f"'{value}'" for value in values)
    return f"{column} IN ({joined})"


class Account(TimestampMixin, Base):
    __tablename__ = "accounts"
    __table_args__ = (
        CheckConstraint(_in_list("type", ACCOUNT_TYPES), name="ck_accounts_type"),
        CheckConstraint(
            _in_list("valuation_mode", VALUATION_MODES), name="ck_accounts_valuation_mode"
        ),
        CheckConstraint(
            "payment_due_day IS NULL OR payment_due_day BETWEEN 1 AND 31",
            name="ck_accounts_payment_due_day",
        ),
        CheckConstraint("apr_bps IS NULL OR apr_bps >= 0", name="ck_accounts_apr_bps"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120, collation="NOCASE"), unique=True, index=True)
    type: Mapped[str] = mapped_column(String(24))
    on_budget: Mapped[bool] = mapped_column(Boolean, default=True, server_default="1")
    opening_balance_cents: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    opening_date: Mapped[date] = mapped_column(Date)
    institution: Mapped[str | None] = mapped_column(String(120), default=None)
    last4: Mapped[str | None] = mapped_column(String(4), default=None)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    is_closed: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    #: The day it was closed; net worth history stops counting it after this (D-094).
    closed_on: Mapped[date | None] = mapped_column(Date, default=None)
    valuation_mode: Mapped[str] = mapped_column(
        String(16), default="transactions", server_default="transactions"
    )

    # Debt accounts only. APR is basis points so 24.99% is 2499 and no float is involved.
    apr_bps: Mapped[int | None] = mapped_column(Integer, default=None)
    min_payment_cents: Mapped[int | None] = mapped_column(Integer, default=None)
    payment_due_day: Mapped[int | None] = mapped_column(Integer, default=None)

    low_balance_alert_cents: Mapped[int | None] = mapped_column(Integer, default=None)
    #: The day the balance last dropped below the alert threshold; cleared once it recovers.
    #: One alert per dip (D-069).
    low_balance_since: Mapped[date | None] = mapped_column(Date, default=None)

    valuations: Mapped[list["AccountValuation"]] = relationship(
        back_populates="account", cascade="all, delete-orphan"
    )

    @property
    def is_liability(self) -> bool:
        return self.type in LIABILITY_TYPES


class AccountValuation(TimestampMixin, Base):
    """A dated balance the household types in themselves."""

    __tablename__ = "account_valuations"
    __table_args__ = (
        UniqueConstraint("account_id", "date", name="uq_account_valuations_account_date"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(
        ForeignKey("accounts.id", ondelete="CASCADE"), index=True
    )
    date: Mapped[date] = mapped_column(Date)
    balance_cents: Mapped[int] = mapped_column(Integer)
    note: Mapped[str | None] = mapped_column(Text, default=None)

    account: Mapped[Account] = relationship(back_populates="valuations")
