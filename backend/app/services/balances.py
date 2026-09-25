"""Account balances.

A balance is the opening balance plus the transactions that count toward it. Liability
accounts hold negative balances (money owed), which falls out of the sign convention
rather than being special-cased: a credit card purchase is an outflow.

Manual-valuation accounts are the exception. Their typed balance is the truth, so the
latest valuation on or before the date wins and transactions do not move it.
"""

from collections import defaultdict
from dataclasses import dataclass
from datetime import date

from sqlalchemy import case, func, select
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
    return balances_for_many(db, [account])[account.id]


def balances_for_many(db: DbSession, accounts: list[Account]) -> dict[int, Balances]:
    """Every account's balances from one grouped query, however many accounts (D-111)."""
    if not accounts:
        return {}
    ids = [account.id for account in accounts]
    cleared = Transaction.status.in_(CLEARED_STATUSES)
    reconciled = Transaction.status == "reconciled"
    sums = {
        account_id: (int(total), int(cleared_total), int(reconciled_total))
        for account_id, total, cleared_total, reconciled_total in db.execute(
            select(
                Transaction.account_id,
                func.sum(Transaction.amount_cents),
                func.sum(case((cleared, Transaction.amount_cents), else_=0)),
                func.sum(case((reconciled, Transaction.amount_cents), else_=0)),
            )
            .where(Transaction.account_id.in_(ids))
            .group_by(Transaction.account_id)
        )
    }
    latest = _latest_valuations(db, [a.id for a in accounts if a.valuation_mode == "manual"])

    out: dict[int, Balances] = {}
    for account in accounts:
        if account.valuation_mode == "manual":
            value = latest.get(account.id, account.opening_balance_cents)
            # A typed balance is already the whole truth, so nothing is outstanding.
            out[account.id] = Balances(account.id, value, value, value)
            continue
        opening = account.opening_balance_cents
        total, cleared_total, reconciled_total = sums.get(account.id, (0, 0, 0))
        out[account.id] = Balances(
            account_id=account.id,
            current_cents=opening + total,
            cleared_cents=opening + cleared_total,
            reconciled_cents=opening + reconciled_total,
        )
    return out


def _latest_valuations(db: DbSession, account_ids: list[int]) -> dict[int, int]:
    if not account_ids:
        return {}
    newest = (
        select(AccountValuation.account_id, func.max(AccountValuation.date).label("on"))
        .where(AccountValuation.account_id.in_(account_ids))
        .group_by(AccountValuation.account_id)
        .subquery()
    )
    rows = db.execute(
        select(AccountValuation.account_id, AccountValuation.balance_cents).join(
            newest,
            (AccountValuation.account_id == newest.c.account_id)
            & (AccountValuation.date == newest.c.on),
        )
    )
    return {int(account_id): int(balance) for account_id, balance in rows}


def balances_as_of_many(
    db: DbSession, accounts: list[Account], dates: list[date]
) -> dict[int, list[int]]:
    """Each account's balance on each of `dates` (sorted, inclusive), in two queries.

    The same answer as calling `balance_as_of` for every pair (D-111): transactions are
    summed into one bucket per date with a single grouped query, then accumulated.
    """
    if not accounts or not dates:
        return {account.id: [] for account in accounts}
    dates = sorted(dates)
    counted = [a.id for a in accounts if a.valuation_mode != "manual"]
    buckets: dict[int, list[int]] = defaultdict(lambda: [0] * len(dates))
    if counted:
        bucket = case(
            *((Transaction.date <= on, index) for index, on in enumerate(dates)),
            else_=len(dates),
        )
        for account_id, index, total in db.execute(
            select(Transaction.account_id, bucket, func.sum(Transaction.amount_cents))
            .where(Transaction.account_id.in_(counted), Transaction.date <= dates[-1])
            .group_by(Transaction.account_id, bucket)
        ):
            buckets[account_id][int(index)] += int(total)

    valuations: dict[int, list[tuple[date, int]]] = defaultdict(list)
    manual = [a.id for a in accounts if a.valuation_mode == "manual"]
    if manual:
        for account_id, on, balance in db.execute(
            select(
                AccountValuation.account_id, AccountValuation.date, AccountValuation.balance_cents
            )
            .where(AccountValuation.account_id.in_(manual))
            .order_by(AccountValuation.date)
        ):
            valuations[account_id].append((on, balance))

    out: dict[int, list[int]] = {}
    for account in accounts:
        values: list[int] = []
        if account.valuation_mode == "manual":
            history = valuations.get(account.id, [])
            for on in dates:
                known = [balance for when, balance in history if when <= on]
                if known:
                    values.append(known[-1])
                else:
                    values.append(
                        account.opening_balance_cents if account.opening_date <= on else 0
                    )
        else:
            running = account.opening_balance_cents
            for index, on in enumerate(dates):
                running += buckets[account.id][index] if account.id in buckets else 0
                values.append(running if account.opening_date <= on else 0)
        out[account.id] = values
    return out


def balances_for_ids(db: DbSession, account_ids: list[int]) -> list[Balances]:
    """The balances a mutation response carries, so the UI never has to refetch."""
    if not account_ids:
        return []
    accounts = db.scalars(select(Account).where(Account.id.in_(set(account_ids)))).all()
    return list(balances_for_many(db, list(accounts)).values())
