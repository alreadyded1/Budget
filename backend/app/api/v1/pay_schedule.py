"""Pay schedule and the period timeline."""

from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session as DbSession

from app.db import get_db
from app.models import PayPeriod
from app.schemas.pay_schedule import (
    PeriodListOut,
    PeriodOut,
    PreviewOut,
    PreviewPeriodOut,
    ScheduleHistoryOut,
    ScheduleInput,
    ScheduleOut,
)
from app.services import pay_schedule as service

router = APIRouter(tags=["pay schedule"])


def period_out(period: PayPeriod) -> PeriodOut:
    return PeriodOut(
        id=period.id,
        start_date=period.start_date,
        end_date=period.end_date,
        schedule_id=period.schedule_id,
        is_transition=period.is_transition,
        days=(period.end_date - period.start_date).days + 1,
    )


def _spec_from(payload: ScheduleInput):
    return service.spec_from_input(
        frequency=payload.frequency,
        effective_from=payload.effective_from,
        anchor_date=payload.anchor_date,
        day_of_month_1=payload.day_of_month_1,
        day_of_month_2=payload.day_of_month_2,
        weekend_rule=payload.weekend_rule,
    )


@router.get("/pay-schedule", response_model=ScheduleHistoryOut)
def get_schedule(db: DbSession = Depends(get_db)) -> ScheduleHistoryOut:
    history = service.schedule_history(db)
    return ScheduleHistoryOut(
        current=ScheduleOut.model_validate(history[0]) if history else None,
        history=[ScheduleOut.model_validate(row) for row in history],
    )


@router.post("/pay-schedule/preview", response_model=PreviewOut)
def preview_schedule(payload: ScheduleInput, db: DbSession = Depends(get_db)) -> PreviewOut:
    preview = service.preview_change(db, _spec_from(payload), today=date.today())
    return PreviewOut(
        first_pay_date=preview.first_pay_date,
        periods=[
            PreviewPeriodOut(
                start_date=period.start,
                end_date=period.end,
                is_transition=period.is_transition,
                days=(period.end - period.start).days + 1,
            )
            for period in preview.periods
        ],
        transition=(
            PreviewPeriodOut(
                start_date=preview.transition.start,
                end_date=preview.transition.end,
                is_transition=True,
                days=(preview.transition.end - preview.transition.start).days + 1,
            )
            if preview.transition
            else None
        ),
        unshifted_dates=preview.unshifted,
    )


@router.post("/pay-schedule", response_model=ScheduleOut, status_code=201)
def commit_schedule(payload: ScheduleInput, db: DbSession = Depends(get_db)) -> ScheduleOut:
    schedule = service.commit_change(
        db, _spec_from(payload), today=date.today(), notes=payload.notes
    )
    return ScheduleOut.model_validate(schedule)


@router.get("/pay-periods", response_model=PeriodListOut)
def list_periods(
    db: DbSession = Depends(get_db),
    start: date | None = Query(default=None, alias="from"),
    end: date | None = Query(default=None, alias="to"),
) -> PeriodListOut:
    service.ensure_horizon(db, date.today())
    return PeriodListOut(items=[period_out(p) for p in service.list_periods(db, start, end)])


@router.get("/pay-periods/current", response_model=PeriodOut)
def get_current_period(db: DbSession = Depends(get_db)) -> PeriodOut:
    today = date.today()
    service.ensure_horizon(db, today)
    return period_out(service.current_period(db, today))
