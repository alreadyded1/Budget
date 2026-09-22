"""Household member schemas."""

from pydantic import BaseModel, Field

from app.schemas.auth import UserOut


class UserCreate(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    display_name: str = Field(default="", max_length=120)
    password: str = Field(min_length=1, max_length=256)


class UserUpdate(BaseModel):
    display_name: str | None = Field(default=None, max_length=120)
    is_active: bool | None = None


class PasswordReset(BaseModel):
    password: str = Field(min_length=1, max_length=256)


class UserListResponse(BaseModel):
    items: list[UserOut]
