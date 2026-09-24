"""Net worth and debt payoff schemas (SPEC §14). Money is integer cents."""

import datetime
from typing import Literal

from pydantic import BaseModel, Field

Strategy = Literal["snowball", "avalanche", "custom"]


class PointOut(BaseModel):
    date: datetime.date
    assets_cents: int
    #: Signed: liabilities are negative.
    liabilities_cents: int
    net_cents: int


class BreakdownAccountOut(BaseModel):
    account_id: int
    name: str
    balance_cents: int


class BreakdownOut(BaseModel):
    type: str
    label: str
    is_liability: bool
    balance_cents: int
    accounts: list[BreakdownAccountOut]


class NetWorthOut(BaseModel):
    today: PointOut
    history: list[PointOut]
    breakdown: list[BreakdownOut]


class DebtOut(BaseModel):
    account_id: int
    name: str
    owed_cents: int
    apr_bps: int | None
    min_payment_cents: int | None


class SkippedDebtOut(DebtOut):
    reason: str


class DebtPlanOut(BaseModel):
    strategy: Strategy
    extra_monthly_cents: int
    custom_order: list[int]
    debts: list[DebtOut]
    skipped: list[SkippedDebtOut]


class DebtPlanIn(BaseModel):
    strategy: Strategy | None = None
    extra_monthly_cents: int | None = Field(default=None, ge=0)
    custom_order: list[int] | None = None


class PayoffOut(BaseModel):
    account_id: int
    #: 1-based month the debt reaches zero, or null if it never does within 50 years.
    month_index: int | None
    month: str | None


class StrategyOut(BaseModel):
    strategy: Strategy
    order: list[int]
    months: int
    finished: bool
    debt_free: str | None
    total_interest_cents: int
    total_paid_cents: int
    payoffs: list[PayoffOut]


class ScheduleLineOut(BaseModel):
    account_id: int
    interest_cents: int
    payment_cents: int
    balance_cents: int


class ScheduleMonthOut(BaseModel):
    index: int
    month: str
    lines: list[ScheduleLineOut]


class SimulationOut(BaseModel):
    extra_monthly_cents: int
    strategies: list[StrategyOut]
    #: The month-by-month schedule of the chosen strategy.
    schedule_strategy: Strategy | None
    schedule: list[ScheduleMonthOut]
