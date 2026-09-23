"""Money is integer cents. This is the server half of frontend/src/lib/money.ts.

Both sides round half away from zero, and both are tested with the same cases, so a
number typed in the browser and the same number parsed from a CSV land on the same cent.
"""

import re
from decimal import Decimal, InvalidOperation

CENTS_PER_UNIT = 100

_AMOUNT = re.compile(r"^(?P<sign>[-+])?(?P<whole>\d*)(?:\.(?P<fraction>\d*))?$")
_STRIP = re.compile(r"[\s,$]")
#: Accounting style: (12.34) means -12.34, which is how plenty of banks export CSV.
_PARENTHESISED = re.compile(r"^\((?P<inner>.*)\)$")


def round_to_cents(amount: Decimal | int | float | str) -> int:
    """Round a decimal amount to whole cents, half away from zero.

    Decimal keeps this exact. A float argument is converted through its string form so
    0.1 + 0.2 style noise never reaches the rounding step.
    """
    if isinstance(amount, int):
        return amount * CENTS_PER_UNIT
    value = Decimal(str(amount)) if not isinstance(amount, Decimal) else amount

    scaled = value * CENTS_PER_UNIT
    whole = int(scaled)
    remainder = abs(scaled - whole)
    if remainder >= Decimal("0.5"):
        whole += 1 if scaled > 0 else -1
    return whole


def parse_amount(text: str) -> int | None:
    """Parse typed or imported text into signed cents. None when it is not an amount."""
    if text is None:
        return None

    cleaned = _STRIP.sub("", str(text)).strip()
    if not cleaned:
        return None

    negative_by_parens = False
    parenthesised = _PARENTHESISED.match(cleaned)
    if parenthesised is not None:
        cleaned = parenthesised.group("inner")
        negative_by_parens = True

    match = _AMOUNT.match(cleaned)
    if match is None:
        return None

    whole = match.group("whole") or ""
    fraction = match.group("fraction") or ""
    if not whole and not fraction:
        return None

    try:
        cents = int(whole or "0") * CENTS_PER_UNIT + int(fraction[:2].ljust(2, "0") or "0")
    except (ValueError, InvalidOperation):
        return None

    # A third decimal place of 5 or more rounds the cent away from zero.
    if len(fraction) > 2 and fraction[2] >= "5":
        cents += 1

    if match.group("sign") == "-" or negative_by_parens:
        cents = -cents
    return cents


def format_cents(cents: int, symbol: str = "$") -> str:
    """Format cents for display. The sign goes in front of the symbol."""
    negative = cents < 0
    absolute = abs(cents)
    text = f"{symbol}{absolute // CENTS_PER_UNIT:,}.{absolute % CENTS_PER_UNIT:02d}"
    return f"-{text}" if negative else text


def splits_balance(amount_cents: int, split_amounts: list[int]) -> bool:
    """The invariant from DATA_MODEL: splits must add up to the transaction."""
    return sum(split_amounts) == amount_cents
