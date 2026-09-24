"""Net worth and the debt payoff planner (SPEC §14)."""

from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session as DbSession

from app.db import get_db
from app.schemas.net_worth import (
    BreakdownAccountOut,
    BreakdownOut,
    DebtOut,
    DebtPlanIn,
    DebtPlanOut,
    NetWorthOut,
    PayoffOut,
    PointOut,
    ScheduleLineOut,
    ScheduleMonthOut,
    SimulationOut,
    SkippedDebtOut,
    Strategy,
    StrategyOut,
)
from app.services import debt as debt_service
from app.services import net_worth as service

router = APIRouter(tags=["net worth"])


def _point(point: service.Point) -> PointOut:
    return PointOut(
        date=point.on,
        assets_cents=point.assets_cents,
        liabilities_cents=point.liabilities_cents,
        net_cents=point.net_cents,
    )


@router.get("/net-worth", response_model=NetWorthOut)
def get_net_worth(
    months: int | None = Query(default=24, ge=1, le=600),
    all_time: bool = Query(default=False, alias="all"),
    db: DbSession = Depends(get_db),
) -> NetWorthOut:
    result = service.build(db, date.today(), None if all_time else months)
    return NetWorthOut(
        today=_point(result.today),
        history=[_point(p) for p in result.history],
        breakdown=[
            BreakdownOut(
                type=row.type,
                label=row.label,
                is_liability=row.is_liability,
                balance_cents=row.balance_cents,
                accounts=[
                    BreakdownAccountOut(account_id=a.id, name=a.name, balance_cents=b)
                    for a, b in row.accounts
                ],
            )
            for row in result.breakdown
        ],
    )


def _plan_out(db: DbSession) -> DebtPlanOut:
    plan = debt_service.get_plan(db)
    included, skipped = debt_service.debts(db)
    return DebtPlanOut(
        strategy=plan.strategy,
        extra_monthly_cents=plan.extra_monthly_cents,
        custom_order=list(plan.custom_order or []),
        debts=[
            DebtOut(
                account_id=a.id,
                name=a.name,
                owed_cents=d.balance_cents,
                apr_bps=a.apr_bps,
                min_payment_cents=a.min_payment_cents,
            )
            for a, d in included
        ],
        skipped=[
            SkippedDebtOut(
                account_id=s.account.id,
                name=s.account.name,
                owed_cents=s.owed_cents,
                apr_bps=s.account.apr_bps,
                min_payment_cents=s.account.min_payment_cents,
                reason=s.reason,
            )
            for s in skipped
        ],
    )


@router.get("/debt-plan", response_model=DebtPlanOut)
def get_debt_plan(db: DbSession = Depends(get_db)) -> DebtPlanOut:
    return _plan_out(db)


@router.put("/debt-plan", response_model=DebtPlanOut)
def save_debt_plan(payload: DebtPlanIn, db: DbSession = Depends(get_db)) -> DebtPlanOut:
    debt_service.save_plan(db, payload.model_dump(exclude_none=True))
    return _plan_out(db)


@router.get("/debt-plan/simulation", response_model=SimulationOut)
def simulate(
    extra_cents: int | None = Query(default=None, ge=0),
    strategy: Strategy | None = Query(default=None),
    order: list[int] = Query(default=[]),
    db: DbSession = Depends(get_db),
) -> SimulationOut:
    """Every strategy side by side; the schedule of `strategy` (the saved one by default).

    `extra_cents` and `order` try a different extra payment or custom order without saving.
    """
    plan = debt_service.get_plan(db)
    extra = plan.extra_monthly_cents if extra_cents is None else extra_cents
    custom = order or list(plan.custom_order or [])
    results = debt_service.simulate_all(db, date.today(), extra, custom)
    chosen = strategy or plan.strategy
    if chosen not in results:
        chosen = "avalanche" if "avalanche" in results else None
    strategies = []
    for name, result in results.items():
        labels = {m.index: m.label for m in result.months}
        strategies.append(
            StrategyOut(
                strategy=name,
                order=result.order,
                months=result.month_count,
                finished=result.finished,
                debt_free=result.months[-1].label if result.finished and result.months else None,
                total_interest_cents=result.total_interest_cents,
                total_paid_cents=result.total_paid_cents,
                payoffs=[
                    PayoffOut(
                        account_id=account_id,
                        month_index=index,
                        month=labels.get(index) if index else None,
                    )
                    for account_id, index in result.payoff_month.items()
                ],
            )
        )
    schedule = results[chosen].months if chosen else []
    return SimulationOut(
        extra_monthly_cents=extra,
        strategies=strategies,
        schedule_strategy=chosen,
        schedule=[
            ScheduleMonthOut(
                index=m.index,
                month=m.label,
                lines=[
                    ScheduleLineOut(
                        account_id=line.debt_id,
                        interest_cents=line.interest_cents,
                        payment_cents=line.payment_cents,
                        balance_cents=line.balance_cents,
                    )
                    for line in m.lines
                ],
            )
            for m in schedule
        ],
    )
