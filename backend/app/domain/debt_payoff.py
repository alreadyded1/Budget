"""Debt payoff simulator (SPEC §14, D-096 to D-098). Pure: no database, no clock.

Every amount is integer cents and every balance here is the positive amount owed. Each month:

1. Interest = balance × APR ÷ 12, rounded to the cent (half away from zero), is added.
2. Every debt still owing gets its minimum payment (or just what it owes, if less).
3. What is left of the monthly budget goes to the first debt in the strategy's order, and
   anything past its balance to the next. The budget is every debt's minimum plus the extra,
   so a paid-off debt's minimum rolls on to the others (the snowball).

These are estimates: minimums are fixed as entered and interest compounds monthly.
"""

from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Literal

Strategy = Literal["snowball", "avalanche", "custom"]

#: A plan that cannot finish stops here (D-098).
MAX_MONTHS = 600


@dataclass(frozen=True, slots=True)
class Debt:
    id: int
    name: str
    balance_cents: int
    #: Annual rate in basis points: 1999 is 19.99%.
    apr_bps: int
    min_payment_cents: int


@dataclass(frozen=True, slots=True)
class Line:
    debt_id: int
    interest_cents: int
    payment_cents: int
    balance_cents: int


@dataclass(frozen=True, slots=True)
class Month:
    index: int
    year: int
    month: int
    lines: tuple[Line, ...]

    @property
    def label(self) -> str:
        return f"{self.year:04d}-{self.month:02d}"


@dataclass(slots=True)
class Result:
    strategy: Strategy
    order: list[int]
    months: list[Month] = field(default_factory=list)
    #: Month index (1-based) each debt reached zero, or None if it never did.
    payoff_month: dict[int, int | None] = field(default_factory=dict)
    total_interest_cents: int = 0
    total_paid_cents: int = 0
    finished: bool = False

    @property
    def month_count(self) -> int:
        return len(self.months)


def monthly_interest(balance_cents: int, apr_bps: int) -> int:
    """balance × apr_bps / 10,000 / 12, rounded half away from zero, in integers only."""
    numerator = balance_cents * apr_bps
    denominator = 120_000
    quotient, remainder = divmod(abs(numerator), denominator)
    if remainder * 2 >= denominator:
        quotient += 1
    return quotient if numerator >= 0 else -quotient


def order_for(strategy: Strategy, debts: Sequence[Debt], custom: Sequence[int] = ()) -> list[int]:
    """The payoff order, fixed from today's balances (D-097)."""
    if strategy == "snowball":
        ranked = sorted(debts, key=lambda d: (d.balance_cents, -d.apr_bps, d.id))
    elif strategy == "avalanche":
        ranked = sorted(debts, key=lambda d: (-d.apr_bps, d.balance_cents, d.id))
    else:
        known = {d.id for d in debts}
        chosen = [debt_id for debt_id in dict.fromkeys(custom) if debt_id in known]
        rest = [d.id for d in sorted(debts, key=lambda d: d.id) if d.id not in chosen]
        return chosen + rest
    return [d.id for d in ranked]


def _next_month(year: int, month: int) -> tuple[int, int]:
    return (year + 1, 1) if month == 12 else (year, month + 1)


def simulate(
    debts: Sequence[Debt],
    extra_cents: int,
    strategy: Strategy,
    *,
    start: tuple[int, int],
    custom_order: Sequence[int] = (),
    max_months: int = MAX_MONTHS,
) -> Result:
    """Run the plan month by month from `start` (year, month), the first month paid."""
    if extra_cents < 0:
        raise ValueError("The extra payment cannot be negative.")
    order = order_for(strategy, debts, custom_order)
    result = Result(strategy=strategy, order=order)
    balances = {d.id: max(d.balance_cents, 0) for d in debts}
    by_id = {d.id: d for d in debts}
    budget = sum(d.min_payment_cents for d in debts) + extra_cents
    for debt in debts:
        result.payoff_month[debt.id] = 0 if balances[debt.id] == 0 else None

    year, month = start
    index = 0
    while any(balances.values()) and index < max_months:
        index += 1
        interest = {}
        for debt_id, balance in balances.items():
            charge = monthly_interest(balance, by_id[debt_id].apr_bps) if balance else 0
            interest[debt_id] = charge
            balances[debt_id] = balance + charge

        paid = dict.fromkeys(balances, 0)
        for debt_id, balance in balances.items():
            if balance:
                paid[debt_id] = min(by_id[debt_id].min_payment_cents, balance)
        left = budget - sum(paid.values())
        for debt_id in order:
            if left <= 0:
                break
            owing = balances[debt_id] - paid[debt_id]
            if owing <= 0:
                continue
            step = min(left, owing)
            paid[debt_id] += step
            left -= step

        lines = []
        for debt_id in order:
            balances[debt_id] -= paid[debt_id]
            if balances[debt_id] == 0 and result.payoff_month[debt_id] is None:
                result.payoff_month[debt_id] = index
            lines.append(Line(debt_id, interest[debt_id], paid[debt_id], balances[debt_id]))
        result.months.append(Month(index, year, month, tuple(lines)))
        result.total_interest_cents += sum(interest.values())
        result.total_paid_cents += sum(paid.values())
        year, month = _next_month(year, month)

    result.finished = not any(balances.values())
    return result
