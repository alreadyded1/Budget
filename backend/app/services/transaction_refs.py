"""Registers transactions with the reassignment registry from Phase 3 (D-031, D-032).

Merging a payee moves its transactions across. Deleting a category moves its splits.
Payee usage stats become real queries. Subscriptions (Phase 8) and rules (Phase 10)
register themselves the same way.
"""

from datetime import date

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session as DbSession

from app.models import Payee, Transaction, TransactionSplit
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


def payee_usage(db: DbSession, payee_ids: list[int]) -> dict[int, payees_service.PayeeUsage]:
    """Transaction count, last used date, total spent and the newest entry, per payee.

    A handful of queries whatever the number of payees (D-111): grouped totals, the newest
    transaction per payee, and those transactions' amounts and split counts.
    """
    wanted = sorted(set(payee_ids))
    totals: dict[int, tuple[int, date | None, int]] = {}
    # A long id list costs more than one pass over the covering index (and SQLite caps
    # bound parameters), so past a few dozen payees read them all.
    few = len(wanted) <= 50
    by_id = Transaction.payee_id.in_(wanted) if few else Transaction.payee_id.isnot(None)

    for payee_id, count, last_used, total in db.execute(
        select(
            Transaction.payee_id,
            func.count(),
            func.max(Transaction.date),
            func.coalesce(func.sum(Transaction.amount_cents), 0),
        )
        .where(by_id)
        .group_by(Transaction.payee_id)
    ):
        if isinstance(last_used, str):  # SQLite hands dates back as text through func.max
            last_used = date.fromisoformat(last_used)
        totals[payee_id] = (int(count), last_used, int(total))

    # The newest transaction per payee: one index seek each (ix_transactions_payee_date).
    newest_id = (
        select(Transaction.id)
        .where(Transaction.payee_id == Payee.id)
        .order_by(Transaction.date.desc(), Transaction.id.desc())
        .limit(1)
        .correlate(Payee)
        .scalar_subquery()
    )
    payee_filter = Payee.id.in_(wanted) if few else Payee.id.isnot(None)
    latest = {
        payee_id: tx_id
        for payee_id, tx_id in db.execute(select(Payee.id, newest_id).where(payee_filter))
        if tx_id is not None
    }

    latest_ids = sorted(latest.values())
    amounts: dict[int, int] = {}
    single_category: dict[int, int | None] = {}
    for chunk in range(0, len(latest_ids), 500):
        ids = latest_ids[chunk : chunk + 500]
        amounts.update(
            db.execute(
                select(Transaction.id, Transaction.amount_cents).where(Transaction.id.in_(ids))
            ).all()
        )
        for tx_id, count, category_id in db.execute(
            select(
                TransactionSplit.transaction_id,
                func.count(),
                func.max(TransactionSplit.category_id),
            )
            .where(TransactionSplit.transaction_id.in_(ids))
            .group_by(TransactionSplit.transaction_id)
        ):
            # A split transaction has no single category to repeat, so it autofills none.
            single_category[tx_id] = category_id if count == 1 else None
    newest = {payee_id: (tx_id, amounts[tx_id]) for payee_id, tx_id in latest.items()}

    out: dict[int, payees_service.PayeeUsage] = {}
    for payee_id in wanted:
        count, last_used, total = totals.get(payee_id, (0, None, 0))
        latest = newest.get(payee_id)
        out[payee_id] = payees_service.PayeeUsage(
            transaction_count=count,
            last_used=last_used,
            # Spending is negative in the ledger; the stat reads better as a positive total.
            total_spent_cents=abs(total),
            last_category_id=single_category.get(latest[0]) if latest else None,
            last_amount_cents=latest[1] if latest else None,
        )
    return out


def register() -> None:
    references.register_payee_reassigner("transactions", move_payee_transactions)
    references.register_category_reassigner("transaction_splits", move_category_splits)
    references.register_category_counter("transaction_splits", count_category_splits)
    payees_service.set_usage_provider(payee_usage)
