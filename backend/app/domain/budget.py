"""Planned-vs-actual math for one pay period (SPEC §8). Pure: no database, no clock.

Signs follow D-054: an expense category's actual is the money that left (the negated
sum of its splits, so a refund lowers it); an income category's actual is the money
that arrived. Remaining is always planned minus actual.
"""

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Literal

Kind = Literal["expense", "income"]


def actual_for(kind: Kind, split_sum_cents: int) -> int:
    """Turn a category's signed split total into the Actual column."""
    return -split_sum_cents if kind == "expense" else split_sum_cents


def remaining(planned_cents: int, actual_cents: int) -> int:
    return planned_cents - actual_cents


def is_overspent(kind: Kind, planned_cents: int, actual_cents: int) -> bool:
    """Only spending can be overspent; income beating its plan is good news."""
    return kind == "expense" and actual_cents > planned_cents


def prorate(amount_cents: int, days: int, base_days: int) -> int:
    """Scale a per-period amount to a period of `days`, rounded half away from zero (D-055).

    Integer arithmetic throughout, so 500.00 over 6 of 14 days is exactly 214.29.
    """
    if base_days <= 0:
        raise ValueError("base_days must be positive")
    if days < 0:
        raise ValueError("days cannot be negative")
    numerator = abs(amount_cents) * days
    quotient, remainder = divmod(numerator, base_days)
    if remainder * 2 >= base_days:
        quotient += 1
    return quotient if amount_cents >= 0 else -quotient


@dataclass(frozen=True, slots=True)
class Line:
    kind: Kind
    planned_cents: int
    actual_cents: int


@dataclass(frozen=True, slots=True)
class Summary:
    expected_income_cents: int
    received_income_cents: int
    planned_expense_cents: int
    #: Expected income minus everything planned to be spent.
    left_to_plan_cents: int
    spent_cents: int
    #: Planned spending minus actual spending.
    remaining_cents: int


def summarize(lines: Iterable[Line]) -> Summary:
    expected = received = planned = spent = 0
    for line in lines:
        if line.kind == "income":
            expected += line.planned_cents
            received += line.actual_cents
        else:
            planned += line.planned_cents
            spent += line.actual_cents
    return Summary(
        expected_income_cents=expected,
        received_income_cents=received,
        planned_expense_cents=planned,
        left_to_plan_cents=expected - planned,
        spent_cents=spent,
        remaining_cents=planned - spent,
    )
