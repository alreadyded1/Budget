"""Account schemas. All money is integer cents; APR is basis points."""

from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

AccountType = Literal[
    "checking",
    "savings",
    "credit_card",
    "cash",
    "loan",
    "mortgage",
    "investment",
    "other_asset",
    "other_liability",
]
ValuationMode = Literal["transactions", "manual"]


class AccountCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    type: AccountType
    on_budget: bool | None = None
    opening_balance_cents: int = 0
    opening_date: date | None = None
    institution: str | None = Field(default=None, max_length=120)
    last4: str | None = Field(default=None, max_length=4, pattern=r"^\d{0,4}$")
    valuation_mode: ValuationMode = "transactions"
    apr_bps: int | None = Field(default=None, ge=0, le=1_000_000)
    min_payment_cents: int | None = Field(default=None, ge=0)
    payment_due_day: int | None = Field(default=None, ge=1, le=31)
    low_balance_alert_cents: int | None = None


class AccountUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    type: AccountType | None = None
    on_budget: bool | None = None
    opening_balance_cents: int | None = None
    opening_date: date | None = None
    institution: str | None = Field(default=None, max_length=120)
    last4: str | None = Field(default=None, max_length=4, pattern=r"^\d{0,4}$")
    valuation_mode: ValuationMode | None = None
    apr_bps: int | None = Field(default=None, ge=0, le=1_000_000)
    min_payment_cents: int | None = Field(default=None, ge=0)
    payment_due_day: int | None = Field(default=None, ge=1, le=31)
    low_balance_alert_cents: int | None = None


class AccountOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    type: AccountType
    on_budget: bool
    opening_balance_cents: int
    opening_date: date
    institution: str | None
    last4: str | None
    sort_order: int
    is_closed: bool
    closed_on: date | None = None
    valuation_mode: ValuationMode
    apr_bps: int | None
    min_payment_cents: int | None
    payment_due_day: int | None
    low_balance_alert_cents: int | None
    is_liability: bool


class AccountListOut(BaseModel):
    items: list[AccountOut]


class ReorderRequest(BaseModel):
    ordered_ids: list[int]


class ValuationCreate(BaseModel):
    date: date
    balance_cents: int
    note: str | None = Field(default=None, max_length=500)


class ValuationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    account_id: int
    date: date
    balance_cents: int
    note: str | None


class ValuationListOut(BaseModel):
    items: list[ValuationOut]
