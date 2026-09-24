"""Transactions, splits and transfers.

Invariants enforced here (DATA_MODEL):
  * splits always add up to the transaction amount
  * a normal transaction has exactly one split, a split transaction has several
  * a transfer between two on-budget accounts has no splits
  * an on-budget -> tracking transfer carries its split on the on-budget leg only
"""

import uuid
from dataclasses import dataclass, field
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.errors import AppError
from app.models import STATUSES, Account, Transaction, TransactionSplit
from app.services import accounts as accounts_service
from app.services import balances as balances_service
from app.services import categories as categories_service
from app.services import payees as payees_service
from app.services import references

#: Changing any of these on a reconciled transaction needs confirm=true (SPEC §6),
#: as does deleting it. A memo, payee or category fix does not.
RECONCILED_PROTECTED_FIELDS = frozenset({"amount_cents", "date", "account_id"})


@dataclass(slots=True)
class SplitInput:
    amount_cents: int
    category_id: int | None = None
    memo: str | None = None


@dataclass(slots=True)
class TransactionResult:
    """What a mutation gives back: the rows touched plus the balances they changed."""

    transactions: list[Transaction] = field(default_factory=list)
    balances: list[balances_service.Balances] = field(default_factory=list)
    deleted_ids: list[int] = field(default_factory=list)


def transfer_partner_accounts(db: DbSession, rows: list[Transaction]) -> dict[int, int]:
    """For each transfer leg in `rows`, the account on the other side of it.

    The ledger shows a transfer as "Transfer: Savings", which needs the partner leg's
    account even when only one leg is on the page. One query for the whole page.
    """
    transfer_ids = {row.transfer_id for row in rows if row.transfer_id is not None}
    if not transfer_ids:
        return {}
    legs = db.execute(
        select(Transaction.id, Transaction.transfer_id, Transaction.account_id).where(
            Transaction.transfer_id.in_(transfer_ids)
        )
    ).all()
    by_transfer: dict[str, list[tuple[int, int]]] = {}
    for leg_id, transfer_id, account_id in legs:
        by_transfer.setdefault(transfer_id, []).append((leg_id, account_id))

    partners: dict[int, int] = {}
    for row in rows:
        for leg_id, account_id in by_transfer.get(row.transfer_id or "", []):
            if leg_id != row.id:
                partners[row.id] = account_id
    return partners


def get_transaction(db: DbSession, transaction_id: int) -> Transaction:
    transaction = db.get(Transaction, transaction_id)
    if transaction is None:
        raise AppError(404, "Transaction not found", "transaction_not_found")
    return transaction


def _validate_status(status: str) -> None:
    if status not in STATUSES:
        raise AppError(422, f"Unknown status: {status}", "invalid_status")


def _validate_splits(amount_cents: int, splits: list[SplitInput]) -> None:
    if not splits:
        raise AppError(422, "A transaction needs at least one split.", "splits_required")

    total = sum(split.amount_cents for split in splits)
    if total != amount_cents:
        raise AppError(
            422,
            f"Splits add up to {total} cents but the transaction is {amount_cents}.",
            "split_sum_mismatch",
        )
    if any(split.amount_cents == 0 for split in splits):
        raise AppError(422, "A split cannot be zero.", "zero_split")


def _write_splits(db: DbSession, transaction: Transaction, splits: list[SplitInput]) -> None:
    for split in splits:
        if split.category_id is not None:
            categories_service.get_category(db, split.category_id)

    transaction.splits.clear()
    db.flush()
    for order, split in enumerate(splits):
        transaction.splits.append(
            TransactionSplit(
                category_id=split.category_id,
                amount_cents=split.amount_cents,
                memo=split.memo,
                sort_order=order,
            )
        )


def _guard_reconciled(transaction: Transaction, changes: dict, confirm: bool) -> None:
    if transaction.status != "reconciled" or confirm:
        return
    touched = RECONCILED_PROTECTED_FIELDS & {
        key for key, value in changes.items() if getattr(transaction, key, None) != value
    }
    if touched:
        raise AppError(
            409,
            f"This transaction is reconciled. Changing its {', '.join(sorted(touched))} "
            "needs confirmation.",
            "reconciled_edit_requires_confirm",
        )


