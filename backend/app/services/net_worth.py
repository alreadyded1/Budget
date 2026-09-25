"""Net worth (SPEC §14, D-094, D-095): assets − liabilities, now and at each month-end.

Balances are signed from each account's side, so liabilities are already negative and net
worth is a plain sum. Manual-valuation accounts use their latest typed balance on or before
each date (balances.balances_as_of_many). The current total counts open accounts; the history
counts each account from its opening date through the day it was closed.
"""

from dataclasses import dataclass
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.domain import net_worth as math
from app.models import Account
from app.services import balances as balances_service

TYPE_LABEL = {
    "checking": "Checking",
    "savings": "Savings",
    "cash": "Cash",
    "investment": "Investments",
    "other_asset": "Other assets",
    "credit_card": "Credit cards",
    "loan": "Loans",
    "mortgage": "Mortgages",
    "other_liability": "Other liabilities",
}


@dataclass(slots=True)
class Point:
    on: date
    assets_cents: int
    liabilities_cents: int

    @property
    def net_cents(self) -> int:
        return self.assets_cents + self.liabilities_cents


@dataclass(slots=True)
class TypeTotal:
    type: str
    label: str
    is_liability: bool
    #: Signed: liabilities are negative.
    balance_cents: int
    accounts: list[tuple[Account, int]]


@dataclass(slots=True)
class NetWorth:
    today: Point
    history: list[Point]
    breakdown: list[TypeTotal]


def _all_accounts(db: DbSession) -> list[Account]:
    return list(db.scalars(select(Account).order_by(Account.sort_order, Account.id)))


def history(db: DbSession, accounts: list[Account], dates: list[date]) -> list[Point]:
    """Assets and liabilities at each date, from one grouped balance query (D-111)."""
    balances = balances_service.balances_as_of_many(db, accounts, dates)
    points = []
    for index, on in enumerate(sorted(dates)):
        assets = liabilities = 0
        for account in accounts:
            if not math.counts_on(account.opening_date, account.closed_on, on):
                continue
            balance = balances[account.id][index]
            if account.is_liability:
                liabilities += balance
            else:
                assets += balance
        points.append(Point(on, assets, liabilities))
    return points


def build(db: DbSession, today: date, months: int | None = 24) -> NetWorth:
    """`months` None means every month since the first account opened."""
    accounts = _all_accounts(db)
    open_accounts = [a for a in accounts if not a.is_closed]

    breakdown: dict[str, TypeTotal] = {}
    assets = liabilities = 0
    current = balances_service.balances_for_many(db, open_accounts)
    for account in open_accounts:
        balance = current[account.id].current_cents
        row = breakdown.setdefault(
            account.type,
            TypeTotal(
                account.type,
                TYPE_LABEL.get(account.type, account.type),
                account.is_liability,
                0,
                [],
            ),
        )
        row.balance_cents += balance
        row.accounts.append((account, balance))
        if account.is_liability:
            liabilities += balance
        else:
            assets += balance

    if months is None:
        first = min((a.opening_date for a in accounts), default=today)
        months = math.months_since(min(first, today), today)
    points = history(db, accounts, math.month_ends(today, months))
    order = list(TYPE_LABEL)
    rows = sorted(
        breakdown.values(),
        key=lambda r: (r.is_liability, order.index(r.type) if r.type in order else 99),
    )
    return NetWorth(Point(today, assets, liabilities), points, rows)
