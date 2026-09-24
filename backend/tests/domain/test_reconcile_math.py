"""Reconciliation arithmetic (SPEC §12)."""

from app.domain.reconcile import cleared_balance, difference, statement_balance, typed_balance


def test_an_asset_statement_is_taken_as_typed():
    assert statement_balance(125_000, is_liability=False) == 125_000
    assert statement_balance(-2_000, is_liability=False) == -2_000  # overdrawn


def test_a_liability_statement_is_what_is_owed():
    assert statement_balance(51_230, is_liability=True) == -51_230
    assert statement_balance(-2_000, is_liability=True) == 2_000  # a credit balance
    assert typed_balance(-51_230, is_liability=True) == 51_230


def test_difference_is_zero_when_the_ticks_add_up():
    assert cleared_balance(100_000, [-4_520, 250_000]) == 345_480
    assert difference(345_480, 100_000, [-4_520, 250_000]) == 0


def test_difference_signs_the_adjustment():
    # The bank has $10 more than the ticked rows: a +$10 adjustment closes it.
    assert difference(101_000, 100_000, []) == 1_000
    # A card statement owes $50 more than the ticked rows: a -$50 adjustment.
    assert difference(statement_balance(55_000, is_liability=True), -50_000, []) == -5_000


def test_nothing_ticked_compares_with_the_reconciled_balance():
    assert difference(0, 0, []) == 0
