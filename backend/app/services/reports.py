"""Reports (SPEC §16, D-083 to D-086).

Every money report counts on-budget accounts only, the way the planner does: a transfer
between two on-budget accounts has no splits and drops out, and the on-budget leg of a
payment to a tracking account carries a split, so it counts. Expense categories are
spending (a refund lowers it), income categories are income, and uncategorized splits
count by their sign. So income − spending is always the ledger's net for the range.
"""

from bisect import bisect_right
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date

from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session as DbSession

from app.domain import budget as budget_math
from app.domain import date_ranges
from app.domain import subscriptions as subscription_math
from app.errors import AppError
from app.models import (
    Account,
    Category,
    CategoryGroup,
    Payee,
    Transaction,
    TransactionSplit,
)
from app.services import budget as budget_service
from app.services import pay_schedule as pay_schedule_service
from app.services import subscriptions as subscriptions_service

#: The transaction list stops here and says so (D-086).
MAX_TRANSACTIONS = 10_000


@dataclass(frozen=True, slots=True)
class Filters:
    start: date
    end: date
    account_ids: tuple[int, ...] = ()
    category_ids: tuple[int, ...] = ()
    payee_ids: tuple[int, ...] = ()
    #: Uncategorized splits (the "Uncategorized" row) in addition to category_ids.
    uncategorized: bool = False


def resolve_range(
    db: DbSession,
    preset: str | None,
    today: date,
    start: date | None = None,
    end: date | None = None,
) -> tuple[date, date]:
    """A preset, or from/to for a custom range. Pay-period presets read the stored periods."""
    if preset is None or preset == date_ranges.Preset.CUSTOM:
        if start is None or end is None:
            raise AppError(422, "Pick a preset or give both from and to.", "range_required")
        preset = date_ranges.Preset.CUSTOM
    periods: list[date_ranges.Span] = []
    if preset in (date_ranges.Preset.THIS_PERIOD, date_ranges.Preset.LAST_PERIOD):
        periods = [
            (p.start_date, p.end_date) for p in pay_schedule_service.list_periods(db, None, None)
        ]
    try:
        return date_ranges.resolve(preset, today, periods, custom=(start, end) if start else None)
    except date_ranges.RangeError as exc:
        raise AppError(422, str(exc), "range_invalid") from exc
    except ValueError as exc:
        raise AppError(422, f"Unknown date preset: {preset}", "range_invalid") from exc


# ------------------------------------------------------------------------------- basics


@dataclass(frozen=True, slots=True)
class CategoryInfo:
    id: int
    name: str
    group_id: int
    group_name: str
    kind: budget_math.Kind


def category_info(db: DbSession) -> dict[int, CategoryInfo]:
    rows = db.execute(
        select(Category, CategoryGroup).join(CategoryGroup, CategoryGroup.id == Category.group_id)
    ).all()
    return {
        category.id: CategoryInfo(
            category.id,
            category.name,
            group.id,
            group.name,
            "income" if group.kind == "income" else "expense",
        )
        for category, group in rows
    }


def _split_query(filters: Filters, *columns) -> Select:
    """On-budget splits in the range, narrowed by the filters."""
    query = (
        select(*columns)
        .select_from(TransactionSplit)
        .join(Transaction, Transaction.id == TransactionSplit.transaction_id)
        .join(Account, Account.id == Transaction.account_id)
        .where(
            Account.on_budget.is_(True),
            Transaction.date >= filters.start,
            Transaction.date <= filters.end,
        )
    )
    if filters.account_ids:
        query = query.where(Transaction.account_id.in_(filters.account_ids))
    if filters.payee_ids:
        query = query.where(Transaction.payee_id.in_(filters.payee_ids))
    if filters.category_ids or filters.uncategorized:
        conditions = []
        if filters.category_ids:
            conditions.append(TransactionSplit.category_id.in_(filters.category_ids))
        if filters.uncategorized:
            conditions.append(TransactionSplit.category_id.is_(None))
        query = query.where(
            conditions[0] if len(conditions) == 1 else conditions[0] | conditions[1]
        )
    return query


@dataclass(slots=True)
class Flow:
    """Money in and out for a range, from the splits."""

    income_cents: int = 0
    spending_cents: int = 0

    @property
    def net_cents(self) -> int:
        return self.income_cents - self.spending_cents

    @property
    def savings_rate_bp(self) -> int | None:
        """(income − spending) ÷ income in basis points, rounded half away from zero."""
        if self.income_cents <= 0:
            return None
        return budget_math.prorate(self.net_cents * 100, 100, self.income_cents)


