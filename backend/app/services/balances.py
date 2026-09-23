"""Account balances.

A balance is the opening balance plus the transactions that count toward it. Liability
accounts hold negative balances (money owed), which falls out of the sign convention
rather than being special-cased: a credit card purchase is an outflow.

Manual-valuation accounts are the exception. Their typed balance is the truth, so the
latest valuation on or before the date wins and transactions do not move it.
"""

from dataclasses import dataclass
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

from app.models import Account, AccountValuation, Transaction

CLEARED_STATUSES = ("cleared", "reconciled")


@dataclass(frozen=True, slots=True)
class Balances:
    """Every balance the ledger shows for one account, in cents."""

    account_id: int
    current_cents: int
    cleared_cents: int
    reconciled_cents: int

    def as_dict(self) -> dict:
        return {
            "account_id": self.account_id,
            "current_cents": self.current_cents,
            "cleared_cents": self.cleared_cents,
            "reconciled_cents": self.reconciled_cents,
        }


def _sum_transactions(
    db: DbSession,
    account_id: int,
    *,
    statuses: tuple[str, ...] | None = None,
    through: date | None = None,
) -> int:
    query = select(func.coalesce(func.sum(Transaction.amount_cents), 0)).where(
        Transaction.account_id == account_id
    )
    if statuses is not None:
        query = query.where(Transaction.status.in_(statuses))
    if through is not None:
        query = query.where(Transaction.date <= through)
    return int(db.scalar(query) or 0)


def latest_valuation(
    db: DbSession, account_id: int, through: date | None = None
) -> AccountValuation | None:
    query = (
        select(AccountValuation)
        .where(AccountValuation.account_id == account_id)
        .order_by(AccountValuation.date.desc())
    )
    if through is not None:
        query = query.where(AccountValuation.date <= through)
    return db.scalars(query).first()


def balance_as_of(db: DbSession, account: Account, on: date) -> int:
    """What the account was worth on a date, inclusive."""
    if account.valuation_mode == "manual":
        valuation = latest_valuation(db, account.id, through=on)
        if valuation is not None:
            return valuation.balance_cents
        return account.opening_balance_cents if account.opening_date <= on else 0

    if account.opening_date > on:
        return 0
    return account.opening_balance_cents + _sum_transactions(db, account.id, through=on)


def balances_for(db: DbSession, account: Account) -> Balances:
    if account.valuation_mode == "manual":
        valuation = latest_valuation(db, account.id)
        value = valuation.balance_cents if valuation else account.opening_balance_cents
        # A typed balance is already the whole truth, so nothing is outstanding.
        return Balances(account.id, value, value, value)

    opening = account.opening_balance_cents
    return Balances(
        account_id=account.id,
        current_cents=opening + _sum_transactions(db, account.id),
        cleared_cents=opening + _sum_transactions(db, account.id, statuses=CLEARED_STATUSES),
        reconciled_cents=opening + _sum_transactions(db, account.id, statuses=("reconciled",)),
    )


def balances_for_ids(db: DbSession, account_ids: list[int]) -> list[Balances]:
    """The balances a mutation response carries, so the UI never has to refetch."""
    if not account_ids:
        return []
    accounts = db.scalars(select(Account).where(Account.id.in_(set(account_ids)))).all()
    return [balances_for(db, account) for account in accounts]
