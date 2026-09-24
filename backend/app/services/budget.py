"""The budget planner: one plan per pay period, compared with what actually happened.

Rules (SPEC §8, D-054 to D-057):
  * Actual = the sum of split amounts in the category for transactions dated inside the
    period, counting on-budget accounts only. A transfer between two on-budget accounts
    has no splits, so it drops out; the on-budget leg of a payment to a tracking account
    carries a split, so it counts.
  * A period is prefilled from the template the first time it is opened. After that its
    rows stay, so clearing a plan does not bring the template back.
  * Copy, template, clear and prorate each overwrite every planned amount in the period.
"""

from dataclasses import dataclass, field
from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

from app.domain import budget as math
from app.errors import AppError
from app.models import (
    Account,
    Category,
    CategoryGroup,
    PayPeriod,
    PeriodPlan,
    Transaction,
    TransactionSplit,
)
from app.services import categories as categories_service


@dataclass(slots=True)
class PlanLine:
    category_id: int
    name: str
    kind: math.Kind
    planned_cents: int
    actual_cents: int
    remaining_cents: int
    overspent: bool
    is_sinking_fund: bool
    is_hidden: bool
    note: str | None


@dataclass(slots=True)
class PlanGroup:
    id: int
    name: str
    kind: math.Kind
    planned_cents: int = 0
    actual_cents: int = 0
    remaining_cents: int = 0
    lines: list[PlanLine] = field(default_factory=list)


@dataclass(slots=True)
class BudgetView:
    period: PayPeriod
    previous_id: int | None
    next_id: int | None
    income: list[PlanGroup]
    expense: list[PlanGroup]
    summary: math.Summary
    uncategorized_count: int


# ------------------------------------------------------------------------------ periods


def get_period(db: DbSession, period_id: int) -> PayPeriod:
    period = db.get(PayPeriod, period_id)
    if period is None:
        raise AppError(404, "Pay period not found", "pay_period_not_found")
    return period


def previous_period(db: DbSession, period: PayPeriod) -> PayPeriod | None:
    # Periods are contiguous (SPEC §2), so the one before ends the day before this starts.
    return db.scalars(
        select(PayPeriod).where(PayPeriod.end_date == period.start_date - timedelta(days=1))
    ).first()


def next_period(db: DbSession, period: PayPeriod) -> PayPeriod | None:
    return db.scalars(
        select(PayPeriod).where(PayPeriod.start_date == period.end_date + timedelta(days=1))
    ).first()


def period_days(period: PayPeriod) -> int:
    return (period.end_date - period.start_date).days + 1


# ------------------------------------------------------------------------------ actuals


def split_totals(db: DbSession, start: date, end: date) -> dict[int | None, int]:
    """Signed split totals per category for on-budget transactions in [start, end]."""
    rows = db.execute(
        select(TransactionSplit.category_id, func.sum(TransactionSplit.amount_cents))
        .join(Transaction, Transaction.id == TransactionSplit.transaction_id)
        .join(Account, Account.id == Transaction.account_id)
        .where(
            Account.on_budget.is_(True),
            Transaction.date >= start,
            Transaction.date <= end,
        )
        .group_by(TransactionSplit.category_id)
    ).all()
    return {category_id: int(total or 0) for category_id, total in rows}


def uncategorized_count(db: DbSession, start: date, end: date) -> int:
    """On-budget transactions in the window with at least one uncategorized split."""
    return int(
        db.scalar(
            select(func.count(func.distinct(Transaction.id)))
            .join(TransactionSplit, TransactionSplit.transaction_id == Transaction.id)
            .join(Account, Account.id == Transaction.account_id)
            .where(
                Account.on_budget.is_(True),
                TransactionSplit.category_id.is_(None),
                Transaction.date >= start,
                Transaction.date <= end,
            )
        )
        or 0
    )


# -------------------------------------------------------------------------------- plans


