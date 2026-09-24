"""Bank imports, CSV profiles and rules (SPEC §11)."""

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session as DbSession

from app.auth import current_user
from app.db import get_db
from app.domain.imports import csv_profile
from app.models import ImportBatch, ImportStagedRow, SubscriptionOccurrence, Transaction, User
from app.schemas.imports import (
    BatchDetailOut,
    BatchListOut,
    BatchOut,
    BatchResultOut,
    BillSuggestionOut,
    MatchOut,
    MoveIn,
    PreviewIn,
    PreviewOut,
    PreviewRowOut,
    ProblemOut,
    ProfileIn,
    ProfileListOut,
    ProfileOut,
    RowPatch,
    RuleIn,
    RuleListOut,
    RuleOut,
    RulePatch,
    RuleTestOut,
    RuleTestRowOut,
    StagedRowOut,
    StageIn,
)
from app.schemas.transaction import BalanceOut
from app.services import imports as service
from app.services import rules as rules_service

router = APIRouter(tags=["imports"])


# ------------------------------------------------------------------------------ profiles


@router.get("/import-profiles", response_model=ProfileListOut)
def list_profiles(db: DbSession = Depends(get_db)) -> ProfileListOut:
    return ProfileListOut(items=[ProfileOut.model_validate(p) for p in service.list_profiles(db)])


@router.post("/import-profiles", response_model=ProfileOut, status_code=201)
def create_profile(payload: ProfileIn, db: DbSession = Depends(get_db)) -> ProfileOut:
    return ProfileOut.model_validate(service.save_profile(db, payload.model_dump()))


@router.put("/import-profiles/{profile_id}", response_model=ProfileOut)
def update_profile(
    profile_id: int, payload: ProfileIn, db: DbSession = Depends(get_db)
) -> ProfileOut:
    return ProfileOut.model_validate(service.save_profile(db, payload.model_dump(), profile_id))


@router.delete("/import-profiles/{profile_id}", status_code=204)
def delete_profile(profile_id: int, db: DbSession = Depends(get_db)) -> Response:
    service.delete_profile(db, profile_id)
    return Response(status_code=204)


@router.post("/imports/preview", response_model=PreviewOut)
def preview(payload: PreviewIn) -> PreviewOut:
    columns, rows, problems = service.preview_csv(
        payload.content, csv_profile.CsvProfile(**payload.profile.model_dump())
    )
    return PreviewOut(
        columns=columns,
        rows=[
            PreviewRowOut(
                date=r.date, amount_cents=r.amount_cents, description=r.description, memo=r.memo
            )
            for r in rows
        ],
        problems=[ProblemOut(line=line, reason=reason) for line, reason in problems],
    )


# ------------------------------------------------------------------------------- batches


def batch_out(batch: ImportBatch) -> BatchOut:
    return BatchOut(
        id=batch.id,
        account_id=batch.account_id,
        filename=batch.filename,
        format=batch.format,
        profile_id=batch.profile_id,
        status=batch.status,
        row_count=batch.row_count,
        imported_count=batch.imported_count,
        duplicate_count=batch.duplicate_count,
        matched_count=batch.matched_count,
        parse_errors=(batch.parse_errors or "").splitlines(),
        created_at=batch.created_at,
        committed_at=batch.committed_at,
        undone_at=batch.undone_at,
    )


def row_out(db: DbSession, row: ImportStagedRow) -> StagedRowOut:
    match = None
    if row.matched_transaction_id is not None:
        tx = db.get(Transaction, row.matched_transaction_id)
        if tx is not None:
            match = MatchOut(
                transaction_id=tx.id,
                date=tx.date,
                amount_cents=tx.amount_cents,
                payee_id=tx.payee_id,
                memo=tx.memo,
            )
    bill = None
    if row.bill_occurrence_id is not None:
        occurrence = db.get(SubscriptionOccurrence, row.bill_occurrence_id)
        if occurrence is not None:
            bill = BillSuggestionOut(
                occurrence_id=occurrence.id,
                name=occurrence.subscription.name,
                due_date=occurrence.due_date,
            )
    return StagedRowOut(
        id=row.id,
        row_index=row.row_index,
        date=row.date,
        amount_cents=row.amount_cents,
        raw_description=row.raw_description,
        raw_memo=row.raw_memo,
        payee_id=row.payee_id,
        new_payee_name=row.new_payee_name,
        category_id=row.category_id,
        memo=row.memo,
        disposition=row.disposition,
        is_duplicate=row.is_duplicate,
        applied_rule_id=row.applied_rule_id,
        match=match,
        bill=bill,
        link_bill=row.link_bill,
        created_transaction_id=row.created_transaction_id,
    )


