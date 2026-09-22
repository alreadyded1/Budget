"""Pay dates and pay periods. Pure functions: no database, no clock, no I/O.

A pay period starts on a pay date and ends the day before the next pay date, so a
run of periods is contiguous by construction (SPEC §2).
"""

from calendar import monthrange
from dataclasses import dataclass
from datetime import date, timedelta
from enum import StrEnum

SATURDAY = 5
SUNDAY = 6


class Frequency(StrEnum):
    WEEKLY = "weekly"
    BIWEEKLY = "biweekly"
    SEMIMONTHLY = "semimonthly"
    MONTHLY = "monthly"


class WeekendRule(StrEnum):
    NONE = "none"
    PREVIOUS_BUSINESS_DAY = "previous_business_day"
    NEXT_BUSINESS_DAY = "next_business_day"


# The weekend rule only means something where a pay date can land on any weekday.
# Weekly and biweekly dates always fall on the anchor's weekday (SPEC §2).
DAY_OF_MONTH_FREQUENCIES = frozenset({Frequency.SEMIMONTHLY, Frequency.MONTHLY})

LAST_DAY_OF_MONTH = 31


@dataclass(frozen=True, slots=True)
class ScheduleSpec:
    """Everything the date math needs, independent of how it is stored."""

    frequency: Frequency
    effective_from: date
    anchor_date: date | None = None
    day_of_month_1: int | None = None
    day_of_month_2: int | None = None
    weekend_rule: WeekendRule = WeekendRule.NONE

    def __post_init__(self) -> None:
        problem = spec_problem(self)
        if problem is not None:
            raise ValueError(problem)

    @property
    def uses_day_of_month(self) -> bool:
        return self.frequency in DAY_OF_MONTH_FREQUENCIES


@dataclass(frozen=True, slots=True)
class Period:
    """A pay period. `end` is inclusive."""

    start: date
    end: date

    @property
    def days(self) -> int:
        return (self.end - self.start).days + 1

    def contains(self, day: date) -> bool:
        return self.start <= day <= self.end


def spec_problem(spec: "ScheduleSpec") -> str | None:
    """Why this schedule cannot be used, or None when it is fine."""
    if spec.frequency in {Frequency.WEEKLY, Frequency.BIWEEKLY}:
        if spec.anchor_date is None:
            return f"{spec.frequency} needs an anchor pay date."
        return None

    if spec.day_of_month_1 is None:
        return f"{spec.frequency} needs a day of the month."
    if not 1 <= spec.day_of_month_1 <= LAST_DAY_OF_MONTH:
        return "Day of month must be between 1 and 31."

    if spec.frequency is Frequency.SEMIMONTHLY:
        if spec.day_of_month_2 is None:
            return "Semimonthly needs two days of the month."
        if not 1 <= spec.day_of_month_2 <= LAST_DAY_OF_MONTH:
            return "Second day of month must be between 1 and 31."
        if spec.day_of_month_1 == spec.day_of_month_2:
            return "The two semimonthly days must be different."
    elif spec.day_of_month_2 is not None:
        return f"{spec.frequency} takes only one day of the month."
    return None


def clamp_to_month(year: int, month: int, day: int) -> date:
    """Day 31 in a short month becomes that month's last day. The next month is unaffected."""
    last = monthrange(year, month)[1]
    return date(year, month, min(day, last))


def is_weekend(day: date) -> bool:
    return day.weekday() >= SATURDAY


def apply_weekend_rule(day: date, rule: WeekendRule) -> date:
    """Move a weekend pay date onto a business day. Business day here means Mon-Fri."""
    if rule is WeekendRule.NONE or not is_weekend(day):
        return day
    step = -1 if rule is WeekendRule.PREVIOUS_BUSINESS_DAY else 1
    moved = day
    while is_weekend(moved):
        moved += timedelta(days=step)
    return moved


def _add_months(anchor: date, months: int) -> tuple[int, int]:
    """Return the (year, month) `months` after the anchor's month."""
    index = anchor.year * 12 + (anchor.month - 1) + months
    return divmod(index, 12)[0], divmod(index, 12)[1] + 1


