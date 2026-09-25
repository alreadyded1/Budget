"""Data export (SPEC §17): a full JSON snapshot and every transaction as CSV."""

from collections.abc import Callable, Iterator
from datetime import UTC, datetime

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session as DbSession

from app.db import SessionLocal
from app.services import export as service

router = APIRouter(prefix="/export", tags=["export"])


def _attachment(filename: str) -> dict[str, str]:
    return {
        "Content-Disposition": f'attachment; filename="{filename}"',
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
    }


def _own_session(produce: Callable[[DbSession], Iterator[str]]) -> Iterator[str]:
    """A session for the stream itself: the request's closes before the body is sent."""
    db = SessionLocal()
    try:
        yield from produce(db)
    finally:
        db.close()


@router.get("/json")
def export_json() -> StreamingResponse:
    now = datetime.now(UTC)
    return StreamingResponse(
        _own_session(lambda db: service.json_chunks(db, now)),
        media_type="application/json",
        headers=_attachment(f"payday-budget-{now:%Y%m%d-%H%M%S}.json"),
    )


@router.get("/transactions.csv")
def export_transactions() -> StreamingResponse:
    now = datetime.now(UTC)
    return StreamingResponse(
        _own_session(service.csv_chunks),
        media_type="text/csv; charset=utf-8",
        headers=_attachment(f"transactions-{now:%Y%m%d}.csv"),
    )
