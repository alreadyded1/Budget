"""Sinking fund and savings goal math (SPEC §13)."""

from datetime import date

from app.domain.goals import (
    PeriodFlow,
    average_change,
    needed_per_period,
    periods_until,
    projected_completion,
    sinking_balance,
    status,
)

D = date
# Biweekly periods from Sep 11.
PERIODS = [
    (D(2026, 9, 11), D(2026, 9, 24)),
    (D(2026, 9, 25), D(2026, 10, 8)),
    (D(2026, 10, 9), D(2026, 10, 22)),
    (D(2026, 10, 23), D(2026, 11, 5)),
    (D(2026, 11, 6), D(2026, 11, 19)),
]


class TestSinkingBalance:
    def test_it_accumulates_across_periods(self):
        flows = [PeriodFlow(5_000, 0), PeriodFlow(5_000, 1_200), PeriodFlow(5_000, 0)]
        assert sinking_balance(10_000, flows) == 10_000 + 15_000 - 1_200

    def test_one_big_bill_after_saving(self):
        # Saving 100 a period for car insurance, then paying 350 in period four.
        flows = [PeriodFlow(10_000, 0)] * 3 + [PeriodFlow(10_000, 35_000)]
        assert sinking_balance(0, flows) == 5_000

    def test_overspending_goes_negative_and_recovers(self):
        flows = [PeriodFlow(5_000, 0), PeriodFlow(5_000, 20_000)]
        assert sinking_balance(0, flows) == -10_000
        assert sinking_balance(0, [*flows, PeriodFlow(5_000, 0), PeriodFlow(5_000, 0)]) == 0

    def test_a_refund_adds_back(self):
        assert sinking_balance(0, [PeriodFlow(0, 3_000), PeriodFlow(0, -1_000)]) == -2_000

    def test_nothing_yet(self):
        assert sinking_balance(2_500, []) == 2_500


class TestNeeded:
    def test_periods_until_counts_this_one_through_the_target(self):
        assert periods_until(PERIODS, D(2026, 9, 20), D(2026, 10, 30)) == 4
        assert periods_until(PERIODS, D(2026, 9, 20), D(2026, 9, 24)) == 1
        assert periods_until(PERIODS, D(2026, 10, 1), D(2026, 9, 15)) == 0

    def test_rounded_up_so_the_target_is_reached(self):
        assert needed_per_period(100_000, 3) == 33_334
        assert needed_per_period(90_000, 3) == 30_000

    def test_done_or_overdue(self):
        assert needed_per_period(0, 3) == 0
        assert needed_per_period(-500, 3) == 0
        assert needed_per_period(12_345, 0) == 12_345


class TestProjection:
    future = PERIODS[1:]

    def test_the_period_where_the_rate_gets_there(self):
        assert projected_completion(10_000, 5_000, self.future) == D(2026, 10, 22)
        assert projected_completion(10_001, 5_000, self.future) == D(2026, 11, 5)

    def test_past_the_known_periods_it_extends_by_their_length(self):
        # 4 known periods, 6 needed: two more 14-day periods.
        assert projected_completion(30_000, 5_000, self.future) == D(2026, 12, 17)

    def test_no_rate_no_date(self):
        assert projected_completion(10_000, 0, self.future) is None
        assert projected_completion(10_000, -100, self.future) is None
        assert projected_completion(0, 5_000, self.future) is None

    def test_status(self):
        assert status(0, D(2026, 12, 1), None) == "done"
        assert status(10_000, None, D(2026, 12, 1)) == "no_target"
        assert status(10_000, D(2026, 12, 1), D(2026, 11, 19)) == "on_track"
        assert status(10_000, D(2026, 12, 1), D(2026, 12, 1)) == "on_track"
        assert status(10_000, D(2026, 12, 1), D(2026, 12, 3)) == "behind"
        assert status(10_000, D(2026, 12, 1), None) == "behind"

    def test_average_change(self):
        assert average_change([100_000, 105_000, 108_000, 115_000]) == 5_000
        assert average_change([100_000, 90_000]) == -10_000
        assert average_change([100_000]) == 0
