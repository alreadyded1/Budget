"""The debt payoff planner (SPEC §14, D-096 to D-098)."""

from dataclasses import dataclass
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.domain import debt_payoff as math
from app.errors import AppError
from app.models import DEBT_PLAN_ID, Account, DebtPlan
from app.services import balances as balances_service

STRATEGIES = ("snowball", "avalanche", "custom")


@dataclass(slots=True)
class Skipped:
    account: Account
    owed_cents: int
    reason: str


def get_plan(db: DbSession) -> DebtPlan:
    plan = db.get(DebtPlan, DEBT_PLAN_ID)
    if plan is None:
        plan = DebtPlan(
            id=DEBT_PLAN_ID, strategy="avalanche", extra_monthly_cents=0, custom_order=[]
        )
        db.add(plan)
        db.commit()
        db.refresh(plan)
    return plan


def save_plan(db: DbSession, changes: dict) -> DebtPlan:
    plan = get_plan(db)
    if "strategy" in changes:
        if changes["strategy"] not in STRATEGIES:
            raise AppError(422, f"Unknown strategy: {changes['strategy']}", "invalid_strategy")
        plan.strategy = changes["strategy"]
    if "extra_monthly_cents" in changes:
        if changes["extra_monthly_cents"] < 0:
            raise AppError(422, "The extra payment cannot be negative.", "invalid_extra")
        plan.extra_monthly_cents = changes["extra_monthly_cents"]
    if "custom_order" in changes:
        plan.custom_order = [int(i) for i in dict.fromkeys(changes["custom_order"])]
    db.commit()
    db.refresh(plan)
    return plan


def debts(db: DbSession) -> tuple[list[tuple[Account, math.Debt]], list[Skipped]]:
    """Open liability accounts that owe money; those missing a rate or minimum are skipped."""
    included: list[tuple[Account, math.Debt]] = []
    skipped: list[Skipped] = []
    accounts = db.scalars(
        select(Account).where(Account.is_closed.is_(False)).order_by(Account.sort_order, Account.id)
    ).all()
    liabilities = [account for account in accounts if account.is_liability]
    balances = balances_service.balances_for_many(db, liabilities)
    for account in liabilities:
        owed = -balances[account.id].current_cents
        if owed <= 0:
            continue
        if account.apr_bps is None or not account.min_payment_cents:
            missing = []
            if account.apr_bps is None:
                missing.append("APR")
            if not account.min_payment_cents:
                missing.append("minimum payment")
            skipped.append(Skipped(account, owed, f"needs its {' and '.join(missing)}"))
            continue
        included.append(
            (
                account,
                math.Debt(
                    account.id, account.name, owed, account.apr_bps, account.min_payment_cents
                ),
            )
        )
    return included, skipped


def first_month(today: date) -> tuple[int, int]:
    """Month 1 is next month (D-096)."""
    return (today.year + 1, 1) if today.month == 12 else (today.year, today.month + 1)


def simulate_all(
    db: DbSession, today: date, extra_cents: int, custom_order: list[int]
) -> dict[str, math.Result]:
    included, _ = debts(db)
    found = [debt for _, debt in included]
    results = {}
    for strategy in STRATEGIES:
        if strategy == "custom" and not custom_order:
            continue
        results[strategy] = math.simulate(
            found, extra_cents, strategy, start=first_month(today), custom_order=custom_order
        )
    return results
