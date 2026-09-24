"""Import, CSV profile and rule schemas. Amounts are integer cents."""

import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.transaction import BalanceOut

DateFormat = Literal[
    "YYYY-MM-DD",
    "MM/DD/YYYY",
    "DD/MM/YYYY",
    "MM/DD/YY",
    "DD/MM/YY",
    "DD.MM.YYYY",
    "YYYYMMDD",
    "MM-DD-YYYY",
]


class ProfileFields(BaseModel):
    delimiter: str = Field(default=",", min_length=1, max_length=1)
    has_header: bool = True
    skip_rows: int = Field(default=0, ge=0, le=100)
    date_column: int = Field(default=0, ge=0)
    date_format: DateFormat = "MM/DD/YYYY"
    amount_mode: Literal["single", "debit_credit"] = "single"
    amount_column: int | None = Field(default=None, ge=0)
    debit_column: int | None = Field(default=None, ge=0)
    credit_column: int | None = Field(default=None, ge=0)
    invert_sign: bool = False
    description_column: int = Field(default=1, ge=0)
    memo_column: int | None = Field(default=None, ge=0)


class ProfileIn(ProfileFields):
    name: str = Field(min_length=1, max_length=120)
    account_id: int | None = None


class ProfileOut(ProfileIn):
    model_config = ConfigDict(from_attributes=True)

    id: int


class ProfileListOut(BaseModel):
    items: list[ProfileOut]


#: The file travels as text inside JSON (D-078); 5 MB is far beyond any statement.
MAX_CONTENT = 5 * 1024 * 1024


class PreviewIn(BaseModel):
    content: str = Field(max_length=MAX_CONTENT)
    profile: ProfileFields


class PreviewRowOut(BaseModel):
    date: datetime.date
    amount_cents: int
    description: str
    memo: str


class ProblemOut(BaseModel):
    line: int
    reason: str


class PreviewOut(BaseModel):
    columns: list[str]
    rows: list[PreviewRowOut]
    problems: list[ProblemOut]


class StageIn(BaseModel):
    account_id: int
    filename: str = Field(min_length=1, max_length=255)
    content: str = Field(min_length=1, max_length=MAX_CONTENT)
    profile_id: int | None = None


class MatchOut(BaseModel):
    transaction_id: int
    date: datetime.date
    amount_cents: int
    payee_id: int | None
    memo: str | None


class BillSuggestionOut(BaseModel):
    occurrence_id: int
    name: str
    due_date: datetime.date


class StagedRowOut(BaseModel):
    id: int
    row_index: int
    date: datetime.date
    amount_cents: int
    raw_description: str
    raw_memo: str
    payee_id: int | None
    new_payee_name: str | None
    category_id: int | None
    memo: str | None
    disposition: Literal["import", "skip", "match"]
    is_duplicate: bool
    applied_rule_id: int | None
    match: MatchOut | None
    bill: BillSuggestionOut | None
    link_bill: bool
    created_transaction_id: int | None


class RowPatch(BaseModel):
    payee_id: int | None = None
    new_payee_name: str | None = Field(default=None, max_length=120)
    category_id: int | None = None
    memo: str | None = Field(default=None, max_length=500)
    disposition: Literal["import", "skip", "match"] | None = None
    link_bill: bool | None = None


class BatchOut(BaseModel):
    id: int
    account_id: int
    filename: str
    format: Literal["csv", "ofx", "qfx"]
    profile_id: int | None
    status: Literal["staged", "committed", "undone"]
    row_count: int
    imported_count: int
    duplicate_count: int
    matched_count: int
    parse_errors: list[str]
    created_at: datetime.datetime
    committed_at: datetime.datetime | None
    undone_at: datetime.datetime | None


class BatchDetailOut(BatchOut):
    rows: list[StagedRowOut]


class BatchListOut(BaseModel):
    items: list[BatchOut]


class BatchResultOut(BaseModel):
    batch: BatchOut
    balances: list[BalanceOut]


# -------------------------------------------------------------------------------- rules


class RuleIn(BaseModel):
    name: str = Field(default="", max_length=120)
    is_active: bool = True
    match_field: Literal["description", "memo"] = "description"
    match_type: Literal["contains", "starts_with", "equals", "regex"] = "contains"
    match_value: str = Field(min_length=1, max_length=500)
    amount_min_cents: int | None = None
    amount_max_cents: int | None = None
    account_id: int | None = None
    set_payee_id: int | None = None
    set_category_id: int | None = None
    set_memo: str | None = Field(default=None, max_length=500)


class RulePatch(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    is_active: bool | None = None
    match_field: Literal["description", "memo"] | None = None
    match_type: Literal["contains", "starts_with", "equals", "regex"] | None = None
    match_value: str | None = Field(default=None, min_length=1, max_length=500)
    amount_min_cents: int | None = None
    amount_max_cents: int | None = None
    account_id: int | None = None
    set_payee_id: int | None = None
    set_category_id: int | None = None
    set_memo: str | None = Field(default=None, max_length=500)


class RuleOut(RuleIn):
    model_config = ConfigDict(from_attributes=True)

    id: int
    priority: int


class RuleListOut(BaseModel):
    items: list[RuleOut]


class MoveIn(BaseModel):
    offset: int


class RuleTestRowOut(BaseModel):
    date: datetime.date
    amount_cents: int
    raw_description: str
    raw_memo: str
    account_id: int


class RuleTestOut(BaseModel):
    checked: int
    matches: list[RuleTestRowOut]
