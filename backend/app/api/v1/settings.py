"""Household settings singleton."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session as DbSession

from app.db import get_db
from app.schemas.settings import SettingsOut, SettingsUpdate
from app.services import settings as settings_service

router = APIRouter(prefix="/settings", tags=["settings"])


def _out(row) -> SettingsOut:
    out = SettingsOut.model_validate(row)
    out.ntfy_token_set = bool(row.ntfy_token)
    return out


@router.get("", response_model=SettingsOut)
def get_settings_(db: DbSession = Depends(get_db)) -> SettingsOut:
    return _out(settings_service.get_settings_row(db))


@router.patch("", response_model=SettingsOut)
def patch_settings(payload: SettingsUpdate, db: DbSession = Depends(get_db)) -> SettingsOut:
    changes = payload.model_dump(exclude_unset=True)
    # Empty strings clear a setting rather than storing "".
    for key in ("ntfy_url", "ntfy_topic", "ntfy_token"):
        if key in changes and isinstance(changes[key], str):
            changes[key] = changes[key].strip() or None
    return _out(settings_service.update_settings(db, changes))
