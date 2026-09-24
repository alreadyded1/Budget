"""Report date presets (SPEC §16, D-083). Pure functions over plain calendar dates.

A pay-period preset takes the whole period, start to end, the way the planner shows it.
"To date" presets stop at today. Periods come in as (start, end) pairs, oldest first; a
transition period is just a period with unusual dates, so it needs no special case.
"""

from collections.abc import Sequence
from datetime import date, timedelta
from enum import StrEnum

Span = tuple[date, date]


class Preset(StrEnum):
    THIS_PERIOD = "this_period"
    LAST_PERIOD = "last_period"
    MONTH_TO_DATE = "month_to_date"
    LAST_MONTH = "last_month"
    YEAR_TO_DATE = "year_to_date"
    LAST_YEAR = "last_year"
    CUSTOM = "custom"


class RangeError(ValueError):
    """The preset cannot be resolved (no pay periods, or a bad custom range)."""


def _containing(periods: Sequence[Span], day: date) -> int | None:
    for index, (start, end) in enumerate(periods):
        if start <= day <= end:
            return index
    return None


def resolve(
    preset: Preset | str,
    today: date,
    periods: Sequence[Span] = (),
    custom: Span | None = None,
) -> Span:
    """The inclusive (start, end) a preset means on `today`."""
    preset = Preset(preset)
    if preset is Preset.CUSTOM:
        if custom is None:
            raise RangeError("A custom range needs a start and an end date.")
        start, end = custom
        if start > end:
            raise RangeError("The start date is after the end date.")
        return start, end

    if preset in (Preset.THIS_PERIOD, Preset.LAST_PERIOD):
        index = _containing(periods, today)
        if index is None:
            raise RangeError("No pay period covers today.")
        if preset is Preset.LAST_PERIOD:
            index -= 1
            if index < 0:
                raise RangeError("There is no pay period before this one.")
        return periods[index]

    if preset is Preset.MONTH_TO_DATE:
        return today.replace(day=1), today
    if preset is Preset.LAST_MONTH:
        last_day = today.replace(day=1) - timedelta(days=1)
        return last_day.replace(day=1), last_day
    if preset is Preset.YEAR_TO_DATE:
        return date(today.year, 1, 1), today
    return date(today.year - 1, 1, 1), date(today.year - 1, 12, 31)  # LAST_YEAR


def months_between(start: date, end: date) -> list[Span]:
    """Calendar months touching [start, end], each clipped to the range."""
    spans: list[Span] = []
    cursor = start.replace(day=1)
    while cursor <= end:
        following = (cursor.replace(day=28) + timedelta(days=4)).replace(day=1)
        spans.append((max(cursor, start), min(following - timedelta(days=1), end)))
        cursor = following
    return spans