def create_transaction(
    db: DbSession,
    *,
    account_id: int,
    on: date,
    amount_cents: int,
    splits: list[SplitInput] | None = None,
    payee_id: int | None = None,
    memo: str | None = None,
    status: str = "uncleared",
    check_number: str | None = None,
    user_id: int | None = None,
) -> TransactionResult:
    accounts_service.get_account(db, account_id)
    _validate_status(status)
    if payee_id is not None:
        payees_service.get_payee(db, payee_id)

    # No splits given means one split for the whole amount, uncategorized.
    split_inputs = splits if splits else [SplitInput(amount_cents=amount_cents)]
    _validate_splits(amount_cents, split_inputs)

    transaction = Transaction(
        account_id=account_id,
        date=on,
        payee_id=payee_id,
        memo=memo,
        amount_cents=amount_cents,
        status=status,
        check_number=check_number,
        created_by=user_id,
        updated_by=user_id,
    )
    db.add(transaction)
    db.flush()
    _write_splits(db, transaction, split_inputs)
    db.commit()
    db.refresh(transaction)

    return TransactionResult(
        transactions=[transaction],
        balances=balances_service.balances_for_ids(db, [account_id]),
    )


def update_transaction(
    db: DbSession,
    transaction_id: int,
    changes: dict,
    *,
    splits: list[SplitInput] | None = None,
    confirm: bool = False,
    user_id: int | None = None,
) -> TransactionResult:
    transaction = get_transaction(db, transaction_id)
    _guard_reconciled(transaction, changes, confirm)

    if transaction.is_transfer:
        return _update_transfer(db, transaction, changes, confirm=confirm, user_id=user_id)

    if "status" in changes:
        _validate_status(changes["status"])
    if changes.get("account_id") is not None:
        accounts_service.get_account(db, changes["account_id"])
    if changes.get("payee_id") is not None:
        payees_service.get_payee(db, changes["payee_id"])

    touched_accounts = {transaction.account_id}
    for key, value in changes.items():
        setattr(transaction, key, value)
    touched_accounts.add(transaction.account_id)
    transaction.updated_by = user_id

    split_inputs = splits if splits is not None else _splits_of(transaction)
    if splits is None and "amount_cents" in changes and len(split_inputs) == 1:
        # A single-split transaction follows its amount without being asked.
        split_inputs = [
            SplitInput(amount_cents=transaction.amount_cents, **_split_extras(transaction))
        ]
    _validate_splits(transaction.amount_cents, split_inputs)
    _write_splits(db, transaction, split_inputs)

    db.commit()
    db.refresh(transaction)
    return TransactionResult(
        transactions=[transaction],
        balances=balances_service.balances_for_ids(db, list(touched_accounts)),
    )


def _splits_of(transaction: Transaction) -> list[SplitInput]:
    return [
        SplitInput(amount_cents=s.amount_cents, category_id=s.category_id, memo=s.memo)
        for s in transaction.splits
    ]


def _split_extras(transaction: Transaction) -> dict:
    existing = transaction.splits[0] if transaction.splits else None
    return {
        "category_id": existing.category_id if existing else None,
        "memo": existing.memo if existing else None,
    }


def delete_transaction(
    db: DbSession, transaction_id: int, *, confirm: bool = False
) -> TransactionResult:
    transaction = get_transaction(db, transaction_id)
    if transaction.status == "reconciled" and not confirm:
        raise AppError(
            409,
            "This transaction is reconciled. Deleting it needs confirmation.",
            "reconciled_edit_requires_confirm",
        )

    if transaction.is_transfer:
        return _delete_transfer(db, transaction)

    account_id = transaction.account_id
    references.transactions_deleting(db, [transaction.id])
    db.delete(transaction)
    db.commit()
    return TransactionResult(
        deleted_ids=[transaction_id],
        balances=balances_service.balances_for_ids(db, [account_id]),
    )


# --------------------------------------------------------------------------- transfers


def _legs_of(db: DbSession, transfer_id: str) -> list[Transaction]:
    return list(
        db.scalars(
            select(Transaction)
            .where(Transaction.transfer_id == transfer_id)
            .order_by(Transaction.amount_cents)
        )
    )


def _transfer_split_rule(
    db: DbSession, source: Account, destination: Account, category_id: int | None
) -> tuple[bool, bool]:
    """Which legs need a split (SPEC §6).

    Between two on-budget accounts a transfer is not spending, so neither leg carries a
    split. Moving money from an on-budget account to a tracking one — a car loan payment,
    say — is spending, so the on-budget leg needs a category.
    """
    if source.on_budget and destination.on_budget:
        if category_id is not None:
            raise AppError(
                422,
                "A transfer between two on-budget accounts is not spending, so it has no category.",
                "transfer_category_not_allowed",
            )
        return False, False

    if source.on_budget and not destination.on_budget:
        if category_id is None:
            raise AppError(
                422,
                "Moving money to a tracking account counts against the budget, so it needs a "
                "category.",
                "transfer_category_required",
            )
        return True, False

    if not source.on_budget and destination.on_budget:
        if category_id is None:
            raise AppError(
                422,
                "Moving money from a tracking account into the budget needs a category.",
                "transfer_category_required",
            )
        return False, True

    # Neither account is on budget: nothing here touches the budget.
    if category_id is not None:
        raise AppError(
            422,
            "A transfer between two tracking accounts does not touch the budget, so it has no "
            "category.",
            "transfer_category_not_allowed",
        )
    return False, False


