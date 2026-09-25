"""Savings goals and sinking funds (SPEC §13, D-088 to D-093).

A sinking fund's balance is its starting balance plus everything planned for its category
in every period from the goal's start through the period being looked at, minus the
category's net spending over the same days. A savings goal's progress is its account's
balance minus the goal's starting amount.
"""

from dataclasses import dataclass
from datetime import date, timedelta

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session as DbSession

from app.domain import goals as math
from app.errors import AppError
from app.models import Account, Goal, PayPeriod, PeriodPlan, Transaction, TransactionSplit
from app.services import accounts as accounts_service
from app.services import balances as balances_service
from app.services import categories as categories_service
from app.services import pay_schedule as pay_schedule_service

EDITABLE = {
    "name",
    "type",
    "target_cents",
    "target_date",
    "account_id",
    "category_id",
    "starting_balance_cents",
    "start_date",
    "notes",
}

#: Savings goals read their rate from this many completed pay periods (D-091).
RATE_PERIODS = 3


def get_goal(db: DbSession, goal_id: int) -> Goal:
    goal = db.get(Goal, goal_id)
    if goal is None:
        raise AppError(404, "Goal not found", "goal_not_found")
    return goal


def list_goals(db: DbSession, *, include_archived: bool = False) -> list[Goal]:
    query = select(Goal).order_by(
        Goal.is_archived, Goal.target_date.is_(None), Goal.target_date, Goal.id
    )
    if not include_archived:
        query = query.where(Goal.is_archived.is_(False))
    return list(db.scalars(query))


def _period_start(db: DbSession, day: date) -> date:
    period = pay_schedule_service.period_containing(db, day)
    return period.start_date if period else day


def _validate(db: DbSession, goal: Goal) -> None:
    goal.name = (goal.name or "").strip()
    if not goal.name:
        raise AppError(422, "Give the goal a name.", "name_required")
    if goal.type not in ("savings", "sinking_fund"):
        raise AppError(422, f"Unknown goal type: {goal.type}", "invalid_goal_type")
    if not goal.target_cents or goal.target_cents <= 0:
        raise AppError(422, "The target must be more than zero.", "invalid_target")

    if goal.category_id is not None:
        category = categories_service.get_category(db, goal.category_id)
        group = categories_service.get_group(db, category.group_id)
        if group.kind == "income":
            raise AppError(
                422, "A goal's category must be an expense category.", "goal_category_income"
            )

    if goal.type == "savings":
        if goal.account_id is None:
            raise AppError(422, "A savings goal needs an account.", "goal_account_required")
        account = accounts_service.get_account(db, goal.account_id)
        if account.is_liability:
            raise AppError(
                422,
                "A savings goal tracks an asset account. "
                "Paying down debt comes with the debt planner.",
                "goal_account_liability",
            )
    else:
        if goal.category_id is None:
            raise AppError(422, "A sinking fund needs its category.", "goal_category_required")
        goal.account_id = None
        taken = db.scalars(
            select(Goal).where(
                Goal.type == "sinking_fund",
                Goal.category_id == goal.category_id,
                Goal.id != (goal.id or 0),
            )
        ).first()
        if taken is not None:
            raise AppError(
                409,
                f"That category already has a sinking fund: {taken.name}.",
                "sinking_fund_taken",
            )
        # The flag is what makes the planner treat the category as a fund (D-093).
        categories_service.get_category(db, goal.category_id).is_sinking_fund = True


def create_goal(db: DbSession, fields: dict, *, today: date) -> Goal:
    goal = Goal(**{key: value for key, value in fields.items() if key in EDITABLE})
    goal.starting_balance_cents = goal.starting_balance_cents or 0
    goal.start_date = _period_start(db, goal.start_date or today)
    _validate(db, goal)
    db.add(goal)
    db.commit()
    db.refresh(goal)
    return goal


def update_goal(db: DbSession, goal_id: int, changes: dict) -> Goal:
    goal = get_goal(db, goal_id)
    for key, value in changes.items():
        if key == "is_archived":
            goal.is_archived = bool(value)
        elif key in EDITABLE:
            setattr(goal, key, value)
    if "start_date" in changes and changes["start_date"] is not None:
        goal.start_date = _period_start(db, changes["start_date"])
    _validate(db, goal)
    db.commit()
    db.refresh(goal)
    return goal


def delete_goal(db: DbSession, goal_id: int) -> None:
    db.delete(get_goal(db, goal_id))
    db.commit()


# ------------------------------------------------------------------------------ the math


def _spent_by_day(
    db: DbSession, category_id: int, start: date, end: date
) -> list[tuple[date, int]]:
    """(date, net spending) for the category's on-budget splits in [start, end]."""
    rows = db.execute(
        select(Transaction.date, TransactionSplit.amount_cents)
        .join(Transaction, Transaction.id == TransactionSplit.transaction_id)
        .join(Account, Account.id == Transaction.account_id)
        .where(
            Account.on_budget.is_(True),
            TransactionSplit.category_id == category_id,
            Transaction.date >= start,
            Transaction.date <= end,
        )
    ).all()
    return [(day, -int(amount)) for day, amount in rows]


def fund_flows(db: DbSession, goal: Goal, through: PayPeriod) -> list[math.PeriodFlow]:
    """One flow per pay period from the goal's start through `through`."""
    if goal.category_id is None or through.end_date < goal.start_date:
        return []
    periods = pay_schedule_service.list_periods(db, goal.start_date, through.end_date)
    planned = dict(
        db.execute(
            select(PeriodPlan.pay_period_id, PeriodPlan.planned_cents).where(
                PeriodPlan.category_id == goal.category_id,
                PeriodPlan.pay_period_id.in_([p.id for p in periods]),
            )
        ).all()
    )
    spending = _spent_by_day(db, goal.category_id, goal.start_date, through.end_date)
    flows = []
    for period in periods:
        spent = sum(
            amount for day, amount in spending if period.start_date <= day <= period.end_date
        )
        flows.append(math.PeriodFlow(int(planned.get(period.id, 0)), spent))
    return flows