def _flow_rows(db: DbSession, filters: Filters) -> list[tuple[int | None, int, date, int]]:
    """(category_id, amount, date, split count), summed per category, day and direction.

    Summing in SQL keeps a five-year report to tens of thousands of rows instead of every
    split (D-111). Money in and money out stay apart so uncategorized splits keep their sign.
    """
    outflow = TransactionSplit.amount_cents < 0
    query = _split_query(
        filters,
        TransactionSplit.category_id,
        func.sum(TransactionSplit.amount_cents),
        Transaction.date,
        func.count(),
    ).group_by(TransactionSplit.category_id, Transaction.date, outflow)
    return [
        (category_id, int(amount), day, int(count))
        for category_id, amount, day, count in db.execute(query).all()
    ]


def _locate(spans: list[tuple[date, date]]):
    """A lookup from a day to the index of the sorted, non-overlapping span holding it."""
    starts = [start for start, _end in spans]

    def index_of(day: date) -> int | None:
        index = bisect_right(starts, day) - 1
        if index >= 0 and day <= spans[index][1]:
            return index
        return None

    return index_of


def _add(flow: Flow, info: CategoryInfo | None, amount: int) -> None:
    if info is None:
        # Uncategorized: an outflow is spending, an inflow is income (D-084).
        if amount < 0:
            flow.spending_cents += -amount
        else:
            flow.income_cents += amount
    elif info.kind == "income":
        flow.income_cents += amount
    else:
        flow.spending_cents += -amount


# ------------------------------------------------------------------- spending by category


@dataclass(slots=True)
class CategoryTotal:
    category_id: int | None
    name: str
    group_id: int | None
    group_name: str
    kind: budget_math.Kind
    total_cents: int
    share_bp: int = 0
    count: int = 0


def _share(part: int, whole: int) -> int:
    return budget_math.prorate(part * 100, 100, whole) if whole > 0 else 0


def spending_by_category(db: DbSession, filters: Filters) -> tuple[list[CategoryTotal], int]:
    """Spending per expense category plus uncategorized outflows, largest first."""
    info = category_info(db)
    totals: dict[int | None, CategoryTotal] = {}
    for category_id, amount, _day, count in _flow_rows(db, filters):
        found = info.get(category_id) if category_id is not None else None
        if found is not None and found.kind == "income":
            continue
        if found is None and amount >= 0:
            continue  # uncategorized money in is income, not negative spending
        row = totals.get(category_id)
        if row is None:
            row = totals[category_id] = CategoryTotal(
                category_id=category_id,
                name=found.name if found else "Uncategorized",
                group_id=found.group_id if found else None,
                group_name=found.group_name if found else "Uncategorized",
                kind="expense",
                total_cents=0,
            )
        row.total_cents += -amount
        row.count += count
    rows = sorted(totals.values(), key=lambda r: (-r.total_cents, r.name.lower()))
    grand = sum(r.total_cents for r in rows)
    for row in rows:
        row.share_bp = _share(row.total_cents, grand)
    return rows, grand


# ---------------------------------------------------------------------- spending by payee


@dataclass(slots=True)
class PayeeTotal:
    payee_id: int | None
    name: str
    total_cents: int
    count: int
    share_bp: int = 0


def spending_by_payee(db: DbSession, filters: Filters) -> tuple[list[PayeeTotal], int]:
    info = category_info(db)
    names = dict(db.execute(select(Payee.id, Payee.name)).all())
    rows = db.execute(
        _split_query(
            filters,
            Transaction.payee_id,
            TransactionSplit.category_id,
            TransactionSplit.amount_cents,
            Transaction.id,
        )
    ).all()
    totals: dict[int | None, PayeeTotal] = {}
    seen: dict[int | None, set[int]] = defaultdict(set)
    for payee_id, category_id, amount, transaction_id in rows:
        found = info.get(category_id) if category_id is not None else None
        if (found is not None and found.kind == "income") or (found is None and amount >= 0):
            continue
        row = totals.setdefault(
            payee_id,
            PayeeTotal(payee_id, names.get(payee_id, "(no payee)"), 0, 0),
        )
        row.total_cents += -int(amount)
        seen[payee_id].add(transaction_id)
    for payee_id, row in totals.items():
        row.count = len(seen[payee_id])
    ordered = sorted(totals.values(), key=lambda r: (-r.total_cents, r.name.lower()))
    grand = sum(r.total_cents for r in ordered)
    for row in ordered:
        row.share_bp = _share(row.total_cents, grand)
    return ordered, grand


