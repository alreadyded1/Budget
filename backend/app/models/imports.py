"""Bank imports and rules (DATA_MODEL "Import and rules")."""

from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class ImportProfile(TimestampMixin, Base):
    """A saved CSV column mapping, reused for every file from the same bank."""

    __tablename__ = "import_profiles"
    __table_args__ = (
        CheckConstraint(
            "amount_mode IN ('single', 'debit_credit')", name="ck_import_profiles_mode"
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120, collation="NOCASE"), unique=True)
    account_id: Mapped[int | None] = mapped_column(
        ForeignKey("accounts.id", ondelete="SET NULL"), default=None
    )
    delimiter: Mapped[str] = mapped_column(String(1), default=",")
    has_header: Mapped[bool] = mapped_column(Boolean, default=True)
    skip_rows: Mapped[int] = mapped_column(Integer, default=0)
    date_column: Mapped[int] = mapped_column(Integer, default=0)
    date_format: Mapped[str] = mapped_column(String(16), default="MM/DD/YYYY")
    amount_mode: Mapped[str] = mapped_column(String(16), default="single")
    amount_column: Mapped[int | None] = mapped_column(Integer, default=None)
    debit_column: Mapped[int | None] = mapped_column(Integer, default=None)
    credit_column: Mapped[int | None] = mapped_column(Integer, default=None)
    invert_sign: Mapped[bool] = mapped_column(Boolean, default=False)
    description_column: Mapped[int] = mapped_column(Integer, default=1)
    memo_column: Mapped[int | None] = mapped_column(Integer, default=None)


class ImportBatch(TimestampMixin, Base):
    __tablename__ = "import_batches"
    __table_args__ = (
        CheckConstraint("format IN ('csv', 'ofx', 'qfx')", name="ck_import_batches_format"),
        CheckConstraint(
            "status IN ('staged', 'committed', 'undone')", name="ck_import_batches_status"
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), index=True)
    filename: Mapped[str] = mapped_column(String(255))
    format: Mapped[str] = mapped_column(String(8))
    profile_id: Mapped[int | None] = mapped_column(
        ForeignKey("import_profiles.id", ondelete="SET NULL"), default=None
    )
    status: Mapped[str] = mapped_column(String(16), default="staged")
    row_count: Mapped[int] = mapped_column(Integer, default=0)
    imported_count: Mapped[int] = mapped_column(Integer, default=0)
    duplicate_count: Mapped[int] = mapped_column(Integer, default=0)
    matched_count: Mapped[int] = mapped_column(Integer, default=0)
    #: Lines the parser could not read, as "line N: reason" text, shown on review.
    parse_errors: Mapped[str | None] = mapped_column(Text, default=None)
    created_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), default=None
    )
    committed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    undone_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)

    rows: Mapped[list["ImportStagedRow"]] = relationship(
        back_populates="batch",
        cascade="all, delete-orphan",
        order_by="ImportStagedRow.row_index",
    )


class ImportStagedRow(TimestampMixin, Base):
    """A row on the review screen. Kept after commit, for history, undo and rule tests."""

    __tablename__ = "import_staged_rows"
    __table_args__ = (
        CheckConstraint(
            "disposition IN ('import', 'skip', 'match')", name="ck_import_rows_disposition"
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    batch_id: Mapped[int] = mapped_column(
        ForeignKey("import_batches.id", ondelete="CASCADE"), index=True
    )
    row_index: Mapped[int] = mapped_column(Integer)
    date: Mapped[date] = mapped_column(Date)
    amount_cents: Mapped[int] = mapped_column(Integer)
    raw_description: Mapped[str] = mapped_column(Text, default="")
    raw_memo: Mapped[str] = mapped_column(Text, default="")
    import_key: Mapped[str] = mapped_column(String(64))
    payee_id: Mapped[int | None] = mapped_column(
        ForeignKey("payees.id", ondelete="SET NULL"), default=None
    )
    new_payee_name: Mapped[str | None] = mapped_column(String(120), default=None)
    category_id: Mapped[int | None] = mapped_column(
        ForeignKey("categories.id", ondelete="SET NULL"), default=None
    )
    memo: Mapped[str | None] = mapped_column(Text, default=None)
    disposition: Mapped[str] = mapped_column(String(8), default="import")
    #: Already in the ledger from an earlier import (the same key).
    is_duplicate: Mapped[bool] = mapped_column(Boolean, default=False)
    matched_transaction_id: Mapped[int | None] = mapped_column(
        ForeignKey("transactions.id", ondelete="SET NULL"), default=None
    )
    applied_rule_id: Mapped[int | None] = mapped_column(
        ForeignKey("rules.id", ondelete="SET NULL"), default=None
    )
    #: An unpaid bill this row looks like the payment for, and whether to link it (D-076).
    bill_occurrence_id: Mapped[int | None] = mapped_column(
        ForeignKey("subscription_occurrences.id", ondelete="SET NULL"), default=None
    )
    link_bill: Mapped[bool] = mapped_column(Boolean, default=False)
    #: After commit: the transaction this row created, and a matched entry's old status.
    created_transaction_id: Mapped[int | None] = mapped_column(
        ForeignKey("transactions.id", ondelete="SET NULL"), default=None
    )
    previous_status: Mapped[str | None] = mapped_column(String(16), default=None)

    batch: Mapped[ImportBatch] = relationship(back_populates="rows")


class Rule(TimestampMixin, Base):
    __tablename__ = "rules"
    __table_args__ = (
        CheckConstraint("match_field IN ('description', 'memo')", name="ck_rules_field"),
        CheckConstraint(
            "match_type IN ('contains', 'starts_with', 'equals', 'regex')", name="ck_rules_type"
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    #: Lower runs first; the first matching rule wins (D-074).
    priority: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    match_field: Mapped[str] = mapped_column(String(16), default="description")
    match_type: Mapped[str] = mapped_column(String(16), default="contains")
    match_value: Mapped[str] = mapped_column(Text)
    amount_min_cents: Mapped[int | None] = mapped_column(Integer, default=None)
    amount_max_cents: Mapped[int | None] = mapped_column(Integer, default=None)
    account_id: Mapped[int | None] = mapped_column(
        ForeignKey("accounts.id", ondelete="SET NULL"), default=None
    )
    set_payee_id: Mapped[int | None] = mapped_column(
        ForeignKey("payees.id", ondelete="SET NULL"), default=None
    )
    set_category_id: Mapped[int | None] = mapped_column(
        ForeignKey("categories.id", ondelete="SET NULL"), default=None
    )
    set_memo: Mapped[str | None] = mapped_column(Text, default=None)
