"""The household settings singleton."""

from typing import Any

from sqlalchemy.orm import Session as DbSession

from app.models import SETTINGS_ID, Settings

EDITABLE_FIELDS = {
    "household_name",
    "currency_symbol",
    "week_start",
    "theme_default",
    "ntfy_url",
    "ntfy_topic",
    "ntfy_token",
    "reminder_hour",
    "prefill_last_amount",
}


def get_settings_row(db: DbSession) -> Settings:
    """The row is seeded by migration; recreate it if a restore ever loses it."""
    settings = db.get(Settings, SETTINGS_ID)
    if settings is None:
        settings = Settings(id=SETTINGS_ID)
        db.add(settings)
        db.commit()
        db.refresh(settings)
    return settings


def update_settings(db: DbSession, changes: dict[str, Any]) -> Settings:
    settings = get_settings_row(db)
    for field, value in changes.items():
        if field in EDITABLE_FIELDS:
            setattr(settings, field, value)
    db.commit()
    db.refresh(settings)
    return settings
