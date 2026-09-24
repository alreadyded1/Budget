"""Payees: search, rename, merge, hide."""

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session as DbSession

from app.db import get_db
from app.models import Payee
from app.schemas.payee import (
    MergeRequest,
    MergeResult,
    PayeeCreate,
    PayeeListOut,
    PayeeOut,
    PayeeUpdate,
)
from app.services import payees as service

router = APIRouter(prefix="/payees", tags=["payees"])


def _payee_out(db: DbSession, payee: Payee) -> PayeeOut:
    usage = service.usage_for(db, payee.id)
    return PayeeOut(
        id=payee.id,
        name=payee.name,
        default_category_id=payee.default_category_id,
        notes=payee.notes,
        is_hidden=payee.is_hidden,
        transaction_count=usage.transaction_count,
        last_used=usage.last_used,
        total_spent_cents=usage.total_spent_cents,
        last_category_id=usage.last_category_id,
        last_amount_cents=usage.last_amount_cents,
    )


@router.get("", response_model=PayeeListOut)
def list_payees(
    db: DbSession = Depends(get_db),
    search: str = Query(default=""),
    include_hidden: bool = Query(default=True),
) -> PayeeListOut:
    rows = service.list_payees(db, search=search, include_hidden=include_hidden)
    return PayeeListOut(items=[_payee_out(db, row) for row in rows])


@router.post("", response_model=PayeeOut, status_code=201)
def create_payee(payload: PayeeCreate, db: DbSession = Depends(get_db)) -> PayeeOut:
    payee = service.create_payee(
        db,
        payload.name,
        default_category_id=payload.default_category_id,
        notes=payload.notes,
    )
    return _payee_out(db, payee)


@router.patch("/{payee_id}", response_model=PayeeOut)
def update_payee(payee_id: int, payload: PayeeUpdate, db: DbSession = Depends(get_db)) -> PayeeOut:
    changes = payload.model_dump(exclude_unset=True)
    return _payee_out(db, service.update_payee(db, payee_id, changes))


@router.post("/{payee_id}/merge", response_model=MergeResult)
def merge_payee(
    payee_id: int, payload: MergeRequest, db: DbSession = Depends(get_db)
) -> MergeResult:
    """Merge `source_id` into this payee, then delete the source (SPEC §5)."""
    moved = service.merge_payees(db, payload.source_id, payee_id)
    return MergeResult(payee=_payee_out(db, service.get_payee(db, payee_id)), moved=moved)


@router.delete("/{payee_id}", status_code=204)
def delete_payee(payee_id: int, db: DbSession = Depends(get_db)) -> Response:
    service.delete_payee(db, payee_id)
    return Response(status_code=204)
