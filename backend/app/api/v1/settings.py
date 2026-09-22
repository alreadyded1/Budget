"""Household settings singleton."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session as DbSession

from app.db import get_db
from app.schemas.settings import SettingsOut, SettingsUpdate
from app.services import settings as settings_service

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("", response_model=SettingsOut)
def get_settings_(db: DbSession = Depends(get_db)) -> SettingsOut:
    return SettingsOut.model_validate(settings_service.get_settings_row(db))


@router.patch("", response_model=SettingsOut)
def patch_settings(payload: SettingsUpdate, db: DbSession = Depends(get_db)) -> SettingsOut:
    changes = payload.model_dump(exclude_unset=True)
    return SettingsOut.model_validate(settings_service.update_settings(db, changes))