def _plan_rows(db: DbSession, period_id: int) -> dict[int, PeriodPlan]:
    rows = db.scalars(select(PeriodPlan).where(PeriodPlan.pay_period_id == period_id))
    return {row.category_id: row for row in rows}


def _all_categories(db: DbSession) -> list[tuple[CategoryGroup, Category]]:
    groups = categories_service.list_groups(db, include_hidden=True)
    return [(group, category) for group in groups for category in group.categories]


def ensure_plan(db: DbSession, period: PayPeriod) -> bool:
    """Prefill an untouched period from the template. Returns True if it did (D-056)."""
    exists = db.scalar(
        select(func.count()).select_from(PeriodPlan).where(PeriodPlan.pay_period_id == period.id)
    )
    if exists:
        return False
    added = False
    for group, category in _all_categories(db):
        if group.is_hidden or category.is_hidden:
            continue
        db.add(
            PeriodPlan(
                pay_period_id=period.id,
                category_id=category.id,
                planned_cents=max(0, category.default_planned_cents),
            )
        )
        added = True
    if added:
        db.commit()
    return added


def _set_amounts(db: DbSession, period: PayPeriod, amounts: dict[int, int]) -> None:
    """Upsert planned amounts for the given categories in one commit."""
    rows = _plan_rows(db, period.id)
    for category_id, cents in amounts.items():
        if cents < 0:
            raise AppError(422, "A planned amount cannot be negative.", "negative_plan")
        row = rows.get(category_id)
        if row is None:
            db.add(
                PeriodPlan(pay_period_id=period.id, category_id=category_id, planned_cents=cents)
            )
        else:
            row.planned_cents = cents
    db.commit()


def set_planned(
    db: DbSession,
    period_id: int,
    category_id: int,
    planned_cents: int,
    note: str | None = None,
    *,
    set_note: bool = False,
) -> BudgetView:
    period = get_period(db, period_id)
    categories_service.get_category(db, category_id)
    ensure_plan(db, period)
    _set_amounts(db, period, {category_id: planned_cents})
    if set_note:
        row = _plan_rows(db, period.id)[category_id]
        row.note = (note or "").strip() or None
        db.commit()
    return build_view(db, period)


def set_many(db: DbSession, period_id: int, amounts: dict[int, int]) -> BudgetView:
    """Bulk set, used by the planner's Undo after a copy, template, clear or prorate."""
    period = get_period(db, period_id)
    for category_id in amounts:
        categories_service.get_category(db, category_id)
    ensure_plan(db, period)
    _set_amounts(db, period, amounts)
    return build_view(db, period)


def _every_category_to(db: DbSession, period: PayPeriod, amount_of) -> BudgetView:
    """Overwrite every category's planned amount (D-057), hidden ones included."""
    ensure_plan(db, period)
    existing = _plan_rows(db, period.id)
    amounts: dict[int, int] = {}
    for group, category in _all_categories(db):
        hidden = group.is_hidden or category.is_hidden
        if hidden and category.id not in existing:
            continue
        amounts[category.id] = max(0, amount_of(category))
    _set_amounts(db, period, amounts)
    return build_view(db, period)


def copy_previous(db: DbSession, period_id: int) -> BudgetView:
    period = get_period(db, period_id)
    previous = previous_period(db, period)
    if previous is None:
        raise AppError(422, "There is no earlier pay period to copy.", "no_previous_period")
    ensure_plan(db, previous)
    source = {
        category_id: row.planned_cents for category_id, row in _plan_rows(db, previous.id).items()
    }
    return _every_category_to(db, period, lambda category: source.get(category.id, 0))


def apply_template(db: DbSession, period_id: int) -> BudgetView:
    period = get_period(db, period_id)
    return _every_category_to(db, period, lambda category: category.default_planned_cents)


def clear_plan(db: DbSession, period_id: int) -> BudgetView:
    period = get_period(db, period_id)
    return _every_category_to(db, period, lambda category: 0)