# ---------------------------------------------------------------------- income vs expense


@dataclass(slots=True)
class Bucket:
    start: date
    end: date
    label: str
    flow: Flow = field(default_factory=Flow)


def _period_buckets(db: DbSession, start: date, end: date) -> list[Bucket]:
    periods = pay_schedule_service.list_periods(db, start, end)
    return [
        Bucket(p.start_date, p.end_date, f"{p.start_date.isoformat()} – {p.end_date.isoformat()}")
        for p in periods
    ]


def income_vs_expense(db: DbSession, filters: Filters, by: str) -> tuple[list[Bucket], Flow]:
    """Income, spending, net and savings rate per month or per pay period (D-085)."""
    if by == "period":
        buckets = _period_buckets(db, filters.start, filters.end)
    else:
        buckets = [
            Bucket(a, b, a.strftime("%b %Y"))
            for a, b in date_ranges.months_between(filters.start, filters.end)
        ]
    info = category_info(db)
    total = Flow()
    locate = _locate([(bucket.start, bucket.end) for bucket in buckets])
    for category_id, amount, day, _count in _flow_rows(db, filters):
        found = info.get(category_id) if category_id is not None else None
        _add(total, found, amount)
        index = locate(day)
        if index is not None:
            _add(buckets[index].flow, found, amount)
    return buckets, total


# --------------------------------------------------------------------- planned vs actual


@dataclass(slots=True)
class PeriodPlanTotal:
    period_id: int
    start: date
    end: date
    is_transition: bool
    planned_expense_cents: int
    actual_expense_cents: int
    planned_income_cents: int
    actual_income_cents: int


@dataclass(slots=True)
class CategoryPlanTotal:
    category_id: int
    name: str
    group_name: str
    kind: budget_math.Kind
    planned_cents: int = 0
    actual_cents: int = 0

    @property
    def variance_cents(self) -> int:
        """Planned minus actual, like the planner's Remaining column."""
        return self.planned_cents - self.actual_cents


def planned_vs_actual(
    db: DbSession, filters: Filters
) -> tuple[list[PeriodPlanTotal], list[CategoryPlanTotal]]:
    """Each pay period touching the range, whole (D-085), from the planner's own numbers.

    The planner counts every on-budget account, so account and payee filters do not apply
    here; a category filter narrows the rows and totals.
    """
    wanted = set(filters.category_ids)
    periods: list[PeriodPlanTotal] = []
    categories: dict[int, CategoryPlanTotal] = {}
    for period in pay_schedule_service.list_periods(db, filters.start, filters.end):
        view = budget_service.build_view(db, period)
        total = PeriodPlanTotal(
            period.id, period.start_date, period.end_date, period.is_transition, 0, 0, 0, 0
        )
        for group in [*view.income, *view.expense]:
            for line in group.lines:
                if wanted and line.category_id not in wanted:
                    continue
                if line.kind == "income":
                    total.planned_income_cents += line.planned_cents
                    total.actual_income_cents += line.actual_cents
                else:
                    total.planned_expense_cents += line.planned_cents
                    total.actual_expense_cents += line.actual_cents
                row = categories.setdefault(
                    line.category_id,
                    CategoryPlanTotal(line.category_id, line.name, group.name, line.kind),
                )
                row.planned_cents += line.planned_cents
                row.actual_cents += line.actual_cents
        periods.append(total)
    rows = [row for row in categories.values() if row.planned_cents or row.actual_cents]
    rows.sort(key=lambda r: (r.kind != "income", r.group_name.lower(), r.name.lower()))
    return periods, rows


# ------------------------------------------------------------------------ category trend


def category_trend(
    db: DbSession, filters: Filters
) -> tuple[list[date_ranges.Span], dict[int, list[int]]]:
    """Monthly actuals per chosen category (spending positive, income positive)."""
    if not filters.category_ids:
        raise AppError(422, "Pick at least one category for the trend.", "categories_required")
    months = date_ranges.months_between(filters.start, filters.end)
    info = category_info(db)
    series = {category_id: [0] * len(months) for category_id in filters.category_ids}
    locate = _locate([(start, end) for start, end in months])
    for category_id, amount, day, _count in _flow_rows(db, filters):
        if category_id not in series or category_id not in info:
            continue
        index = locate(day)
        if index is not None:
            series[category_id][index] += budget_math.actual_for(info[category_id].kind, amount)
    return months, series


# --------------------------------------------------------------------- subscriptions cost


