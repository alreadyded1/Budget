"""Category group and category schemas."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

GroupKind = Literal["expense", "income"]


class GroupCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    kind: GroupKind = "expense"


class GroupUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    kind: GroupKind | None = None
    is_hidden: bool | None = None


class CategoryCreate(BaseModel):
    group_id: int
    name: str = Field(min_length=1, max_length=120)
    is_sinking_fund: bool = False
    default_planned_cents: int = Field(default=0, ge=0)


class CategoryUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    group_id: int | None = None
    is_hidden: bool | None = None
    is_sinking_fund: bool | None = None
    default_planned_cents: int | None = Field(default=None, ge=0)


class CategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    group_id: int
    name: str
    sort_order: int
    is_hidden: bool
    is_sinking_fund: bool
    default_planned_cents: int


class GroupOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    kind: GroupKind
    sort_order: int
    is_hidden: bool
    categories: list[CategoryOut] = []


class GroupListOut(BaseModel):
    items: list[GroupOut]


class MoveRequest(BaseModel):
    offset: int = Field(description="-1 moves up one place, 1 moves down one place")
