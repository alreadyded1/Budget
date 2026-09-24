"""Reconciliation (SPEC §12). Ticking a row is the ordinary status PATCH on the transaction."""

import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session as DbSession

from app.api.v1.transactions import transaction_outs
from app.auth import current_user
from app.db import get_db
from app.models import Reconciliation, User
from app.schemas.reconcile import (
    FinishIn,
    HistoryOut,
    ReconcileResultOut,
    ReconciliationOut,
    WorksheetOut,
)
from app.schemas.transaction import BalanceOut
from app.services import reconcile as service

router = APIRouter(tags=["reconcile"])


def outs(db: DbSession, records: list[Reconciliation]) -> list[ReconciliationOut]:
    counts = service.counts(db, [record.id for record in records])
    adjustments = service.adjustment_amounts(db, records)
    return [
        ReconciliationOut.model_validate(record).model_copy(
            update={
                "transaction_count": counts.get(record.id, 0),
                "adjustment_cents": adjustments.get(record.id),
            }
        )
        for record in records
    ]


@router.get("/accounts/{account_id}/reconcile", response_model=WorksheetOut)
def get_worksheet(
    account_id: int,
    statement_date: datetime.date = Query(),
    db: DbSession = Depends(get_db),
) -> WorksheetOut:
    sheet = service.worksheet(db, account_id, statement_date)
    return WorksheetOut(
        account_id=account_id,
        is_liability=sheet.account.is_liability,
        statement_date=statement_date,
        reconciled_cents=sheet.reconciled_cents,
        ticked_cents=sheet.ticked_cents,
        rows=transaction_outs(db, sheet.rows),
        last=outs(db, [sheet.last])[0] if sheet.last else None,
    )


@router.post(
    "/accounts/{account_id}/reconciliations", response_model=ReconcileResultOut, status_code=201
)
def finish_reconciliation(
    account_id: int,
    payload: FinishIn,
    db: DbSession = Depends(get_db),
    user: User = Depends(current_user),
) -> ReconcileResultOut:
    record, balances = service.finish(
        db,
        account_id,
        statement_date=payload.statement_date,
        statement_balance_cents=payload.statement_balance_cents,
        adjust=payload.adjust,
        adjustment_category_id=payload.adjustment_category_id,
        user_id=user.id,
    )
    return ReconcileResultOut(
        reconciliation=outs(db, [record])[0],
        balances=[BalanceOut(**balance.as_dict()) for balance in balances],
    )


@router.get("/accounts/{account_id}/reconciliations", response_model=HistoryOut)
def list_reconciliations(account_id: int, db: DbSession = Depends(get_db)) -> HistoryOut:
    return HistoryOut(items=outs(db, service.history(db, account_id)))


@router.post("/reconciliations/{reconciliation_id}/undo", response_model=ReconcileResultOut)
def undo_reconciliation(
    reconciliation_id: int, db: DbSession = Depends(get_db)
) -> ReconcileResultOut:
    record, balances = service.undo(db, reconciliation_id)
    return ReconcileResultOut(
        reconciliation=ReconciliationOut.model_validate(record),
        balances=[BalanceOut(**balance.as_dict()) for balance in balances],
    )
