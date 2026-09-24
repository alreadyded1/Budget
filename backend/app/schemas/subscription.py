"""Subscription, bill and occurrence schemas. Amounts are integer cents."""

import datetime
from typing import Literal

from pydantic import BaseModel, Field, HttpUrl

Frequency = Literal["weekly", "biweekly", "monthly", "quarterly", "semiannual", "annual", "custom"]
Unit = Literal["day", "week", "month"]
Status = Literal["active", "paused", "cancelled"]
OccurrenceStatus = Literal["upcoming", "paid", "skipped"]


class SubscriptionIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    payee_id: int | None = None
    category_id: int | None = None
    account_id: int | None = None
    amount_cents: int = Field(gt=0)
    frequency: Frequency = "monthly"
    interval_count: int = Field(default=1, ge=1, le=366)
    interval_unit: Unit | None = None
    anchor_date: datetime.date
    day_of_month: int | None = Field(default=None, ge=1, le=31)
    start_date: datetime.date | None = None
    end_date: datetime.date | None = None
    status: Status = "active"
    auto_post: bool = False
    remind_days_before: int = Field(default=3, ge=0, le=60)
    url: HttpUrl | None = None
    notes: str | None = Field(default=None, max_length=2000)


class SubscriptionPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    payee_id: int | None = None
    category_id: int | None = None
    account_id: int | None = None
    amount_cents: int | None = Field(default=None, gt=0)
    frequency: Frequency | None = None
    interval_count: int | None = Field(default=None, ge=1, le=366)
    interval_unit: Unit | None = None
    anchor_date: datetime.date | None = None
    day_of_month: int | None = Field(default=None, ge=1, le=31)
    start_date: datetime.date | None = None
    end_date: datetime.date | None = None
    status: Status | None = None
    auto_post: bool | None = None
    remind_days_before: int | None = Field(default=None, ge=0, le=60)
    url: HttpUrl | None = None
    notes: str | None = Field(default=None, max_length=2000)


class PricePointOut(BaseModel):
    effective_date: datetime.date
    amount_cents: int


class SubscriptionOut(BaseModel):
    id: int
    name: str
    payee_id: int | None
    category_id: int | None
    account_id: int | None
    amount_cents: int
    frequency: Frequency
    interval_count: int
    interval_unit: Unit | None
    anchor_date: datetime.date
    day_of_month: int | None
    start_date: datetime.date
    end_date: datetime.date | None
    status: Status
    auto_post: bool
    remind_days_before: int
    url: str | None
    notes: str | None
    #: The oldest unpaid bill (overdue included), or null.
    next_due_date: datetime.date | None
    monthly_cents: int
    annual_cents: int
    previous_amount_cents: int | None
    price_increased: bool
    price_history: list[PricePointOut]


class CategoryTotalOut(BaseModel):
    category_id: int | None
    monthly_cents: int
    annual_cents: int


class SubscriptionListOut(BaseModel):
    items: list[SubscriptionOut]
    #: Active subscriptions only.
    monthly_cents: int
    annual_cents: int
    by_category: list[CategoryTotalOut]


class BillOut(BaseModel):
    occurrence_id: int
    subscription_id: int
    name: str
    payee_id: int | None
    category_id: int | None
    account_id: int | None
    due_date: datetime.date
    amount_cents: int
    status: OccurrenceStatus
    overdue: bool
    transaction_id: int | None
    url: str | None


class BillListOut(BaseModel):
    items: list[BillOut]


class PayIn(BaseModel):
    transaction_id: int | None = None