def create_transfer(
    db: DbSession,
    *,
    from_account_id: int,
    to_account_id: int,
    on: date,
    amount_cents: int,
    category_id: int | None = None,
    memo: str | None = None,
    status: str = "uncleared",
    user_id: int | None = None,
) -> TransactionResult:
    """One call, two linked legs (SPEC §6). `amount_cents` is the positive amount moved."""
    if from_account_id == to_account_id:
        raise AppError(422, "A transfer needs two different accounts.", "same_account")
    if amount_cents <= 0:
        raise AppError(422, "A transfer amount must be positive.", "invalid_transfer_amount")
    _validate_status(status)

    source = accounts_service.get_account(db, from_account_id)
    destination = accounts_service.get_account(db, to_account_id)
    source_split, destination_split = _transfer_split_rule(db, source, destination, category_id)

    transfer_id = str(uuid.uuid4())
    out_leg = Transaction(
        account_id=source.id,
        date=on,
        amount_cents=-amount_cents,
        memo=memo,
        status=status,
        transfer_id=transfer_id,
        created_by=user_id,
        updated_by=user_id,
    )
    in_leg = Transaction(
        account_id=destination.id,
        date=on,
        amount_cents=amount_cents,
        memo=memo,
        status=status,
        transfer_id=transfer_id,
        created_by=user_id,
        updated_by=user_id,
    )
    db.add_all([out_leg, in_leg])
    db.flush()

    if source_split:
        _write_splits(db, out_leg, [SplitInput(-amount_cents, category_id=category_id)])
    if destination_split:
        _write_splits(db, in_leg, [SplitInput(amount_cents, category_id=category_id)])

    db.commit()
    db.refresh(out_leg)
    db.refresh(in_leg)
    return TransactionResult(
        transactions=[out_leg, in_leg],
        balances=balances_service.balances_for_ids(db, [source.id, destination.id]),
    )


def _update_transfer(
    db: DbSession,
    leg: Transaction,
    changes: dict,
    *,
    confirm: bool,
    user_id: int | None,
) -> TransactionResult:
    """Editing one leg keeps its partner in step (SPEC §6)."""
    legs = _legs_of(db, leg.transfer_id or "")
    partner = next((other for other in legs if other.id != leg.id), None)
    if partner is None:
        raise AppError(409, "This transfer is missing its other half.", "broken_transfer")

    if "payee_id" in changes and changes["payee_id"] is not None:
        raise AppError(422, "Transfers do not have a payee.", "transfer_has_no_payee")
    if "status" in changes:
        _validate_status(changes["status"])

    touched = {leg.account_id, partner.account_id}

    if "amount_cents" in changes:
        amount = changes["amount_cents"]
        leg.amount_cents = amount
        partner.amount_cents = -amount
        for row in (leg, partner):
            if row.splits:
                row.splits[0].amount_cents = row.amount_cents
    if "date" in changes:
        leg.date = partner.date = changes["date"]
    if "memo" in changes:
        leg.memo = partner.memo = changes["memo"]
    if "status" in changes:
        leg.status = partner.status = changes["status"]
    if changes.get("account_id") is not None:
        accounts_service.get_account(db, changes["account_id"])
        leg.account_id = changes["account_id"]
        touched.add(leg.account_id)

    leg.updated_by = partner.updated_by = user_id
    db.commit()
    db.refresh(leg)
    db.refresh(partner)
    return TransactionResult(
        transactions=[leg, partner],
        balances=balances_service.balances_for_ids(db, list(touched)),
    )


def _delete_transfer(db: DbSession, leg: Transaction) -> TransactionResult:
    """Deleting either leg deletes both (SPEC §6)."""
    legs = _legs_of(db, leg.transfer_id or "")
    deleted = [row.id for row in legs]
    touched = [row.account_id for row in legs]
    references.transactions_deleting(db, deleted)
    for row in legs:
        db.delete(row)
    db.commit()
    return TransactionResult(
        deleted_ids=deleted,
        balances=balances_service.balances_for_ids(db, touched),
    )