def detail_out(db: DbSession, batch: ImportBatch) -> BatchDetailOut:
    return BatchDetailOut(
        **batch_out(batch).model_dump(), rows=[row_out(db, row) for row in batch.rows]
    )


@router.post("/imports", response_model=BatchDetailOut, status_code=201)
def stage_import(
    payload: StageIn, db: DbSession = Depends(get_db), user: User = Depends(current_user)
) -> BatchDetailOut:
    batch = service.stage(
        db,
        account_id=payload.account_id,
        filename=payload.filename,
        content=payload.content,
        profile_id=payload.profile_id,
        user_id=user.id,
    )
    return detail_out(db, batch)


@router.get("/imports", response_model=BatchListOut)
def list_imports(
    db: DbSession = Depends(get_db), account_id: int | None = Query(default=None)
) -> BatchListOut:
    return BatchListOut(items=[batch_out(b) for b in service.list_batches(db, account_id)])


@router.get("/imports/{batch_id}", response_model=BatchDetailOut)
def get_import(batch_id: int, db: DbSession = Depends(get_db)) -> BatchDetailOut:
    return detail_out(db, service.get_batch(db, batch_id))


@router.patch("/imports/{batch_id}/rows/{row_id}", response_model=StagedRowOut)
def update_row(
    batch_id: int, row_id: int, payload: RowPatch, db: DbSession = Depends(get_db)
) -> StagedRowOut:
    row = service.update_row(db, batch_id, row_id, payload.model_dump(exclude_unset=True))
    return row_out(db, row)


@router.post("/imports/{batch_id}/commit", response_model=BatchResultOut)
def commit_import(
    batch_id: int, db: DbSession = Depends(get_db), user: User = Depends(current_user)
) -> BatchResultOut:
    batch, balances = service.commit(db, batch_id, user_id=user.id)
    return BatchResultOut(
        batch=batch_out(batch), balances=[BalanceOut(**b.as_dict()) for b in balances]
    )


@router.post("/imports/{batch_id}/undo", response_model=BatchResultOut)
def undo_import(batch_id: int, db: DbSession = Depends(get_db)) -> BatchResultOut:
    batch, balances = service.undo(db, batch_id)
    return BatchResultOut(
        batch=batch_out(batch), balances=[BalanceOut(**b.as_dict()) for b in balances]
    )


@router.delete("/imports/{batch_id}", status_code=204)
def discard_import(batch_id: int, db: DbSession = Depends(get_db)) -> Response:
    service.discard(db, batch_id)
    return Response(status_code=204)


# --------------------------------------------------------------------------------- rules


@router.get("/rules", response_model=RuleListOut)
def list_rules(db: DbSession = Depends(get_db)) -> RuleListOut:
    return RuleListOut(items=[RuleOut.model_validate(r) for r in rules_service.list_rules(db)])


@router.post("/rules", response_model=RuleOut, status_code=201)
def create_rule(payload: RuleIn, db: DbSession = Depends(get_db)) -> RuleOut:
    return RuleOut.model_validate(rules_service.create_rule(db, payload.model_dump()))


@router.patch("/rules/{rule_id}", response_model=RuleOut)
def update_rule(rule_id: int, payload: RulePatch, db: DbSession = Depends(get_db)) -> RuleOut:
    rule = rules_service.update_rule(db, rule_id, payload.model_dump(exclude_unset=True))
    return RuleOut.model_validate(rule)


@router.delete("/rules/{rule_id}", status_code=204)
def delete_rule(rule_id: int, db: DbSession = Depends(get_db)) -> Response:
    rules_service.delete_rule(db, rule_id)
    return Response(status_code=204)


@router.post("/rules/{rule_id}/move", response_model=RuleListOut)
def move_rule(rule_id: int, payload: MoveIn, db: DbSession = Depends(get_db)) -> RuleListOut:
    rules = rules_service.move_rule(db, rule_id, payload.offset)
    return RuleListOut(items=[RuleOut.model_validate(r) for r in rules])


@router.post("/rules/test", response_model=RuleTestOut)
def test_rule(payload: RuleIn, db: DbSession = Depends(get_db)) -> RuleTestOut:
    checked, hits = rules_service.test_rule(db, payload.model_dump())
    return RuleTestOut(
        checked=checked,
        matches=[
            RuleTestRowOut(
                date=row.date,
                amount_cents=row.amount_cents,
                raw_description=row.raw_description,
                raw_memo=row.raw_memo,
                account_id=row.batch.account_id,
            )
            for row in hits
        ],
    )
