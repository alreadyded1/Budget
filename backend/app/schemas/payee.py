"""Payee schemas, including the usage stats Phase 4 fills in."""

from datetime import date

from pydantic import BaseModel, ConfigDict, Field


class PayeeCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    default_category_id: int | None = None
    notes: str | None = Field(default=None, max_length=500)


class PayeeUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    default_category_id: int | None = None
    notes: str | None = Field(default=None, max_length=500)
    is_hidden: bool | None = None


class PayeeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    default_category_id: int | None
    notes: str | None
    is_hidden: bool
    transaction_count: int = 0
    last_used: date | None = None
    total_spent_cents: int = 0
    last_category_id: int | None = None
    last_amount_cents: int | None = None


class PayeeListOut(BaseModel):
    items: list[PayeeOut]


class MergeRequest(BaseModel):
    source_id: int


class MergeResult(BaseModel):
    payee: PayeeOut
    moved: dict[str, int]
