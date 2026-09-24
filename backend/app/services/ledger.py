"""The ledger query: filters, cursor pagination, running balance, and bulk operations."""

import base64
import json
from dataclasses import dataclass
from datetime import date

from sqlalchemy import Select, func, or_, select
from sqlalchemy.orm import Session as DbSession
from sqlalchemy.orm import selectinload

from app.errors import AppError
from app.models import Account, Payee, Transaction, TransactionSplit
from app.services import balances as balances_service
from app.services import transactions as transactions_service

DEFAULT_LIMIT = 100
MAX_LIMIT = 500


@dataclass(frozen=True, slots=True)
class LedgerFilters:
    account_id: int | None = None
    start: date | None = None
    end: date | None = None
    payee_id: int | None = None
    category_id: int | None = None
    status: str | None = None
    min_cents: int | None = None
    max_cents: int | None = None
    text: str | None = None
    uncategorized: bool = False
    #: Only accounts on (True) or off (False) the budget; None for both.
    on_budget: bool | None = None


@dataclass(slots=True)
class LedgerRow:
    transaction: Transaction
    #: Only meaningful for a single account in date order; None otherwise.
    running_balance_cents: int | None = None


@dataclass(slots=True)
class LedgerPage:
    rows: list[LedgerRow]
    next_cursor: str | None
    total_cents: int


def encode_cursor(row: Transaction) -> str:
    raw = json.dumps({"d": row.date.isoformat(), "i": row.id})
    return base64.urlsafe_b64encode(raw.encode()).decode()


def decode_cursor(cursor: str) -> tuple[date, int]:
    try:
        payload = json.loads(base64.urlsafe_b64decode(cursor.encode()).decode())
        return date.fromisoformat(payload["d"]), int(payload["i"])
    except Exception as exc:
        raise AppError(422, "That page cursor is not valid.", "invalid_cursor") from exc


def _apply_filters(query: Select, filters: LedgerFilters) -> Select:
    if filters.account_id is not None:
        query = query.where(Transaction.account_id == filters.account_id)
    if filters.start is not None:
        query = query.where(Transaction.date >= filters.start)
    if filters.end is not None:
        query = query.where(Transaction.date <= filters.end)
    if filters.payee_id is not None:
        query = query.where(Transaction.payee_id == filters.payee_id)
    if filters.status is not None:
        query = query.where(Transaction.status == filters.status)
    if filters.min_cents is not None:
        query = query.where(Transaction.amount_cents >= filters.min_cents)
    if filters.max_cents is not None:
        query = query.where(Transaction.amount_cents <= filters.max_cents)

    if filters.category_id is not None:
        query = query.where(
            Transaction.id.in_(
                select(TransactionSplit.transaction_id).where(
                    TransactionSplit.category_id == filters.category_id
                )
            )
        )
    if filters.uncategorized:
        # Used by the budget alerts in Phase 6.
        query = query.where(
            Transaction.id.in_(
                select(TransactionSplit.transaction_id).where(
                    TransactionSplit.category_id.is_(None)
                )
            )
        )
    if filters.on_budget is not None:
        query = query.where(
            Transaction.account_id.in_(
                select(Account.id).where(Account.on_budget.is_(filters.on_budget))
            )
        )
    if filters.text:
        needle = f"%{filters.text.strip()}%"
        query = query.where(
            or_(
                Transaction.memo.ilike(needle),
                Transaction.check_number.ilike(needle),
                Transaction.payee_id.in_(select(Payee.id).where(Payee.name.ilike(needle))),
                Transaction.id.in_(
                    select(TransactionSplit.transaction_id).where(
                        TransactionSplit.memo.ilike(needle)
                    )
                ),
            )
        )
    return query


def query(
    db: DbSession,
    filters: LedgerFilters,
    *,
    cursor: str | None = None,
    limit: int = DEFAULT_LIMIT,
) -> LedgerPage:
    """Newest first, paged on (date, id) so new rows never shuffle the page boundary."""
    limit = max(1, min(limit, MAX_LIMIT))

    rows_query = _apply_filters(select(Transaction), filters).options(
        selectinload(Transaction.splits)
    )
    if cursor is not None:
        cursor_date, cursor_id = decode_cursor(cursor)
        rows_query = rows_query.where(
            or_(
                Transaction.date < cursor_date,
                (Transaction.date == cursor_date) & (Transaction.id < cursor_id),
            )
        )

    rows_query = rows_query.order_by(Transaction.date.desc(), Transaction.id.desc()).limit(
        limit + 1
    )
    found = list(db.scalars(rows_query))

    has_more = len(found) > limit
    page = found[:limit]
    next_cursor = encode_cursor(page[-1]) if has_more and page else None

    total = int(
        db.scalar(
            _apply_filters(select(func.coalesce(func.sum(Transaction.amount_cents), 0)), filters)
        )
        or 0
    )

    return LedgerPage(
        rows=_with_running_balance(db, page, filters),
        next_cursor=next_cursor,
        total_cents=total,
    )


