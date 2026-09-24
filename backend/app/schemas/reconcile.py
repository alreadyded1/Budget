"""Reconciliation schemas. Amounts are integer cents in the account's own sign."""

import datetime

from pydantic import BaseModel, ConfigDict

from app.schemas.transaction import BalanceOut, TransactionOut


class ReconciliationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    account_id: int
    statement_date: datetime.date
    #: In the account's sign: a card owing $512.30 is -51230.
    statement_balance_cents: int
    adjustment_transaction_id: int | None
    #: The adjustment's amount while it still exists.
    adjustment_cents: int | None = None
    #: How many transactions it locked (including the adjustment).
    transaction_count: int = 0
    completed_by: int | None
    completed_at: datetime.datetime


class WorksheetOut(BaseModel):
    account_id: int
    is_liability: bool
    statement_date: datetime.date
    #: Opening balance plus every reconciled transaction.
    reconciled_cents: int
    #: The sum of the ticked (cleared) rows below.
    ticked_cents: int
    #: Uncleared and cleared transactions up to the statement date, oldest first.
    rows: list[TransactionOut]
    last: ReconciliationOut | None


class FinishIn(BaseModel):
    statement_date: datetime.date
    statement_balance_cents: int
    #: Finish with an adjustment transaction for whatever difference is left.
    adjust: bool = False
    adjustment_category_id: int | None = None


class ReconcileResultOut(BaseModel):
    reconciliation: ReconciliationOut
    balances: list[BalanceOut]


class HistoryOut(BaseModel):
    items: list[ReconciliationOut]
