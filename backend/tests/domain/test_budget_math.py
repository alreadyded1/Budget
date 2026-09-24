"""Planned-vs-actual math and proration (SPEC §8, D-054, D-055)."""

import pytest

from app.domain.budget import (
    Line,
    actual_for,
    is_overspent,
    prorate,
    remaining,
    summarize,
)


class TestActual:
    def test_spending_reads_positive(self):
        assert actual_for("expense", -4520) == 4520

    def test_a_refund_lowers_spending_and_may_go_negative(self):
        assert actual_for("expense", -1000 + 1500) == -500

    def test_income_reads_as_received(self):
        assert actual_for("income", 250_000) == 250_000

    def test_remaining_is_planned_minus_actual(self):
        assert remaining(10_000, 12_500) == -2_500
        assert remaining(10_000, -500) == 10_500


class TestOverspent:
    def test_only_expenses_can_be_overspent(self):
        assert is_overspent("expense", 100, 101)
        assert not is_overspent("expense", 100, 100)
        assert not is_overspent("income", 100, 500)

    def test_spending_with_no_plan_is_overspent(self):
        assert is_overspent("expense", 0, 1)


class TestProrate:
    def test_the_example_from_the_plan(self):
        # 500.00 planned for a 14-day period, 6 days in the transition period.
        assert prorate(50_000, 6, 14) == 21_429

    def test_rounds_half_away_from_zero(self):
        assert prorate(1, 1, 2) == 1  # 0.5 cent rounds up
        assert prorate(3, 1, 2) == 2  # 1.5 → 2
        assert prorate(-1, 1, 2) == -1
        assert prorate(10, 1, 3) == 3  # 3.33 → 3
        assert prorate(20, 1, 3) == 7  # 6.67 → 7

    def test_whole_and_empty_periods(self):
        assert prorate(12_345, 14, 14) == 12_345
        assert prorate(12_345, 0, 14) == 0
        assert prorate(0, 6, 14) == 0

    def test_a_longer_period_scales_up(self):
        assert prorate(10_000, 21, 14) == 15_000

    def test_exact_on_large_amounts(self):
        assert prorate(999_999_999, 13, 31) == 419_354_838  # 419354838.29…

    def test_refuses_nonsense(self):
        with pytest.raises(ValueError):
            prorate(100, 1, 0)
        with pytest.raises(ValueError):
            prorate(100, -1, 14)


class TestSummary:
    def test_the_header_numbers(self):
        summary = summarize(
            [
                Line("income", planned_cents=300_000, actual_cents=150_000),
                Line("expense", planned_cents=120_000, actual_cents=80_000),
                Line("expense", planned_cents=30_000, actual_cents=45_000),
            ]
        )
        assert summary.expected_income_cents == 300_000
        assert summary.received_income_cents == 150_000
        assert summary.planned_expense_cents == 150_000
        assert summary.left_to_plan_cents == 150_000
        assert summary.spent_cents == 125_000
        assert summary.remaining_cents == 25_000

    def test_overplanning_leaves_a_negative_amount_to_plan(self):
        summary = summarize([Line("income", 1_000, 0), Line("expense", 1_500, 0)])
        assert summary.left_to_plan_cents == -500

    def test_empty(self):
        summary = summarize([])
        assert summary.remaining_cents == 0
        assert summary.left_to_plan_cents == 0
