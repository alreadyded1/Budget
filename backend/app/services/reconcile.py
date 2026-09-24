"""Reconciliation (SPEC §12): balance an account to a bank statement and lock what matched.

Ticking a row on the reconcile screen is the ordinary status change to cleared (D-079), so
there is no draft state here: the worksheet is always "the cleared rows up to the statement
date". Finishing turns exactly those rows reconciled and records the statement.
"""

from dataclasses import dataclass
from datetime import date

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session as DbSession

from app.domain import reconcile as math
from app.errors import AppError
from app.models import Account, Payee, Reconciliation, Transaction, utcnow
from app.services import accounts as accounts_service
from app.services import balances as balances_service
from app.services import categories as categories_service
from app.services import references
from app.services import transactions as transactions_service

#: The payee every adjustment is filed under (D-081).
ADJUSTMENT_PAYEE = "Reconciliation adjustment"


@dataclass(slots=True)
class Worksheet:
    account: Account
    statement_date: date
    reconciled_cents: int
    rows: list[Transaction]
    last: Reconciliation | None

    @property
    def ticked_cents(self) -> int:
        return sum(row.amount_cents for row in self.rows if row.status == "cleared")


def _account(db: DbSession, account_id: int) -> Account:
    account = accounts_service.get_account(db, account_id)
    if account.valuation_mode == "manual":
        raise AppError(
            422,
            "This account's balance is typed in, so there is nothing to reconcile.",
            "reconcile_manual_account",
        )
    return account


def latest(db: DbSession, account_id: int) -> Reconciliation | None:
    return db.scalars(
        select(Reconciliation)
        .where(Reconciliation.account_id == account_id)
        .order_by(Reconciliation.statement_date.desc(), Reconciliation.id.desc())
    ).first()


def _check_date(account: Account, last: Reconciliation | None, statement_date: date) -> None:
    if statement_date < account.opening_date:
        raise AppError(
            422, "The statement date is before the account was opened.", "statement_date_invalid"
        )
    if last is not None and statement_date < last.statement_date:
        raise AppError(
            422,
            f"This account was already reconciled to {last.statement_date.isoformat()}. "
            "Pick that date or a later one.",
            "statement_date_invalid",
        )


def worksheet(db: DbSession, account_id: int, statement_date: date) -> Worksheet:
    """The reconcile screen: open rows up to the statement date and the reconciled balance."""
    account = _account(db, account_id)
    last = latest(db, account_id)
    _check_date(account, last, statement_date)
    rows = db.scalars(
        select(Transaction)
        .where(
            Transaction.account_id == account_id,
            Transaction.status.in_(("uncleared", "cleared")),
            Transaction.date <= statement_date,
        )
        .order_by(Transaction.date, Transaction.id)
    ).all()
    reconciled = balances_service.balances_for(db, account).reconciled_cents
    return Worksheet(account, statement_date, reconciled, list(rows), last)


def _adjustment_payee(db: DbSession) -> Payee:
    payee = db.scalars(
        select(Payee).where(func.lower(Payee.name) == ADJUSTMENT_PAYEE.lower())
    ).first()
    if payee is None:
        payee = Payee(name=ADJUSTMENT_PAYEE)
        db.add(payee)
        db.flush()
    return payee


