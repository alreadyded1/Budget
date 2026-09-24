"""The dashboard: the current period at a glance (BUILD_PLAN Phase 6)."""

from dataclasses import dataclass
from datetime import date, timedelta

from sqlalchemy.orm import Session as DbSession

from app.models import Transaction
from app.services import accounts as accounts_service
from app.services import balances as balances_service
from app.services import budget as budget_service
from app.services import ledger as ledger_service
from app.services import pay_schedule as pay_schedule_service
from app.services import subscriptions as subscriptions_service

OVERSPENT_SHOWN = 5
RECENT_SHOWN = 10
#: Without a pay schedule, "this period and the next" becomes the next 30 days.
UPCOMING_FALLBACK_DAYS = 30


@dataclass(slots=True)
class Overspent:
    category_id: int
    name: str
    group_name: str
    planned_cents: int
    actual_cents: int
    over_cents: int


@dataclass(slots=True)
class Dashboard:
    today: date
    budget: budget_service.BudgetView | None
    overspent: list[Overspent]
    balances: list[balances_service.Balances]
    recent: list[Transaction]
    #: Unpaid bills from the start of this period to the end of the next (SPEC §9).
    upcoming_bills: list[subscriptions_service.Bill]


def most_overspent(
    view: budget_service.BudgetView, limit: int = OVERSPENT_SHOWN
) -> list[Overspent]:
    rows = [
        Overspent(
            category_id=line.category_id,
            name=line.name,
            group_name=group.name,
            planned_cents=line.planned_cents,
            actual_cents=line.actual_cents,
            over_cents=line.actual_cents - line.planned_cents,
        )
        for group in view.expense
        for line in group.lines
        if line.overspent
    ]
    rows.sort(key=lambda row: (-row.over_cents, row.name.lower()))
    return rows[:limit]


def build(db: DbSession, today: date) -> Dashboard:
    view = None
    if pay_schedule_service.current_schedule(db) is not None:
        pay_schedule_service.ensure_horizon(db, today)
        period = pay_schedule_service.period_containing(db, today)
        if period is not None:
            view = budget_service.open_period(db, period.id)

    if view is not None:
        following = budget_service.next_period(db, view.period)
        window = (view.period.start_date, (following or view.period).end_date)
    else:
        window = (today, today + timedelta(days=UPCOMING_FALLBACK_DAYS))
    upcoming = [
        bill
        for bill in subscriptions_service.bills(db, *window, today=today)
        if bill.occurrence.status == "upcoming"
    ]

    accounts = accounts_service.list_accounts(db, include_closed=False)
    recent = ledger_service.query(db, ledger_service.LedgerFilters(), limit=RECENT_SHOWN)
    return Dashboard(
        today=today,
        budget=view,
        overspent=most_overspent(view) if view else [],
        balances=[balances_service.balances_for(db, account) for account in accounts],
        recent=[row.transaction for row in recent.rows],
        upcoming_bills=upcoming,
    )
