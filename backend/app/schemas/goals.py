"""Goal schemas (SPEC §13). Money is integer cents."""

import datetime
from typing import Literal

from pydantic import BaseModel, Field

GoalType = Literal["savings", "sinking_fund"]
Status = Literal["done", "on_track", "behind", "no_target"]


class GoalIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    type: GoalType
    target_cents: int = Field(gt=0)
    target_date: datetime.date | None = None
    account_id: int | None = None
    category_id: int | None = None
    starting_balance_cents: int = 0
    #: Rounded back to the start of its pay period; defaults to the current one.
    start_date: datetime.date | None = None
    notes: str | None = Field(default=None, max_length=2000)


class GoalPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    target_cents: int | None = Field(default=None, gt=0)
    target_date: datetime.date | None = None
    account_id: int | None = None
    category_id: int | None = None
    starting_balance_cents: int | None = None
    start_date: datetime.date | None = None
    notes: str | None = Field(default=None, max_length=2000)
    is_archived: bool | None = None


class GoalOut(BaseModel):
    id: int
    name: str
    type: GoalType
    target_cents: int
    target_date: datetime.date | None
    account_id: int | None
    category_id: int | None
    starting_balance_cents: int
    start_date: datetime.date
    is_archived: bool
    notes: str | None
    progress_cents: int
    remaining_cents: int
    needed_cents: int | None
    periods_left: int | None
    current_planned_cents: int | None
    rate_cents: int
    projected_date: datetime.date | None
    status: Status
    current_period_id: int | None


class GoalListOut(BaseModel):
    items: list[GoalOut]
