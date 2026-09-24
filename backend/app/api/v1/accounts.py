"""Accounts. Balances arrive with Phase 4."""

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session as DbSession

from app.db import get_db
from app.schemas.account import (
    AccountCreate,
    AccountListOut,
    AccountOut,
    AccountUpdate,
    ReorderRequest,
    ValuationCreate,
    ValuationListOut,
    ValuationOut,
)
from app.services import accounts as service

router = APIRouter(prefix="/accounts", tags=["accounts"])


@router.get("", response_model=AccountListOut)
def list_accounts(
    db: DbSession = Depends(get_db),
    include_closed: bool = Query(default=True),
) -> AccountListOut:
    rows = service.list_accounts(db, include_closed=include_closed)
    return AccountListOut(items=[AccountOut.model_validate(row) for row in rows])


@router.post("", response_model=AccountOut, status_code=201)
def create_account(payload: AccountCreate, db: DbSession = Depends(get_db)) -> AccountOut:
    return AccountOut.model_validate(service.create_account(db, **payload.model_dump()))


@router.get("/{account_id}", response_model=AccountOut)
def get_account(account_id: int, db: DbSession = Depends(get_db)) -> AccountOut:
    return AccountOut.model_validate(service.get_account(db, account_id))


@router.patch("/{account_id}", response_model=AccountOut)
def update_account(
    account_id: int, payload: AccountUpdate, db: DbSession = Depends(get_db)
) -> AccountOut:
    changes = payload.model_dump(exclude_unset=True)
    return AccountOut.model_validate(service.update_account(db, account_id, changes))


@router.post("/{account_id}/close", response_model=AccountOut)
def close_account(account_id: int, db: DbSession = Depends(get_db)) -> AccountOut:
    return AccountOut.model_validate(service.set_closed(db, account_id, True))


@router.post("/{account_id}/reopen", response_model=AccountOut)
def reopen_account(account_id: int, db: DbSession = Depends(get_db)) -> AccountOut:
    return AccountOut.model_validate(service.set_closed(db, account_id, False))


@router.post("/reorder", response_model=AccountListOut)
def reorder_accounts(payload: ReorderRequest, db: DbSession = Depends(get_db)) -> AccountListOut:
    rows = service.reorder(db, payload.ordered_ids)
    return AccountListOut(items=[AccountOut.model_validate(row) for row in rows])


@router.get("/{account_id}/valuations", response_model=ValuationListOut)
def list_valuations(account_id: int, db: DbSession = Depends(get_db)) -> ValuationListOut:
    rows = service.list_valuations(db, account_id)
    return ValuationListOut(items=[ValuationOut.model_validate(row) for row in rows])


@router.post("/{account_id}/valuations", response_model=ValuationOut, status_code=201)
def add_valuation(
    account_id: int, payload: ValuationCreate, db: DbSession = Depends(get_db)
) -> ValuationOut:
    valuation = service.set_valuation(
        db, account_id, payload.date, payload.balance_cents, payload.note
    )
    return ValuationOut.model_validate(valuation)


@router.delete("/{account_id}/valuations/{valuation_id}", status_code=204)
def delete_valuation(
    account_id: int, valuation_id: int, db: DbSession = Depends(get_db)
) -> Response:
    service.delete_valuation(db, account_id, valuation_id)
    return Response(status_code=204)
