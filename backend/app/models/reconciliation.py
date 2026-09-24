"""Finished reconciliations (SPEC §12): one row per statement an account was balanced to."""

from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Index, Integer
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class Reconciliation(TimestampMixin, Base):
    __tablename__ = "reconciliations"
    __table_args__ = (Index("ix_reconciliations_account_date", "account_id", "statement_date"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"))
    statement_date: Mapped[date] = mapped_column(Date)
    #: In the account's own sign: a credit card owing $512.30 is -51230.
    statement_balance_cents: Mapped[int] = mapped_column(Integer)
    #: No foreign key: transactions already point here, and a cycle would break table
    #: ordering. The reconcile service clears it when that transaction is deleted.
    adjustment_transaction_id: Mapped[int | None] = mapped_column(Integer, default=None)
    completed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), default=None)
    completed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
