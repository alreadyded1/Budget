"""The ledger: transactions, splits, transfers, balances and bulk actions."""

from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session as DbSession

from app.auth import current_user
from app.db import get_db
from app.models import Transaction, User
from app.schemas.transaction import (
    BalanceListOut,
    BalanceOut,
    BillMatchOut,
    BulkCategory,
    BulkDelete,
    BulkStatus,
    LedgerPageOut,
    LedgerRowOut,
    MutationOut,
    TransactionCreate,
    TransactionOut,
    TransactionUpdate,
    TransferCreate,
)
from app.services import accounts as accounts_service
from app.services import balances as balances_service
from app.services import ledger as ledger_service
from app.services import subscriptions as subscriptions_service
from app.services import transactions as service

router = APIRouter(tags=["transactions"])


def _out(transaction: Transaction, partners: dict[int, int]) -> TransactionOut:
    out = TransactionOut.model_validate(transaction)
    out.transfer_account_id = partners.get(transaction.id)
    return out


def transaction_outs(db: DbSession, rows: list[Transaction]) -> list[TransactionOut]:
    partners = service.transfer_partner_accounts(db, rows)
    return [_out(row, partners) for row in rows]


def _mutation(db: DbSession, result: service.TransactionResult) -> MutationOut:
    return MutationOut(
        transactions=transaction_outs(db, result.transactions),
        deleted_ids=result.deleted_ids,
        balances=[BalanceOut(**balance.as_dict()) for balance in result.balances],
    )


def _splits_from(payload) -> list[service.SplitInput] | None:
    if payload is None:
        return None
    return [
        service.SplitInput(
            amount_cents=split.amount_cents, category_id=split.category_id, memo=split.memo
        )
        for split in payload
    ]


@router.get("/transactions", response_model=LedgerPageOut)
def list_transactions(
    db: DbSession = Depends(get_db),
    account_id: int | None = Query(default=None),
    start: date | None = Query(default=None, alias="from"),
    end: date | None = Query(default=None, alias="to"),
    payee_id: int | None = Query(default=None),
    category_id: int | None = Query(default=None),
    status: str | None = Query(default=None),
    min_cents: int | None = Query(default=None),
    max_cents: int | None = Query(default=None),
    text: str | None = Query(default=None),
    uncategorized: bool = Query(default=False),
    on_budget: bool | None = Query(default=None),
    cursor: str | None = Query(default=None),
    limit: int = Query(default=ledger_service.DEFAULT_LIMIT, ge=1, le=ledger_service.MAX_LIMIT),
) -> LedgerPageOut:
    filters = ledger_service.LedgerFilters(
        account_id=account_id,
        start=start,
        end=end,
        payee_id=payee_id,
        category_id=category_id,
        status=status,
        min_cents=min_cents,
        max_cents=max_cents,
        text=text,
        uncategorized=uncategorized,
        on_budget=on_budget,
    )
    page = ledger_service.query(db, filters, cursor=cursor, limit=limit)
    partners = service.transfer_partner_accounts(db, [row.transaction for row in page.rows])
    return LedgerPageOut(
        items=[
            LedgerRowOut(
                transaction=_out(row.transaction, partners),
                running_balance_cents=row.running_balance_cents,
            )
            for row in page.rows
        ],
        next_cursor=page.next_cursor,
        total_cents=page.total_cents,
    )


@router.post("/transactions", response_model=MutationOut, status_code=201)
def create_transaction(
    payload: TransactionCreate,
    db: DbSession = Depends(get_db),
    user: User = Depends(current_user),
) -> MutationOut:
    if payload.subscription_occurrence_id is not None:
        # Refuse an unknown bill before anything is written.
        subscriptions_service.get_occurrence(db, payload.subscription_occurrence_id)
    result = service.create_transaction(
        db,
        account_id=payload.account_id,
        on=payload.date,
        amount_cents=payload.amount_cents,
        splits=_splits_from(payload.splits),
        payee_id=payload.payee_id,
        memo=payload.memo,
        status=payload.status,
        check_number=payload.check_number,
        user_id=user.id,
    )
    out = _mutation(db, result)
    after = subscriptions_service.after_transaction_created(
        db, result.transactions[0], payload.subscription_occurrence_id
    )
    out.paid_occurrence_id = after.paid_occurrence_id
    if after.match is not None:
        out.bill_match = BillMatchOut(
            occurrence_id=after.match.occurrence.id,
            name=after.match.subscription.name,
            due_date=after.match.occurrence.due_date,
            amount_cents=after.match.occurrence.amount_cents,
        )
    return out


