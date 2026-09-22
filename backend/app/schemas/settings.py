"""Household settings schemas. ntfy fields are writable now, exposed in the UI in Phase 9."""

from pydantic import BaseModel, ConfigDict, Field


class SettingsOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    household_name: str
    currency_symbol: str
    week_start: int
    theme_default: str
    ntfy_url: str | None
    ntfy_topic: str | None
    reminder_hour: int
    prefill_last_amount: bool


class SettingsUpdate(BaseModel):
    household_name: str | None = Field(default=None, min_length=1, max_length=120)
    currency_symbol: str | None = Field(default=None, min_length=1, max_length=8)
    week_start: int | None = Field(default=None, ge=0, le=6)
    theme_default: str | None = Field(default=None, pattern="^(light|dark|system)$")
    ntfy_url: str | None = Field(default=None, max_length=255)
    ntfy_topic: str | None = Field(default=None, max_length=120)
    ntfy_token: str | None = Field(default=None, max_length=255)
    reminder_hour: int | None = Field(default=None, ge=0, le=23)
    prefill_last_amount: bool | None = None