def _with_running_balance(
    db: DbSession, page: list[Transaction], filters: LedgerFilters
) -> list[LedgerRow]:
    """A running balance only means something for one account read in date order.

    Every other view (all accounts, or a filtered subset) gets None rather than a number
    that looks authoritative and is not.
    """
    if filters.account_id is None or not page:
        return [LedgerRow(transaction=row) for row in page]

    account = db.get(Account, filters.account_id)
    if account is None or account.valuation_mode == "manual":
        return [LedgerRow(transaction=row) for row in page]

    # Everything below the oldest row on this page, regardless of the other filters.
    oldest = page[-1]
    earlier = int(
        db.scalar(
            select(func.coalesce(func.sum(Transaction.amount_cents), 0)).where(
                Transaction.account_id == account.id,
                or_(
                    Transaction.date < oldest.date,
                    (Transaction.date == oldest.date) & (Transaction.id < oldest.id),
                ),
            )
        )
        or 0
    )

    running = account.opening_balance_cents + earlier
    balances_by_id: dict[int, int] = {}
    for row in reversed(page):
        running += row.amount_cents
        balances_by_id[row.id] = running

    return [
        LedgerRow(transaction=row, running_balance_cents=balances_by_id[row.id]) for row in page
    ]


def uncategorized_count(db: DbSession, start: date | None = None, end: date | None = None) -> int:
    """How many transactions still have an uncategorized split (used by Phase 6 alerts)."""
    query = select(func.count(func.distinct(TransactionSplit.transaction_id))).where(
        TransactionSplit.category_id.is_(None)
    )
    if start is not None or end is not None:
        query = query.join(Transaction, Transaction.id == TransactionSplit.transaction_id)
        if start is not None:
            query = query.where(Transaction.date >= start)
        if end is not None:
            query = query.where(Transaction.date <= end)
    return int(db.scalar(query) or 0)


# ------------------------------------------------------------------------ bulk actions


def _load(db: DbSession, ids: list[int]) -> list[Transaction]:
    if not ids:
        raise AppError(422, "No transactions were selected.", "nothing_selected")
    found = list(db.scalars(select(Transaction).where(Transaction.id.in_(ids))))
    missing = set(ids) - {row.id for row in found}
    if missing:
        raise AppError(404, f"Unknown transactions: {sorted(missing)}", "transaction_not_found")
    return found


def bulk_set_status(
    db: DbSession, ids: list[int], status: str, *, confirm: bool = False
) -> transactions_service.TransactionResult:
    rows = _load(db, ids)
    touched = set()
    for row in rows:
        row.status = status
        touched.add(row.account_id)
    db.commit()
    return transactions_service.TransactionResult(
        transactions=rows, balances=balances_service.balances_for_ids(db, list(touched))
    )


def bulk_set_category(
    db: DbSession, ids: list[int], category_id: int | None
) -> transactions_service.TransactionResult:
    """Set one category on each selected transaction, collapsing any splits it had."""
    rows = _load(db, ids)
    touched = set()
    for row in rows:
        if row.is_transfer and not row.splits:
            raise AppError(
                422,
                "A transfer between on-budget accounts cannot be categorized.",
                "transfer_category_not_allowed",
            )
        transactions_service._write_splits(
            db,
            row,
            [transactions_service.SplitInput(row.amount_cents, category_id=category_id)],
        )
        touched.add(row.account_id)
    db.commit()
    return transactions_service.TransactionResult(
        transactions=rows, balances=balances_service.balances_for_ids(db, list(touched))
    )


def bulk_delete(
    db: DbSession, ids: list[int], *, confirm: bool = False
) -> transactions_service.TransactionResult:
    rows = _load(db, ids)
    if not confirm and any(row.status == "reconciled" for row in rows):
        raise AppError(
            409,
            "Some of these are reconciled. Deleting them needs confirmation.",
            "reconciled_edit_requires_confirm",
        )

    deleted: list[int] = []
    touched: set[int] = set()
    seen_transfers: set[str] = set()
    for row in rows:
        if row.is_transfer and row.transfer_id not in seen_transfers:
            seen_transfers.add(row.transfer_id or "")
            result = transactions_service._delete_transfer(db, row)
            deleted.extend(result.deleted_ids)
            touched.update(balance.account_id for balance in result.balances)
        elif not row.is_transfer:
            touched.add(row.account_id)
            deleted.append(row.id)
            db.delete(row)
    db.commit()
    return transactions_service.TransactionResult(
        deleted_ids=deleted, balances=balances_service.balances_for_ids(db, list(touched))
    )