def proration_base(db: DbSession, period: PayPeriod) -> PayPeriod:
    """The last normal (non-transition) period before this one (D-055)."""
    candidate = previous_period(db, period)
    while candidate is not None and candidate.is_transition:
        candidate = previous_period(db, candidate)
    if candidate is None:
        raise AppError(
            422,
            "There is no normal pay period before this one to prorate against.",
            "no_proration_base",
        )
    return candidate


def prorate_plan(db: DbSession, period_id: int) -> BudgetView:
    period = get_period(db, period_id)
    if not period.is_transition:
        raise AppError(422, "Only a transition period can be prorated.", "not_a_transition_period")
    days = period_days(period)
    base_days = period_days(proration_base(db, period))
    return _every_category_to(
        db, period, lambda category: math.prorate(category.default_planned_cents, days, base_days)
    )


# --------------------------------------------------------------------------------- view


def build_view(db: DbSession, period: PayPeriod) -> BudgetView:
    plans = _plan_rows(db, period.id)
    totals = split_totals(db, period.start_date, period.end_date)

    income: list[PlanGroup] = []
    expense: list[PlanGroup] = []
    all_lines: list[math.Line] = []
    for group in categories_service.list_groups(db, include_hidden=True):
        kind: math.Kind = "income" if group.kind == "income" else "expense"
        plan_group = PlanGroup(id=group.id, name=group.name, kind=kind)
        for category in group.categories:
            row = plans.get(category.id)
            planned = row.planned_cents if row else 0
            actual = math.actual_for(kind, totals.get(category.id, 0))
            hidden = group.is_hidden or category.is_hidden
            # A hidden category still shows while it has money planned or moving.
            if hidden and planned == 0 and actual == 0:
                continue
            line = PlanLine(
                category_id=category.id,
                name=category.name,
                kind=kind,
                planned_cents=planned,
                actual_cents=actual,
                remaining_cents=math.remaining(planned, actual),
                overspent=math.is_overspent(kind, planned, actual),
                is_sinking_fund=category.is_sinking_fund,
                is_hidden=hidden,
                note=row.note if row else None,
            )
            plan_group.lines.append(line)
            plan_group.planned_cents += planned
            plan_group.actual_cents += actual
            all_lines.append(math.Line(kind, planned, actual))
        if not plan_group.lines:
            continue
        plan_group.remaining_cents = math.remaining(
            plan_group.planned_cents, plan_group.actual_cents
        )
        (income if kind == "income" else expense).append(plan_group)

    previous = previous_period(db, period)
    following = next_period(db, period)
    return BudgetView(
        period=period,
        previous_id=previous.id if previous else None,
        next_id=following.id if following else None,
        income=income,
        expense=expense,
        summary=math.summarize(all_lines),
        uncategorized_count=uncategorized_count(db, period.start_date, period.end_date),
    )


def open_period(db: DbSession, period_id: int) -> BudgetView:
    """What the planner shows, prefilling the period on first open."""
    period = get_period(db, period_id)
    ensure_plan(db, period)
    return build_view(db, period)


# ---------------------------------------------------------------------- reference moves


def move_category_plans(db: DbSession, source_id: int, target_id: int) -> int:
    """On a category delete with reassignment, fold its plans into the target's."""
    moved = 0
    for row in db.scalars(select(PeriodPlan).where(PeriodPlan.category_id == source_id)).all():
        target = db.scalars(
            select(PeriodPlan).where(
                PeriodPlan.pay_period_id == row.pay_period_id,
                PeriodPlan.category_id == target_id,
            )
        ).first()
        if target is None:
            row.category_id = target_id
        else:
            target.planned_cents += row.planned_cents
            db.delete(row)
        moved += 1
    db.flush()
    return moved


def register() -> None:
    from app.services import references

    # Plans never block a delete (no counter): they go with the category, or move with it.
    references.register_category_reassigner("period_plans", move_category_plans)
