"""Pay schedule storage and the period timeline it produces.

All date arithmetic lives in app.domain.pay_periods; this module only decides what to
keep, what to rebuild, and what to write.
"""

from dataclasses import dataclass
from datetime import date, timedelta

from sqlalchemy import delete, select
from sqlalchemy.orm import Session as DbSession

from app.domain.pay_periods import (
    Frequency,
    Period,
    ScheduleSpec,
    WeekendRule,
    build_periods,
    pay_dates,
    pay_dates_through,
    spec_problem,
)
from app.errors import AppError
from app.models import PayPeriod, PaySchedule

#: How far ahead the timeline is kept (SPEC §2: "about 13 months ahead").
HORIZON_DAYS = 400
#: Periods are extended once the timeline runs closer than this to its end.
EXTEND_WHEN_WITHIN_DAYS = 120


def to_spec(schedule: PaySchedule) -> ScheduleSpec:
    return ScheduleSpec(
        frequency=Frequency(schedule.frequency),
        effective_from=schedule.effective_from,
        anchor_date=schedule.anchor_date,
        day_of_month_1=schedule.day_of_month_1,
        day_of_month_2=schedule.day_of_month_2,
        weekend_rule=WeekendRule(schedule.weekend_rule),
    )


def spec_from_input(
    frequency: str,
    effective_from: date,
    anchor_date: date | None,
    day_of_month_1: int | None,
    day_of_month_2: int | None,
    weekend_rule: str,
) -> ScheduleSpec:
    """Build a validated spec, turning a bad combination into a 422."""
    try:
        spec = ScheduleSpec(
            frequency=Frequency(frequency),
            effective_from=effective_from,
            anchor_date=anchor_date,
            day_of_month_1=day_of_month_1,
            day_of_month_2=day_of_month_2,
            weekend_rule=WeekendRule(weekend_rule),
        )
    except ValueError as exc:
        raise AppError(422, str(exc), "invalid_schedule") from exc
    return spec


def current_schedule(db: DbSession) -> PaySchedule | None:
    """The newest schedule row. Later rows supersede earlier ones from their effective date."""
    return db.scalars(select(PaySchedule).order_by(PaySchedule.effective_from.desc())).first()


def schedule_history(db: DbSession) -> list[PaySchedule]:
    return list(db.scalars(select(PaySchedule).order_by(PaySchedule.effective_from.desc())))


def require_schedule(db: DbSession) -> PaySchedule:
    schedule = current_schedule(db)
    if schedule is None:
        raise AppError(404, "No pay schedule has been set up yet.", "no_pay_schedule")
    return schedule


def list_periods(db: DbSession, start: date | None, end: date | None) -> list[PayPeriod]:
    """Periods overlapping the window, oldest first."""
    query = select(PayPeriod).order_by(PayPeriod.start_date)
    if start is not None:
        query = query.where(PayPeriod.end_date >= start)
    if end is not None:
        query = query.where(PayPeriod.start_date <= end)
    return list(db.scalars(query))


def period_containing(db: DbSession, day: date) -> PayPeriod | None:
    return db.scalars(
        select(PayPeriod).where(PayPeriod.start_date <= day, PayPeriod.end_date >= day)
    ).first()


def current_period(db: DbSession, today: date) -> PayPeriod:
    period = period_containing(db, today)
    if period is None:
        require_schedule(db)
        raise AppError(
            404, "No pay period covers today. Regenerate the schedule.", "no_current_period"
        )
    return period


@dataclass(frozen=True, slots=True)
class PreviewPeriod:
    start: date
    end: date
    is_transition: bool


@dataclass(frozen=True, slots=True)
class SchedulePreview:
    periods: list[PreviewPeriod]
    #: Pay dates where the weekend rule was skipped to keep the timeline in order.
    unshifted: list[date]
    #: The period the change cuts short, if any.
    transition: PreviewPeriod | None
    first_pay_date: date


def _generated_periods(spec: ScheduleSpec, through: date) -> list[Period]:
    """Periods covering the spec's start through `through`, plus one to close the last."""
    found = pay_dates_through(spec, through).dates
    # One date past the horizon so the final period has an end to sit against.
    wanted = max(len(found) + 1, 2)
    return build_periods(pay_dates(spec, wanted).dates)


