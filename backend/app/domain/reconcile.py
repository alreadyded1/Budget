"""Reconciliation arithmetic (SPEC §12). Pure functions over integer cents.

Every amount is in the account's own sign, so a credit card owing $512.30 has a balance of
-51230. Statements print what is owed as a positive number; `statement_balance` turns what
the user typed into the account's sign.
"""

from collections.abc import Iterable


def statement_balance(typed_cents: int, *, is_liability: bool) -> int:
    """What the user typed, as the statement prints it, in the account's sign."""
    return -typed_cents if is_liability else typed_cents


def typed_balance(balance_cents: int, *, is_liability: bool) -> int:
    """The inverse of `statement_balance`, for showing a stored statement balance."""
    return -balance_cents if is_liability else balance_cents


def cleared_balance(reconciled_cents: int, ticked_amounts: Iterable[int]) -> int:
    """The balance the bank should agree with: everything already reconciled plus the ticks."""
    return reconciled_cents + sum(ticked_amounts)


def difference(statement_cents: int, reconciled_cents: int, ticked_amounts: Iterable[int]) -> int:
    """How far the ticked balance is from the statement. Zero means it balances.

    Positive means the statement shows more money (or less owed) than the ticked rows: the
    adjustment that would close it is this amount, in the account's sign.
    """
    return statement_cents - cleared_balance(reconciled_cents, ticked_amounts)
