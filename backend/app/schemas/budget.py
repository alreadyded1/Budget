"""Budget planner and dashboard schemas. Every amount is integer cents."""

import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.pay_schedule import PeriodOut
from app.schemas.subscription import BillOut
from app.schemas.transaction import BalanceOut, TransactionOut

Kind = Literal["expense", "income"]


class PlanLineOut(BaseModel):
    category_id: int
    name: str
    kind: Kind
    planned_cents: int
    actual_cents: int
    remaining_cents: int
    overspent: bool
    is_sinking_fund: bool
    is_hidden: bool
    note: str | None
    committed_cents: int = 0


class PlanGroupOut(BaseModel):
    id: int
    name: str
    kind: Kind
    planned_cents: int
    actual_cents: int
    remaining_cents: int
    lines: list[PlanLineOut]


class SummaryOut(BaseModel):
    expected_income_cents: int
    received_income_cents: int
    planned_expense_cents: int
    left_to_plan_cents: int
    spent_cents: int
    remaining_cents: int


class BudgetOut(BaseModel):
    period: PeriodOut
    previous_id: int | None
    next_id: int | None
    income: list[PlanGroupOut]
    expense: list[PlanGroupOut]
    summary: SummaryOut
    uncategorized_count: int


class PlannedIn(BaseModel):
    planned_cents: int = Field(ge=0)
    note: str | None = Field(default=None, max_length=500)


class PlannedItem(BaseModel):
    category_id: int
    planned_cents: int = Field(ge=0)


class PlannedBulkIn(BaseModel):
    items: list[PlannedItem]


class OverspentOut(BaseModel):
    category_id: int
    name: str
    group_name: str
    planned_cents: int
    actual_cents: int
    over_cents: int


class DashboardOut(BaseModel):
    today: datetime.date
    #: Null until a pay schedule exists.
    budget: BudgetOut | None
    overspent: list[OverspentOut]
    balances: list[BalanceOut]
    recent: list[TransactionOut]
    upcoming_bills: list[BillOut] = []