def preview_change(
    db: DbSession, spec: ScheduleSpec, today: date, count: int = 6
) -> SchedulePreview:
    """What committing this schedule would produce. Writes nothing."""
    _validate_effective_from(db, spec, today)

    generated = _generated_periods(spec, spec.effective_from + timedelta(days=HORIZON_DAYS))
    first_pay_date = spec.effective_from if not generated else generated[0].start

    transition: PreviewPeriod | None = None
    open_period = period_containing(db, first_pay_date)
    if open_period is not None and open_period.start_date < first_pay_date:
        transition = PreviewPeriod(
            start=open_period.start_date,
            end=first_pay_date - timedelta(days=1),
            is_transition=True,
        )

    upcoming = [
        PreviewPeriod(start=period.start, end=period.end, is_transition=False)
        for period in generated[:count]
    ]
    unshifted = pay_dates_through(
        spec, spec.effective_from + timedelta(days=HORIZON_DAYS)
    ).unshifted

    return SchedulePreview(
        periods=upcoming,
        unshifted=unshifted,
        transition=transition,
        first_pay_date=first_pay_date,
    )


def _validate_effective_from(db: DbSession, spec: ScheduleSpec, today: date) -> None:
    """A change may reach back into the period in progress, but never rewrite a closed one."""
    problem = spec_problem(spec)
    if problem is not None:
        raise AppError(422, problem, "invalid_schedule")

    open_period = period_containing(db, today)
    if open_period is None:
        return

    if spec.effective_from <= open_period.start_date:
        raise AppError(
            409,
            "A schedule change cannot start on or before the current period's first day; "
            "that would rewrite a period that has already begun.",
            "effective_from_too_early",
        )
    if spec.effective_from > open_period.end_date:
        # Starting in a future period is fine; there is simply no transition period.
        return


def commit_change(
    db: DbSession, spec: ScheduleSpec, today: date, notes: str | None = None
) -> PaySchedule:
    """Store the schedule, close the period in progress, and rebuild everything after it."""
    _validate_effective_from(db, spec, today)

    existing = db.scalars(
        select(PaySchedule).where(PaySchedule.effective_from == spec.effective_from)
    ).first()
    if existing is not None:
        raise AppError(
            409,
            "A schedule change already starts on that date.",
            "effective_from_taken",
        )

    schedule = PaySchedule(
        frequency=str(spec.frequency),
        anchor_date=spec.anchor_date,
        day_of_month_1=spec.day_of_month_1,
        day_of_month_2=spec.day_of_month_2,
        weekend_rule=str(spec.weekend_rule),
        effective_from=spec.effective_from,
        notes=notes,
    )
    db.add(schedule)
    db.flush()

    generated = _generated_periods(spec, spec.effective_from + timedelta(days=HORIZON_DAYS))
    first_pay_date = generated[0].start if generated else spec.effective_from

    # Everything from the new first pay date onwards is rebuilt; earlier periods stand.
    db.execute(delete(PayPeriod).where(PayPeriod.start_date >= first_pay_date))

    open_period = period_containing(db, first_pay_date)
    if open_period is not None and open_period.start_date < first_pay_date:
        # The period in progress now ends the day before the new schedule starts.
        open_period.end_date = first_pay_date - timedelta(days=1)
        open_period.is_transition = True

    for period in generated:
        db.add(
            PayPeriod(
                start_date=period.start,
                end_date=period.end,
                schedule_id=schedule.id,
                is_transition=False,
            )
        )

    db.commit()
    db.refresh(schedule)
    return schedule


def ensure_horizon(db: DbSession, today: date) -> int:
    """Extend the timeline when it runs short. Returns how many periods were added."""
    schedule = current_schedule(db)
    if schedule is None:
        return 0

    last = db.scalars(select(PayPeriod).order_by(PayPeriod.end_date.desc())).first()
    if last is None:
        return 0

    wanted_through = today + timedelta(days=HORIZON_DAYS)
    if last.end_date >= today + timedelta(days=EXTEND_WHEN_WITHIN_DAYS):
        return 0

    spec = to_spec(schedule)
    generated = _generated_periods(spec, wanted_through)
    added = 0
    for period in generated:
        if period.start <= last.end_date:
            continue
        db.add(
            PayPeriod(
                start_date=period.start,
                end_date=period.end,
                schedule_id=schedule.id,
                is_transition=False,
            )
        )
        added += 1
    if added:
        db.commit()
    return added
