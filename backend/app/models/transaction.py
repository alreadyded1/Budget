"""Transactions and their splits.

Sign convention (CLAUDE.md): amounts are signed from the account's point of view, so an
outflow is negative and an inflow positive. Every split carries the same sign as its
parent, and the splits always add up to the transaction.
"""

from datetime import date

from sqlalchemy import (
    CheckConstraint,
    Date,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

STATUSES = ("uncleared", "cleared", "reconciled")


class Transaction(TimestampMixin, Base):
    __tablename__ = "transactions"
    __table_args__ = (
        CheckConstraint(
            "status IN ('uncleared', 'cleared', 'reconciled')", name="ck_transactions_status"
        ),
        Index("ix_transactions_account_date", "account_id", "date"),
        Index("ix_transactions_date", "date"),
        Index("ix_transactions_transfer_id", "transfer_id"),
        Index("ix_transactions_account_import_key", "account_id", "import_key"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), index=True)
    date: Mapped[date] = mapped_column(Date)
    #: Null for transfers, which use a virtual payee in the UI instead (SPEC §5).
    payee_id: Mapped[int | None] = mapped_column(ForeignKey("payees.id"), default=None, index=True)
    memo: Mapped[str | None] = mapped_column(Text, default=None)
    amount_cents: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(16), default="uncleared", server_default="uncleared")
    check_number: Mapped[str | None] = mapped_column(String(32), default=None)
    #: Both legs of a transfer share this. Null for everything else.
    transfer_id: Mapped[str | None] = mapped_column(String(36), default=None)

    #: Import bookkeeping (Phase 10, D-044): the batch that created it, the duplicate key
    #: (also set on a manual entry an import matched), and the bank's own description.
    import_batch_id: Mapped[int | None] = mapped_column(
        ForeignKey("import_batches.id", ondelete="SET NULL"), default=None
    )
    import_key: Mapped[str | None] = mapped_column(String(64), default=None)
    imported_description: Mapped[str | None] = mapped_column(Text, default=None)
    #: The reconciliation that locked it (Phase 11). Set only together with status reconciled.
    reconciliation_id: Mapped[int | None] = mapped_column(
        ForeignKey("reconciliations.id", ondelete="SET NULL"), default=None, index=True
    )

    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), default=None)
    updated_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), default=None)

    splits: Mapped[list["TransactionSplit"]] = relationship(
        back_populates="transaction",
        cascade="all, delete-orphan",
        order_by="TransactionSplit.sort_order",
    )

    @property
    def is_transfer(self) -> bool:
        return self.transfer_id is not None


class TransactionSplit(TimestampMixin, Base):
    """One categorised piece of a transaction. All category reporting reads from here."""

    __tablename__ = "transaction_splits"
    __table_args__ = (Index("ix_transaction_splits_category", "category_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    transaction_id: Mapped[int] = mapped_column(
        ForeignKey("transactions.id", ondelete="CASCADE"), index=True
    )
    #: Null means uncategorized, which the budget alerts look for.
    category_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id"), default=None)
    amount_cents: Mapped[int] = mapped_column(Integer)
    memo: Mapped[str | None] = mapped_column(Text, default=None)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")

    transaction: Mapped[Transaction] = relationship(back_populates="splits")
