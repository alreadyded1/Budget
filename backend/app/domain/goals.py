"""Savings goal and sinking fund math (SPEC §13, D-088 to D-091). Pure: no database, no clock.

All money is integer cents. Periods come in as (start, end) pairs, oldest first.
"""

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Literal

Span = tuple[date, date]
Status = Literal["done", "on_track", "behind", "no_target"]


@dataclass(frozen=True, slots=True)
class PeriodFlow:
    """One pay period of a sinking fund: what was planned into it and what was spent."""

    planned_cents: int
    #: Net spending in the category (a refund lowers it), so positive means money left.
    spent_cents: int


def sinking_balance(starting_cents: int, periods: Iterable[PeriodFlow]) -> int:
    """Starting balance + everything planned − everything spent (D-005, D-088).

    The balance can go negative: that is an overspent fund, and it is shown, not hidden.
    """
    return starting_cents + sum(p.planned_cents - p.spent_cents for p in periods)


def ceil_div(numerator: int, denominator: int) -> int:
    """Integer ceiling division for positive denominators."""
    return -(-numerator // denominator)


def periods_until(periods: Sequence[Span], today: date, target: date) -> int:
    """Pay periods from the one holding today through the one holding the target date.

    Counts only periods that exist; a target before today's period is 0 (overdue).
    """
    return sum(1 for start, end in periods if end >= today and start <= target)


def needed_per_period(remaining_cents: int, period_count: int) -> int:
    """What each remaining period must add to reach the target, rounded up (D-090).

    With no periods left the whole remainder is due now.
    """
    if remaining_cents <= 0:
        return 0
    if period_count <= 0:
        return remaining_cents
    return ceil_div(remaining_cents, period_count)


def projected_completion(
    remaining_cents: int,
    rate_cents: int,
    future_periods: Sequence[Span],
) -> date | None:
    """The end of the period in which the goal is reached at `rate_cents` per period.

    `future_periods` are the periods after the current one. Past the last known period the
    schedule is extended by the average length of the known ones. None when the rate
    cannot get there (zero or negative) or there is nothing to extend from.
    """
    if remaining_cents <= 0 or rate_cents <= 0 or not future_periods:
        return None
    needed = ceil_div(remaining_cents, rate_cents)
    if needed <= len(future_periods):
        return future_periods[needed - 1][1]
    days = sum((end - start).days + 1 for start, end in future_periods)
    average = max(1, round(days / len(future_periods)))
    return future_periods[-1][1] + timedelta(days=average * (needed - len(future_periods)))


def status(remaining_cents: int, target_date: date | None, projected: date | None) -> Status:
    """Done, on track (projected on or before the target date), behind, or no target date."""
    if remaining_cents <= 0:
        return "done"
    if target_date is None:
        return "no_target"
    return "on_track" if projected is not None and projected <= target_date else "behind"


def average_change(balances: Sequence[int]) -> int:
    """Average change per period across consecutive period-end balances, rounded down.

    [start, after period 1, after period 2, ...]; fewer than two points means no rate.
    """
    if len(balances) < 2:
        return 0
    return (balances[-1] - balances[0]) // (len(balances) - 1)