def fund_balance(db: DbSession, goal: Goal, through: PayPeriod) -> int:
    return math.sinking_balance(goal.starting_balance_cents, fund_flows(db, goal, through))


def fund_goals_by_category(db: DbSession) -> dict[int, Goal]:
    """Sinking-fund goals keyed by category, for the planner (archived ones still count)."""
    rows = db.scalars(
        select(Goal).where(Goal.type == "sinking_fund", Goal.category_id.is_not(None))
    ).all()
    return {goal.category_id: goal for goal in rows if goal.category_id is not None}


@dataclass(slots=True)
class Progress:
    goal: Goal
    #: Fund balance (sinking funds) or account balance minus the starting amount (savings).
    progress_cents: int
    remaining_cents: int
    #: What each pay period through the target date needs, or None without a target date.
    needed_cents: int | None
    periods_left: int | None
    #: This period's plan for the goal's category (sinking funds, or savings with a category).
    current_planned_cents: int | None
    #: The rate the projection assumes, per pay period.
    rate_cents: int
    projected_date: date | None
    status: math.Status
    current_period_id: int | None


def _planned(db: DbSession, period: PayPeriod, category_id: int) -> int:
    return int(
        db.scalar(
            select(PeriodPlan.planned_cents).where(
                PeriodPlan.pay_period_id == period.id, PeriodPlan.category_id == category_id
            )
        )
        or 0
    )


def _savings_rate(db: DbSession, account: Account, current: PayPeriod) -> int:
    """Average change per period over the last completed pay periods (D-091)."""
    before = pay_schedule_service.list_periods(
        db, current.start_date - timedelta(days=400), current.start_date - timedelta(days=1)
    )
    recent = before[-RATE_PERIODS:]
    if not recent:
        return 0
    dates = [recent[0].start_date - timedelta(days=1)] + [period.end_date for period in recent]
    return math.average_change(
        balances_service.balances_as_of_many(db, [account], dates)[account.id]
    )


def progress(db: DbSession, goal: Goal, today: date) -> Progress:
    current = pay_schedule_service.period_containing(db, today)
    current_planned = (
        _planned(db, current, goal.category_id)
        if current is not None and goal.category_id is not None
        else None
    )

    if goal.type == "sinking_fund":
        value = fund_balance(db, goal, current) if current else goal.starting_balance_cents
        rate = current_planned or 0
        # The suggestion replaces this period's plan, so it is left out of the base (D-090).
        base = (
            value - (current_planned or 0)
            if current and current.end_date >= goal.start_date
            else value
        )
    else:
        account = db.get(Account, goal.account_id) if goal.account_id else None
        balance = balances_service.balances_for(db, account).current_cents if account else 0
        value = balance - goal.starting_balance_cents
        rate = _savings_rate(db, account, current) if account and current else 0
        base = value

    remaining = goal.target_cents - value
    needed: int | None = None
    periods_left: int | None = None
    projected: date | None = None
    if current is not None:
        spans = [
            (p.start_date, p.end_date)
            for p in pay_schedule_service.list_periods(db, current.start_date, None)
        ]
        if goal.target_date is not None:
            periods_left = math.periods_until(spans, today, goal.target_date)
            needed = math.needed_per_period(goal.target_cents - base, periods_left)
        projected = math.projected_completion(remaining, rate, spans[1:])
    return Progress(
        goal=goal,
        progress_cents=value,
        remaining_cents=max(remaining, 0),
        needed_cents=needed,
        periods_left=periods_left,
        current_planned_cents=current_planned,
        rate_cents=rate,
        projected_date=projected,
        status=math.status(remaining, goal.target_date, projected),
        current_period_id=current.id if current else None,
    )


def use_suggested(db: DbSession, goal_id: int, today: date) -> Progress:
    """Write the needed amount into the current period's plan for the goal's category."""
    from app.services import budget as budget_service

    goal = get_goal(db, goal_id)
    if goal.category_id is None:
        raise AppError(
            422,
            "Give this goal a plan category first, so there is a plan line to fill.",
            "goal_category_required",
        )
    if goal.target_date is None:
        raise AppError(422, "A suggestion needs a target date.", "goal_target_date_required")
    current = pay_schedule_service.current_period(db, today)
    result = progress(db, goal, today)
    if result.needed_cents is None:
        raise AppError(422, "There is no suggestion for this goal.", "goal_no_suggestion")
    budget_service.set_planned(db, current.id, goal.category_id, result.needed_cents)
    return progress(db, get_goal(db, goal_id), today)


# ---------------------------------------------------------------------- reference moves


def move_category(db: DbSession, source_id: int, target_id: int) -> int:
    result = db.execute(
        update(Goal)
        .where(Goal.category_id == source_id)
        .values(category_id=target_id)
        .execution_options(synchronize_session=False)
    )
    db.flush()
    return int(result.rowcount or 0)


def count_category(db: DbSession, category_id: int) -> int:
    return int(
        db.scalar(select(func.count()).select_from(Goal).where(Goal.category_id == category_id))
        or 0
    )


def register() -> None:
    from app.services import references

    references.register_category_reassigner("goals", move_category)
    references.register_category_counter("goals", count_category)