def finish(
    db: DbSession,
    account_id: int,
    *,
    statement_date: date,
    statement_balance_cents: int,
    adjust: bool = False,
    adjustment_category_id: int | None = None,
    user_id: int | None = None,
) -> tuple[Reconciliation, list[balances_service.Balances]]:
    """Lock the cleared rows up to the statement date, once they balance (SPEC §12).

    `statement_balance_cents` is in the account's sign (a card owing $50 is -5000). With a
    difference left, finishing is refused unless `adjust` asks for an adjustment transaction.
    """
    sheet = worksheet(db, account_id, statement_date)
    ticked = [row for row in sheet.rows if row.status == "cleared"]
    gap = math.difference(
        statement_balance_cents, sheet.reconciled_cents, (row.amount_cents for row in ticked)
    )
    if gap != 0 and not adjust:
        raise AppError(
            409,
            "The ticked transactions do not match the statement yet "
            f"(off by {gap / 100:+,.2f}). Tick or fix rows, or finish with an adjustment.",
            "reconcile_not_balanced",
        )
    if adjustment_category_id is not None:
        categories_service.get_category(db, adjustment_category_id)

    record = Reconciliation(
        account_id=account_id,
        statement_date=statement_date,
        statement_balance_cents=statement_balance_cents,
        completed_by=user_id,
        completed_at=utcnow(),
    )
    db.add(record)
    db.flush()

    if gap != 0:
        adjustment = Transaction(
            account_id=account_id,
            date=statement_date,
            payee_id=_adjustment_payee(db).id,
            memo=f"Statement of {statement_date.isoformat()}",
            amount_cents=gap,
            status="reconciled",
            reconciliation_id=record.id,
            created_by=user_id,
            updated_by=user_id,
        )
        db.add(adjustment)
        db.flush()
        transactions_service._write_splits(
            db,
            adjustment,
            [transactions_service.SplitInput(gap, category_id=adjustment_category_id)],
        )
        record.adjustment_transaction_id = adjustment.id

    for row in ticked:
        row.status = "reconciled"
        row.reconciliation_id = record.id
        row.updated_by = user_id
    db.commit()
    db.refresh(record)
    return record, balances_service.balances_for_ids(db, [account_id])


def history(db: DbSession, account_id: int) -> list[Reconciliation]:
    accounts_service.get_account(db, account_id)
    return list(
        db.scalars(
            select(Reconciliation)
            .where(Reconciliation.account_id == account_id)
            .order_by(Reconciliation.statement_date.desc(), Reconciliation.id.desc())
        )
    )


def counts(db: DbSession, reconciliation_ids: list[int]) -> dict[int, int]:
    """How many transactions each reconciliation still locks."""
    if not reconciliation_ids:
        return {}
    rows = db.execute(
        select(Transaction.reconciliation_id, func.count())
        .where(Transaction.reconciliation_id.in_(reconciliation_ids))
        .group_by(Transaction.reconciliation_id)
    ).all()
    return {int(key): int(value) for key, value in rows}


def adjustment_amounts(db: DbSession, records: list[Reconciliation]) -> dict[int, int]:
    ids = [r.adjustment_transaction_id for r in records if r.adjustment_transaction_id]
    if not ids:
        return {}
    amounts = dict(
        db.execute(
            select(Transaction.id, Transaction.amount_cents).where(Transaction.id.in_(ids))
        ).all()
    )
    return {
        r.id: amounts[r.adjustment_transaction_id]
        for r in records
        if r.adjustment_transaction_id in amounts
    }


def undo(
    db: DbSession, reconciliation_id: int
) -> tuple[Reconciliation, list[balances_service.Balances]]:
    """Undo the latest reconciliation of an account (D-082): rows go back to cleared."""
    record = db.get(Reconciliation, reconciliation_id)
    if record is None:
        raise AppError(404, "Reconciliation not found", "reconciliation_not_found")
    newest = latest(db, record.account_id)
    if newest is None or newest.id != record.id:
        raise AppError(
            409,
            "Only the most recent reconciliation of an account can be undone.",
            "reconcile_not_latest",
        )

    # What the caller shows after the row is gone.
    snapshot = Reconciliation(
        **{column.name: getattr(record, column.name) for column in Reconciliation.__table__.columns}
    )
    adjustment_id = record.adjustment_transaction_id
    if adjustment_id is not None and db.get(Transaction, adjustment_id) is not None:
        references.transactions_deleting(db, [adjustment_id])
        db.delete(db.get(Transaction, adjustment_id))
        db.flush()
    db.execute(
        update(Transaction)
        .where(Transaction.reconciliation_id == record.id)
        .values(status="cleared", reconciliation_id=None)
        .execution_options(synchronize_session=False)
    )
    db.delete(record)
    db.commit()
    db.expire_all()
    return snapshot, balances_service.balances_for_ids(db, [snapshot.account_id])


# ---------------------------------------------------------------------- reference moves


def forget_adjustments(db: DbSession, transaction_ids: list[int]) -> int:
    """An adjustment transaction deleted from the ledger leaves its reconciliation behind."""
    result = db.execute(
        update(Reconciliation)
        .where(Reconciliation.adjustment_transaction_id.in_(transaction_ids))
        .values(adjustment_transaction_id=None)
        .execution_options(synchronize_session=False)
    )
    return int(result.rowcount or 0)


def register() -> None:
    references.register_transaction_delete_listener("reconciliations", forget_adjustments)