def _raw_dates(spec: ScheduleSpec, first_index: int, count: int) -> list[date]:
    """Unadjusted pay dates, generated from the schedule's own origin.

    Each date is computed from the configuration rather than from the date before it,
    so a clamped month never drags later months backwards (SPEC §2: dates never drift).
    """
    if spec.frequency in {Frequency.WEEKLY, Frequency.BIWEEKLY}:
        assert spec.anchor_date is not None
        step = 7 if spec.frequency is Frequency.WEEKLY else 14
        return [spec.anchor_date + timedelta(days=step * (first_index + i)) for i in range(count)]

    assert spec.day_of_month_1 is not None
    origin = spec.effective_from
    if spec.frequency is Frequency.MONTHLY:
        dates = []
        for i in range(count):
            year, month = _add_months(origin, first_index + i)
            dates.append(clamp_to_month(year, month, spec.day_of_month_1))
        return dates

    assert spec.day_of_month_2 is not None
    days = sorted((spec.day_of_month_1, spec.day_of_month_2))
    dates = []
    for i in range(count):
        month_offset, slot = divmod(first_index + i, 2)
        year, month = _add_months(origin, month_offset)
        dates.append(clamp_to_month(year, month, days[slot]))
    return dates


def _adjusted(
    spec: ScheduleSpec, raw_dates: list[date], previous: date | None
) -> tuple[list[date], list[date]]:
    """Apply the weekend rule, keeping pay dates strictly increasing.

    Two things can break the ordering, and both are resolved in favour of a clean timeline:

    * A shifted date landing on or before the date before it. The unshifted date is kept
      instead, and the date is reported in the returned `skipped` list.
    * Two configured days clamping onto the same date, which is what semimonthly 30 & 31
      does every February. The duplicate is dropped, so that month has one pay date.
    """
    adjusted: list[date] = []
    skipped: list[date] = []
    shift = spec.uses_day_of_month and spec.weekend_rule is not WeekendRule.NONE
    last = previous
    for raw in raw_dates:
        moved = apply_weekend_rule(raw, spec.weekend_rule) if shift else raw
        if last is not None and moved <= last:
            # Shifting broke the order; the configured date keeps it.
            if raw > last:
                moved = raw
                skipped.append(raw)
            else:
                continue  # Same date twice after clamping: one pay date, not two.
        adjusted.append(moved)
        last = moved
    return adjusted, skipped


@dataclass(frozen=True, slots=True)
class PayDates:
    dates: list[date]
    #: Dates where the weekend rule was skipped to keep the sequence increasing.
    unshifted: list[date]


def pay_dates(spec: ScheduleSpec, count: int) -> PayDates:
    """The first `count` pay dates of a schedule, starting at its effective date.

    Generation always starts from the schedule's own origin, so the same schedule yields
    the same dates no matter how many are asked for.
    """
    if count <= 0:
        return PayDates([], [])

    # One extra date before the window seeds the ordering guard, then is dropped.
    lookbehind = 2
    raw = _raw_dates(spec, -lookbehind, count + lookbehind + 8)
    adjusted, skipped = _adjusted(spec, raw, previous=None)

    in_range = [day for day in adjusted if day >= spec.effective_from]
    while len(in_range) < count:
        raw = _raw_dates(spec, -lookbehind, len(raw) + count * 2)
        adjusted, skipped = _adjusted(spec, raw, previous=None)
        in_range = [day for day in adjusted if day >= spec.effective_from]

    wanted = in_range[:count]
    return PayDates(wanted, [day for day in skipped if day >= spec.effective_from])


def build_periods(dates: list[date]) -> list[Period]:
    """Turn N+1 pay dates into N periods. Each ends the day before the next begins."""
    return [
        Period(start=dates[i], end=dates[i + 1] - timedelta(days=1)) for i in range(len(dates) - 1)
    ]


def periods_from(spec: ScheduleSpec, count: int) -> list[Period]:
    """`count` contiguous periods starting at the schedule's first pay date."""
    return build_periods(pay_dates(spec, count + 1).dates)


def period_for_date(periods: list[Period], day: date) -> Period | None:
    for period in periods:
        if period.contains(day):
            return period
    return None


def pay_dates_through(spec: ScheduleSpec, until: date) -> PayDates:
    """Every pay date from the schedule's start through `until`, inclusive."""
    if until < spec.effective_from:
        return PayDates([], [])

    span_days = (until - spec.effective_from).days + 1
    shortest_step = {
        Frequency.WEEKLY: 7,
        Frequency.BIWEEKLY: 14,
        Frequency.SEMIMONTHLY: 13,
        Frequency.MONTHLY: 28,
    }[spec.frequency]
    count = span_days // shortest_step + 2

    result = pay_dates(spec, count)
    while result.dates and result.dates[-1] <= until:
        count *= 2
        result = pay_dates(spec, count)
    kept = [day for day in result.dates if day <= until]
    return PayDates(kept, [day for day in result.unshifted if day <= until])


def pay_dates_in_year(spec: ScheduleSpec, year: int) -> list[date]:
    """Every pay date landing in a calendar year. Used for the 26/27 biweekly check."""
    found = pay_dates_through(spec, date(year, 12, 31)).dates
    return [day for day in found if day.year == year]
