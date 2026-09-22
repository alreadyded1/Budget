"""Liveness endpoint: app version plus whether the database answers."""

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app import __version__
from app.config import Settings, get_settings
from app.db import get_db
from app.schemas.health import DatabaseHealth, HealthResponse

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
def health(
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> HealthResponse:
    try:
        db.execute(text("SELECT 1"))
        database = DatabaseHealth(ok=True)
    except SQLAlchemyError as exc:
        database = DatabaseHealth(ok=False, message=type(exc).__name__)
    return HealthResponse(
        status="ok" if database.ok else "degraded",
        version=__version__,
        env=settings.env,
        database=database,
    )
