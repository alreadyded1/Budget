"""Pay schedule and pay period schemas."""

from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Frequency = Literal["weekly", "biweekly", "semimonthly", "monthly"]
WeekendRule = Literal["none", "previous_business_day", "next_business_day"]


class ScheduleInput(BaseModel):
    frequency: Frequency
    effective_from: date
    anchor_date: date | None = None
    day_of_month_1: int | None = Field(default=None, ge=1, le=31)
    day_of_month_2: int | None = Field(default=None, ge=1, le=31)
    weekend_rule: WeekendRule = "none"
    notes: str | None = Field(default=None, max_length=500)


class ScheduleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    frequency: Frequency
    effective_from: date
    anchor_date: date | None
    day_of_month_1: int | None
    day_of_month_2: int | None
    weekend_rule: WeekendRule
    notes: str | None


class ScheduleHistoryOut(BaseModel):
    current: ScheduleOut | None
    history: list[ScheduleOut]


class PeriodOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    start_date: date
    end_date: date
    schedule_id: int
    is_transition: bool
    days: int = 0


class PeriodListOut(BaseModel):
    items: list[PeriodOut]


class PreviewPeriodOut(BaseModel):
    start_date: date
    end_date: date
    is_transition: bool
    days: int


class PreviewOut(BaseModel):
    first_pay_date: date
    periods: list[PreviewPeriodOut]
    transition: PreviewPeriodOut | None
    #: Pay dates where the weekend rule was skipped to keep the timeline in order.
    unshifted_dates: list[date]
