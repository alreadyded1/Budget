"""Registers transactions with the reassignment registry from Phase 3 (D-031, D-032).

Merging a payee moves its transactions across. Deleting a category moves its splits.
Payee usage stats become real queries. Subscriptions (Phase 8) and rules (Phase 10)
register themselves the same way.
"""

from datetime import date

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session as DbSession

from app.models import Transaction, TransactionSplit
from app.services import payees as payees_service
from app.services import references


def move_payee_transactions(db: DbSession, source_id: int, target_id: int) -> int:
    result = db.execute(
        update(Transaction)
        .where(Transaction.payee_id == source_id)
        .values(payee_id=target_id)
        .execution_options(synchronize_session=False)
    )
    db.flush()
    return int(result.rowcount or 0)


def move_category_splits(db: DbSession, source_id: int, target_id: int) -> int:
    result = db.execute(
        update(TransactionSplit)
        .where(TransactionSplit.category_id == source_id)
        .values(category_id=target_id)
        .execution_options(synchronize_session=False)
    )
    db.flush()
    return int(result.rowcount or 0)


def count_category_splits(db: DbSession, category_id: int) -> int:
    return int(
        db.scalar(
            select(func.count())
            .select_from(TransactionSplit)
            .where(TransactionSplit.category_id == category_id)
        )
        or 0
    )


def payee_usage(db: DbSession, payee_id: int) -> payees_service.PayeeUsage:
    """Transaction count, last used date, and total spent, all from the ledger."""
    row = db.execute(
        select(
            func.count(Transaction.id),
            func.max(Transaction.date),
            func.coalesce(func.sum(Transaction.amount_cents), 0),
        ).where(Transaction.payee_id == payee_id)
    ).one()

    count, last_used, total = row
    if isinstance(last_used, str):  # SQLite hands dates back as text through func.max
        last_used = date.fromisoformat(last_used)

    latest = db.scalars(
        select(Transaction)
        .where(Transaction.payee_id == payee_id)
        .order_by(Transaction.date.desc(), Transaction.id.desc())
        .limit(1)
    ).first()
    # A split transaction has no single category to repeat, so it autofills none.
    last_category = latest.splits[0].category_id if latest and len(latest.splits) == 1 else None

    return payees_service.PayeeUsage(
        transaction_count=int(count or 0),
        last_used=last_used,
        # Spending is negative in the ledger; the stat reads better as a positive total.
        total_spent_cents=abs(int(total or 0)),
        last_category_id=last_category,
        last_amount_cents=latest.amount_cents if latest else None,
    )


def register() -> None:
    references.register_payee_reassigner("transactions", move_payee_transactions)
    references.register_category_reassigner("transaction_splits", move_category_splits)
    references.register_category_counter("transaction_splits", count_category_splits)
    payees_service.set_usage_provider(payee_usage)
