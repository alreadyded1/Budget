"""The budget planner and the dashboard."""

from dataclasses import asdict
from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session as DbSession

from app.api.v1.pay_schedule import period_out
from app.api.v1.transactions import transaction_outs
from app.db import get_db
from app.schemas.budget import (
    BudgetOut,
    DashboardOut,
    OverspentOut,
    PlanGroupOut,
    PlanLineOut,
    PlannedBulkIn,
    PlannedIn,
    SummaryOut,
)
from app.schemas.transaction import BalanceOut
from app.services import budget as service
from app.services import dashboard as dashboard_service
from app.services import pay_schedule as pay_schedule_service

router = APIRouter(tags=["budget"])


def _group_out(group: service.PlanGroup) -> PlanGroupOut:
    return PlanGroupOut(
        id=group.id,
        name=group.name,
        kind=group.kind,
        planned_cents=group.planned_cents,
        actual_cents=group.actual_cents,
        remaining_cents=group.remaining_cents,
        lines=[PlanLineOut(**asdict(line)) for line in group.lines],
    )


def budget_out(view: service.BudgetView) -> BudgetOut:
    return BudgetOut(
        period=period_out(view.period),
        previous_id=view.previous_id,
        next_id=view.next_id,
        income=[_group_out(group) for group in view.income],
        expense=[_group_out(group) for group in view.expense],
        summary=SummaryOut(**asdict(view.summary)),
        uncategorized_count=view.uncategorized_count,
    )


@router.get("/budget/current", response_model=BudgetOut)
def current_budget(db: DbSession = Depends(get_db)) -> BudgetOut:
    today = date.today()
    pay_schedule_service.ensure_horizon(db, today)
    period = pay_schedule_service.current_period(db, today)
    return budget_out(service.open_period(db, period.id))


@router.get("/budget/{period_id}", response_model=BudgetOut)
def get_budget(period_id: int, db: DbSession = Depends(get_db)) -> BudgetOut:
    return budget_out(service.open_period(db, period_id))


@router.put("/budget/{period_id}/categories/{category_id}", response_model=BudgetOut)
def set_planned(
    period_id: int, category_id: int, payload: PlannedIn, db: DbSession = Depends(get_db)
) -> BudgetOut:
    view = service.set_planned(
        db,
        period_id,
        category_id,
        payload.planned_cents,
        payload.note,
        set_note="note" in payload.model_fields_set,
    )
    return budget_out(view)


@router.put("/budget/{period_id}/plan", response_model=BudgetOut)
def set_plan(period_id: int, payload: PlannedBulkIn, db: DbSession = Depends(get_db)) -> BudgetOut:
    amounts = {item.category_id: item.planned_cents for item in payload.items}
    return budget_out(service.set_many(db, period_id, amounts))


@router.post("/budget/{period_id}/copy-previous", response_model=BudgetOut)
def copy_previous(period_id: int, db: DbSession = Depends(get_db)) -> BudgetOut:
    return budget_out(service.copy_previous(db, period_id))


@router.post("/budget/{period_id}/apply-template", response_model=BudgetOut)
def apply_template(period_id: int, db: DbSession = Depends(get_db)) -> BudgetOut:
    return budget_out(service.apply_template(db, period_id))


@router.post("/budget/{period_id}/clear", response_model=BudgetOut)
def clear_plan(period_id: int, db: DbSession = Depends(get_db)) -> BudgetOut:
    return budget_out(service.clear_plan(db, period_id))


@router.post("/budget/{period_id}/prorate", response_model=BudgetOut)
def prorate_plan(period_id: int, db: DbSession = Depends(get_db)) -> BudgetOut:
    return budget_out(service.prorate_plan(db, period_id))


@router.get("/dashboard", response_model=DashboardOut)
def dashboard(db: DbSession = Depends(get_db)) -> DashboardOut:
    board = dashboard_service.build(db, date.today())
    return DashboardOut(
        today=board.today,
        budget=budget_out(board.budget) if board.budget else None,
        overspent=[OverspentOut(**asdict(row)) for row in board.overspent],
        balances=[BalanceOut(**balance.as_dict()) for balance in board.balances],
        recent=transaction_outs(db, board.recent),
    )