def subscription_costs(db: DbSession) -> tuple[list[tuple[int | None, int, int, int]], int, int]:
    """(category_id, monthly, annual, count) for active subscriptions, dearest first."""
    totals: dict[int | None, list[int]] = {}
    for row in subscriptions_service.list_subscriptions(db):
        if row.status != "active":
            continue
        schedule = subscriptions_service.schedule_of(row)
        entry = totals.setdefault(row.category_id, [0, 0, 0])
        entry[0] += subscription_math.monthly_cents(schedule, row.amount_cents)
        entry[1] += subscription_math.annual_cents(schedule, row.amount_cents)
        entry[2] += 1
    rows = sorted(
        ((key, m, a, n) for key, (m, a, n) in totals.items()), key=lambda r: (-r[2], str(r[0]))
    )
    return rows, sum(r[1] for r in rows), sum(r[2] for r in rows)


# ---------------------------------------------------------------------- transaction list


@dataclass(slots=True)
class ListedTransaction:
    transaction: Transaction
    #: The whole amount, or with a category filter only the matching splits (D-086).
    amount_cents: int
    running_cents: int


def transaction_list(
    db: DbSession, filters: Filters, *, on_budget_only: bool = False, flow: str | None = None
) -> tuple[list[ListedTransaction], int, bool]:
    """Every matching transaction, oldest first, with a running total.

    With a category filter each row counts only its matching splits, so the drill-down from
    a category adds up to that category's total. `flow` ("in" or "out") keeps only splits of
    that sign, which is how the "Uncategorized" spending row drills down.
    """
    query = (
        select(Transaction)
        .join(Account, Account.id == Transaction.account_id)
        .where(Transaction.date >= filters.start, Transaction.date <= filters.end)
        .order_by(Transaction.date, Transaction.id)
    )
    if on_budget_only:
        query = query.where(Account.on_budget.is_(True))
    if filters.account_ids:
        query = query.where(Transaction.account_id.in_(filters.account_ids))
    if filters.payee_ids:
        query = query.where(Transaction.payee_id.in_(filters.payee_ids))
    by_split = bool(filters.category_ids or filters.uncategorized or flow)
    if by_split:
        # The outer query already applies the account, payee and on-budget filters.
        matching = _matching_splits(filters)
        if flow == "out":
            matching = matching.where(TransactionSplit.amount_cents < 0)
        elif flow == "in":
            matching = matching.where(TransactionSplit.amount_cents > 0)
        query = query.where(Transaction.id.in_(matching))

    rows = list(db.scalars(query.limit(MAX_TRANSACTIONS + 1)))
    truncated = len(rows) > MAX_TRANSACTIONS
    rows = rows[:MAX_TRANSACTIONS]

    listed: list[ListedTransaction] = []
    running = 0
    for row in rows:
        amount = row.amount_cents
        if by_split:
            amount = sum(
                split.amount_cents for split in row.splits if _split_matches(split, filters, flow)
            )
        running += amount
        listed.append(ListedTransaction(row, amount, running))
    return listed, running, truncated


def _matching_splits(filters: Filters) -> Select:
    """Transaction ids with a split in the filtered categories, on any account."""
    query = (
        select(TransactionSplit.transaction_id)
        .join(Transaction, Transaction.id == TransactionSplit.transaction_id)
        .where(Transaction.date >= filters.start, Transaction.date <= filters.end)
    )
    conditions = []
    if filters.category_ids:
        conditions.append(TransactionSplit.category_id.in_(filters.category_ids))
    if filters.uncategorized:
        conditions.append(TransactionSplit.category_id.is_(None))
    if conditions:
        query = query.where(
            conditions[0] if len(conditions) == 1 else conditions[0] | conditions[1]
        )
    return query


def _split_matches(split: TransactionSplit, filters: Filters, flow: str | None) -> bool:
    if filters.category_ids or filters.uncategorized:
        in_category = split.category_id in filters.category_ids if split.category_id else False
        if not (in_category or (filters.uncategorized and split.category_id is None)):
            return False
    if flow == "out":
        return split.amount_cents < 0
    if flow == "in":
        return split.amount_cents > 0
    return True


def ledger_net(db: DbSession, start: date, end: date) -> int:
    """The on-budget ledger's net for a range; reports must tie to this (BUILD_PLAN)."""
    return int(
        db.scalar(
            select(func.coalesce(func.sum(Transaction.amount_cents), 0))
            .join(Account, Account.id == Transaction.account_id)
            .where(
                Account.on_budget.is_(True),
                Transaction.date >= start,
                Transaction.date <= end,
            )
        )
        or 0
    )
