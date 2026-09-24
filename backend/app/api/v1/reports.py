"""Reports (SPEC §16). Every report takes a preset or from/to, plus optional filters."""

from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session as DbSession

from app.api.v1.transactions import transaction_outs
from app.db import get_db
from app.schemas.reports import (
    BucketOut,
    CategoryPlanOut,
    CategoryTotalOut,
    CategoryTrendOut,
    FlowOut,
    IncomeVsExpenseOut,
    ListedTransactionOut,
    PayeeTotalOut,
    PeriodPlanOut,
    PlannedVsActualOut,
    RangeOut,
    SpendingByCategoryOut,
    SpendingByPayeeOut,
    SubscriptionCostOut,
    SubscriptionCostsOut,
    TransactionListOut,
    TrendSeriesOut,
)
from app.services import reports as service

router = APIRouter(prefix="/reports", tags=["reports"])


def filters(
    db: DbSession = Depends(get_db),
    preset: str | None = Query(default=None),
    start: date | None = Query(default=None, alias="from"),
    end: date | None = Query(default=None, alias="to"),
    account_id: list[int] = Query(default=[]),
    category_id: list[int] = Query(default=[]),
    payee_id: list[int] = Query(default=[]),
    uncategorized: bool = Query(default=False),
) -> service.Filters:
    first, last = service.resolve_range(db, preset, date.today(), start, end)
    return service.Filters(
        start=first,
        end=last,
        account_ids=tuple(account_id),
        category_ids=tuple(category_id),
        payee_ids=tuple(payee_id),
        uncategorized=uncategorized,
    )


def _flow(flow: service.Flow) -> dict:
    return {
        "income_cents": flow.income_cents,
        "spending_cents": flow.spending_cents,
        "net_cents": flow.net_cents,
        "savings_rate_bp": flow.savings_rate_bp,
    }


@router.get("/range", response_model=RangeOut)
def get_range(f: service.Filters = Depends(filters)) -> RangeOut:
    return RangeOut(start=f.start, end=f.end)


@router.get("/spending-by-category", response_model=SpendingByCategoryOut)
def spending_by_category(
    f: service.Filters = Depends(filters), db: DbSession = Depends(get_db)
) -> SpendingByCategoryOut:
    rows, total = service.spending_by_category(db, f)
    return SpendingByCategoryOut(
        start=f.start,
        end=f.end,
        total_cents=total,
        items=[
            CategoryTotalOut(
                category_id=r.category_id,
                name=r.name,
                group_id=r.group_id,
                group_name=r.group_name,
                total_cents=r.total_cents,
                share_bp=r.share_bp,
                count=r.count,
            )
            for r in rows
        ],
    )


@router.get("/spending-by-payee", response_model=SpendingByPayeeOut)
def spending_by_payee(
    f: service.Filters = Depends(filters), db: DbSession = Depends(get_db)
) -> SpendingByPayeeOut:
    rows, total = service.spending_by_payee(db, f)
    return SpendingByPayeeOut(
        start=f.start,
        end=f.end,
        total_cents=total,
        items=[
            PayeeTotalOut(
                payee_id=r.payee_id,
                name=r.name,
                total_cents=r.total_cents,
                share_bp=r.share_bp,
                count=r.count,
            )
            for r in rows
        ],
    )


@router.get("/income-vs-expense", response_model=IncomeVsExpenseOut)
def income_vs_expense(
    by: Literal["month", "period"] = Query(default="month"),
    f: service.Filters = Depends(filters),
    db: DbSession = Depends(get_db),
) -> IncomeVsExpenseOut:
    buckets, total = service.income_vs_expense(db, f, by)
    return IncomeVsExpenseOut(
        start=f.start,
        end=f.end,
        by=by,
        buckets=[
            BucketOut(start=b.start, end=b.end, label=b.label, **_flow(b.flow)) for b in buckets
        ],
        total=FlowOut(**_flow(total)),
    )


@router.get("/planned-vs-actual", response_model=PlannedVsActualOut)
def planned_vs_actual(
    f: service.Filters = Depends(filters), db: DbSession = Depends(get_db)
) -> PlannedVsActualOut:
    periods, rows = service.planned_vs_actual(db, f)
    return PlannedVsActualOut(
        start=f.start,
        end=f.end,
        periods=[
            PeriodPlanOut(
                period_id=p.period_id,
                start=p.start,
                end=p.end,
                is_transition=p.is_transition,
                planned_expense_cents=p.planned_expense_cents,
                actual_expense_cents=p.actual_expense_cents,
                planned_income_cents=p.planned_income_cents,
                actual_income_cents=p.actual_income_cents,
            )
            for p in periods
        ],
        categories=[
            CategoryPlanOut(
                category_id=r.category_id,
                name=r.name,
                group_name=r.group_name,
                kind=r.kind,
                planned_cents=r.planned_cents,
                actual_cents=r.actual_cents,
                variance_cents=r.variance_cents,
            )
            for r in rows
        ],
    )


@router.get("/category-trend", response_model=CategoryTrendOut)
def category_trend(
    f: service.Filters = Depends(filters), db: DbSession = Depends(get_db)
) -> CategoryTrendOut:
    months, series = service.category_trend(db, f)
    info = service.category_info(db)
    return CategoryTrendOut(
        start=f.start,
        end=f.end,
        months=[RangeOut(start=a, end=b) for a, b in months],
        series=[
            TrendSeriesOut(
                category_id=key,
                name=info[key].name if key in info else "?",
                values=values,
            )
            for key, values in series.items()
        ],
    )


@router.get("/subscriptions", response_model=SubscriptionCostsOut)
def subscription_costs(db: DbSession = Depends(get_db)) -> SubscriptionCostsOut:
    rows, monthly, annual = service.subscription_costs(db)
    info = service.category_info(db)
    return SubscriptionCostsOut(
        monthly_cents=monthly,
        annual_cents=annual,
        items=[
            SubscriptionCostOut(
                category_id=key,
                name=info[key].name if key in info else "Uncategorized",
                monthly_cents=m,
                annual_cents=a,
                count=n,
            )
            for key, m, a, n in rows
        ],
    )


@router.get("/transactions", response_model=TransactionListOut)
def transactions(
    on_budget: bool = Query(default=False),
    flow: Literal["in", "out"] | None = Query(default=None),
    f: service.Filters = Depends(filters),
    db: DbSession = Depends(get_db),
) -> TransactionListOut:
    rows, total, truncated = service.transaction_list(db, f, on_budget_only=on_budget, flow=flow)
    outs = transaction_outs(db, [row.transaction for row in rows])
    return TransactionListOut(
        start=f.start,
        end=f.end,
        total_cents=total,
        truncated=truncated,
        items=[
            ListedTransactionOut(
                transaction=out, amount_cents=row.amount_cents, running_cents=row.running_cents
            )
            for out, row in zip(outs, rows, strict=True)
        ],
    )
