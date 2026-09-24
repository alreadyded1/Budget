"""The notification log and the ntfy "Send test" button (SPEC §10)."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session as DbSession

from app.db import get_db
from app.schemas.settings import NotificationListOut, NotificationOut, TestResultOut
from app.services import notifications as service

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("", response_model=NotificationListOut)
def list_notifications(
    db: DbSession = Depends(get_db), limit: int = Query(default=100, ge=1, le=500)
) -> NotificationListOut:
    return NotificationListOut(
        items=[NotificationOut.model_validate(row) for row in service.recent(db, limit)]
    )


@router.post("/test", response_model=TestResultOut)
def send_test(db: DbSession = Depends(get_db)) -> TestResultOut:
    outcome = service.send_test(db)
    return TestResultOut(success=outcome.status == "sent", error=outcome.error)
