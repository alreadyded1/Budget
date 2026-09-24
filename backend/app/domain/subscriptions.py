"""Subscription and bill math (SPEC §9). Pure: no database, no clock.

Due dates are computed from the anchor by index, never from the previous date, so a
monthly bill on the 31st lands on Feb 28 and goes back to the 31st in March (the same
rule as pay dates, D-028). Money is integer cents; equivalents are exact fractions
rounded once, half away from zero (D-063).
"""

from collections.abc import Iterator
from dataclasses import dataclass
from datetime import date, timedelta
from fractions import Fraction

from app.domain.pay_periods import clamp_to_month

FREQUENCIES = ("weekly", "biweekly", "monthly", "quarterly", "semiannual", "annual", "custom")
UNITS = ("day", "week", "month")

#: Built-in frequencies as (unit, count).
_STEPS: dict[str, tuple[str, int]] = {
    "weekly": ("week", 1),
    "biweekly": ("week", 2),
    "monthly": ("month", 1),
    "quarterly": ("month", 3),
    "semiannual": ("month", 6),
    "annual": ("month", 12),
}

#: How many of each unit make a year, for the annual cost (D-063).
_PER_YEAR = {"day": 365, "week": 52, "month": 12}

#: Payment matching (D-064): ±3 days, and within 10% or $1.00, whichever is larger.
MATCH_DAYS = 3
MATCH_MIN_CENTS = 100
MATCH_SHARE = Fraction(1, 10)


@dataclass(frozen=True, slots=True)
class BillSchedule:
    frequency: str
    #: The first due date.
    anchor: date
    interval_count: int = 1
    interval_unit: str | None = None
    #: Month-based frequencies only; defaults to the anchor's day and clamps to month end.
    day_of_month: int | None = None
    end: date | None = None


def schedule_problem(schedule: BillSchedule) -> str | None:
    """A human-readable reason the schedule is unusable, or None."""
    if schedule.frequency not in FREQUENCIES:
        return f"Unknown frequency: {schedule.frequency}."
    if schedule.frequency == "custom":
        if schedule.interval_unit not in UNITS:
            return "A custom schedule needs a unit: day, week or month."
        if schedule.interval_count < 1:
            return "A custom schedule repeats every 1 or more units."
    if schedule.day_of_month is not None and not 1 <= schedule.day_of_month <= 31:
        return "The due day must be between 1 and 31."
    if schedule.end is not None and schedule.end < schedule.anchor:
        return "The end date is before the first due date."
    return None


def step_of(schedule: BillSchedule) -> tuple[str, int]:
    if schedule.frequency == "custom":
        return schedule.interval_unit or "month", max(1, schedule.interval_count)
    return _STEPS[schedule.frequency]


def _nth(schedule: BillSchedule, index: int) -> date:
    unit, count = step_of(schedule)
    if unit == "day":
        return schedule.anchor + timedelta(days=index * count)
    if unit == "week":
        return schedule.anchor + timedelta(weeks=index * count)
    months = schedule.anchor.month - 1 + index * count
    day = schedule.day_of_month or schedule.anchor.day
    return clamp_to_month(schedule.anchor.year + months // 12, months % 12 + 1, day)


def _dates(schedule: BillSchedule) -> Iterator[date]:
    index = 0
    while True:
        due = _nth(schedule, index)
        if schedule.end is not None and due > schedule.end:
            return
        yield due
        index += 1


def due_dates(schedule: BillSchedule, start: date, through: date) -> list[date]:
    """Every due date in [start, through], oldest first."""
    found: list[date] = []
    for due in _dates(schedule):
        if due > through:
            break
        if due >= start:
            found.append(due)
    return found


def next_due(schedule: BillSchedule, on_or_after: date) -> date | None:
    for due in _dates(schedule):
        if due >= on_or_after:
            return due
    return None


def _round(value: Fraction) -> int:
    """Half away from zero, like every other cent in the app."""
    sign = -1 if value < 0 else 1
    magnitude = abs(value)
    whole = magnitude.numerator // magnitude.denominator
    if (magnitude - whole) * 2 >= 1:
        whole += 1
    return sign * whole


def _annual_exact(schedule: BillSchedule, amount_cents: int) -> Fraction:
    unit, count = step_of(schedule)
    return Fraction(amount_cents * _PER_YEAR[unit], count)


def annual_cents(schedule: BillSchedule, amount_cents: int) -> int:
    """What the bill costs in a year: weekly × 52, every N days × 365 ÷ N, and so on."""
    return _round(_annual_exact(schedule, amount_cents))


def monthly_cents(schedule: BillSchedule, amount_cents: int) -> int:
    """The annual cost ÷ 12, rounded once at the end."""
    return _round(_annual_exact(schedule, amount_cents) / 12)


def amounts_match(bill_cents: int, paid_cents: int) -> bool:
    tolerance = max(Fraction(MATCH_MIN_CENTS), abs(bill_cents) * MATCH_SHARE)
    return abs(abs(paid_cents) - abs(bill_cents)) <= tolerance


def is_match(
    *,
    bill_payee_id: int | None,
    bill_cents: int,
    due: date,
    payee_id: int | None,
    paid_cents: int,
    paid_on: date,
) -> bool:
    """Would a transaction plausibly be this bill's payment? (SPEC §9, D-064)"""
    if bill_payee_id is None or payee_id != bill_payee_id:
        return False
    if abs((paid_on - due).days) > MATCH_DAYS:
        return False
    return amounts_match(bill_cents, paid_cents)