@router.get("/transactions/{transaction_id}", response_model=TransactionOut)
def get_transaction(transaction_id: int, db: DbSession = Depends(get_db)) -> TransactionOut:
    return transaction_outs(db, [service.get_transaction(db, transaction_id)])[0]


@router.patch("/transactions/{transaction_id}", response_model=MutationOut)
def update_transaction(
    transaction_id: int,
    payload: TransactionUpdate,
    db: DbSession = Depends(get_db),
    user: User = Depends(current_user),
    confirm: bool = Query(default=False),
) -> MutationOut:
    changes = payload.model_dump(exclude_unset=True, exclude={"splits"})
    result = service.update_transaction(
        db,
        transaction_id,
        changes,
        splits=_splits_from(payload.splits),
        confirm=confirm,
        user_id=user.id,
    )
    return _mutation(db, result)


@router.delete("/transactions/{transaction_id}", response_model=MutationOut)
def delete_transaction(
    transaction_id: int,
    db: DbSession = Depends(get_db),
    confirm: bool = Query(default=False),
) -> MutationOut:
    return _mutation(db, service.delete_transaction(db, transaction_id, confirm=confirm))


@router.post("/transfers", response_model=MutationOut, status_code=201)
def create_transfer(
    payload: TransferCreate,
    db: DbSession = Depends(get_db),
    user: User = Depends(current_user),
) -> MutationOut:
    result = service.create_transfer(
        db,
        from_account_id=payload.from_account_id,
        to_account_id=payload.to_account_id,
        on=payload.date,
        amount_cents=payload.amount_cents,
        category_id=payload.category_id,
        memo=payload.memo,
        status=payload.status,
        user_id=user.id,
    )
    return _mutation(db, result)


@router.post("/transactions/bulk/status", response_model=MutationOut)
def bulk_status(
    payload: BulkStatus,
    db: DbSession = Depends(get_db),
    confirm: bool = Query(default=False),
) -> MutationOut:
    return _mutation(
        db, ledger_service.bulk_set_status(db, payload.ids, payload.status, confirm=confirm)
    )


@router.post("/transactions/bulk/category", response_model=MutationOut)
def bulk_category(payload: BulkCategory, db: DbSession = Depends(get_db)) -> MutationOut:
    return _mutation(db, ledger_service.bulk_set_category(db, payload.ids, payload.category_id))


@router.post("/transactions/bulk/delete", response_model=MutationOut)
def bulk_delete(
    payload: BulkDelete,
    db: DbSession = Depends(get_db),
    confirm: bool = Query(default=False),
) -> MutationOut:
    return _mutation(db, ledger_service.bulk_delete(db, payload.ids, confirm=confirm))


@router.get("/balances", response_model=BalanceListOut)
def list_balances(db: DbSession = Depends(get_db)) -> BalanceListOut:
    rows = accounts_service.list_accounts(db)
    return BalanceListOut(
        items=[
            BalanceOut(**balances_service.balances_for(db, account).as_dict()) for account in rows
        ]
    )


@router.get("/accounts/{account_id}/balance", response_model=BalanceOut)
def account_balance(
    account_id: int,
    db: DbSession = Depends(get_db),
    on: date | None = Query(default=None, alias="as_of"),
) -> BalanceOut:
    account = accounts_service.get_account(db, account_id)
    if on is None:
        return BalanceOut(**balances_service.balances_for(db, account).as_dict())

    value = balances_service.balance_as_of(db, account, on)
    return BalanceOut(
        account_id=account.id, current_cents=value, cleared_cents=value, reconciled_cents=value
    )
