"""Transaction, split and ledger schemas. Every amount is integer cents."""

import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Status = Literal["uncleared", "cleared", "reconciled"]


class SplitIn(BaseModel):
    amount_cents: int
    category_id: int | None = None
    memo: str | None = Field(default=None, max_length=500)


class SplitOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    category_id: int | None
    amount_cents: int
    memo: str | None
    sort_order: int


class TransactionCreate(BaseModel):
    account_id: int
    date: datetime.date
    amount_cents: int
    payee_id: int | None = None
    memo: str | None = Field(default=None, max_length=500)
    status: Status = "uncleared"
    check_number: str | None = Field(default=None, max_length=32)
    splits: list[SplitIn] | None = None
    #: Mark this bill paid by the new transaction ("Mark paid" from the calendar).
    subscription_occurrence_id: int | None = None


class TransactionUpdate(BaseModel):
    account_id: int | None = None
    date: datetime.date | None = None
    amount_cents: int | None = None
    payee_id: int | None = None
    memo: str | None = Field(default=None, max_length=500)
    status: Status | None = None
    check_number: str | None = Field(default=None, max_length=32)
    splits: list[SplitIn] | None = None


class TransferCreate(BaseModel):
    from_account_id: int
    to_account_id: int
    date: datetime.date
    #: The positive amount moved; the legs are signed automatically.
    amount_cents: int = Field(gt=0)
    category_id: int | None = None
    memo: str | None = Field(default=None, max_length=500)
    status: Status = "uncleared"


class TransactionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    account_id: int
    date: datetime.date
    payee_id: int | None
    memo: str | None
    amount_cents: int
    status: Status
    check_number: str | None
    transfer_id: str | None
    #: The account on the other leg of a transfer; null for everything else.
    transfer_account_id: int | None = None
    splits: list[SplitOut]


class BalanceOut(BaseModel):
    account_id: int
    current_cents: int
    cleared_cents: int
    reconciled_cents: int


class BillMatchOut(BaseModel):
    """An unpaid bill a newly saved transaction looks like the payment for (SPEC §9)."""

    occurrence_id: int
    name: str
    due_date: datetime.date
    amount_cents: int


class MutationOut(BaseModel):
    """Mutations carry the aggregates they changed, so the UI never needs a refetch."""

    transactions: list[TransactionOut] = []
    deleted_ids: list[int] = []
    balances: list[BalanceOut] = []
    #: Set on a create when the new transaction matches an unpaid bill.
    bill_match: BillMatchOut | None = None
    #: The bill this create marked paid, when it was asked to.
    paid_occurrence_id: int | None = None


class LedgerRowOut(BaseModel):
    transaction: TransactionOut
    #: Present only for a single-account query; null otherwise.
    running_balance_cents: int | None


class LedgerPageOut(BaseModel):
    items: list[LedgerRowOut]
    next_cursor: str | None
    total_cents: int


class BulkStatus(BaseModel):
    ids: list[int]
    status: Status


class BulkCategory(BaseModel):
    ids: list[int]
    category_id: int | None


class BulkDelete(BaseModel):
    ids: list[int]


class BalanceListOut(BaseModel):
    items: list[BalanceOut]
