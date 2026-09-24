"""Report schemas (SPEC §16). Money is integer cents; shares are basis points (1% = 100)."""

import datetime
from typing import Literal

from pydantic import BaseModel

from app.schemas.transaction import TransactionOut


class RangeOut(BaseModel):
    start: datetime.date
    end: datetime.date


class CategoryTotalOut(BaseModel):
    category_id: int | None
    name: str
    group_id: int | None
    group_name: str
    total_cents: int
    share_bp: int
    count: int


class SpendingByCategoryOut(RangeOut):
    items: list[CategoryTotalOut]
    total_cents: int


class PayeeTotalOut(BaseModel):
    payee_id: int | None
    name: str
    total_cents: int
    share_bp: int
    count: int


class SpendingByPayeeOut(RangeOut):
    items: list[PayeeTotalOut]
    total_cents: int


class FlowOut(BaseModel):
    income_cents: int
    spending_cents: int
    net_cents: int
    #: (income − spending) ÷ income in basis points; null when there is no income.
    savings_rate_bp: int | None


class BucketOut(FlowOut):
    start: datetime.date
    end: datetime.date
    label: str


class IncomeVsExpenseOut(RangeOut):
    by: Literal["month", "period"]
    buckets: list[BucketOut]
    total: FlowOut


class PeriodPlanOut(BaseModel):
    period_id: int
    start: datetime.date
    end: datetime.date
    is_transition: bool
    planned_expense_cents: int
    actual_expense_cents: int
    planned_income_cents: int
    actual_income_cents: int


class CategoryPlanOut(BaseModel):
    category_id: int
    name: str
    group_name: str
    kind: Literal["income", "expense"]
    planned_cents: int
    actual_cents: int
    variance_cents: int


class PlannedVsActualOut(RangeOut):
    periods: list[PeriodPlanOut]
    categories: list[CategoryPlanOut]


class TrendSeriesOut(BaseModel):
    category_id: int
    name: str
    values: list[int]


class CategoryTrendOut(RangeOut):
    months: list[RangeOut]
    series: list[TrendSeriesOut]


class SubscriptionCostOut(BaseModel):
    category_id: int | None
    name: str
    monthly_cents: int
    annual_cents: int
    count: int


class SubscriptionCostsOut(BaseModel):
    items: list[SubscriptionCostOut]
    monthly_cents: int
    annual_cents: int


class ListedTransactionOut(BaseModel):
    transaction: TransactionOut
    amount_cents: int
    running_cents: int


class TransactionListOut(RangeOut):
    items: list[ListedTransactionOut]
    total_cents: int
    truncated: bool
