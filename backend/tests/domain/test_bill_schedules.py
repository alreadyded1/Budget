"""Bill schedules, equivalents and payment matching (SPEC §9, D-063, D-064)."""

from datetime import date, timedelta

import pytest

from app.domain.subscriptions import (
    BillSchedule,
    amounts_match,
    annual_cents,
    due_dates,
    is_match,
    monthly_cents,
    next_due,
    schedule_problem,
)


def dates(schedule, start, through):
    return [d.isoformat() for d in due_dates(schedule, start, through)]


class TestMonthlyOnThe31st:
    schedule = BillSchedule("monthly", date(2026, 1, 31))

    def test_it_clamps_and_comes_back(self):
        assert dates(self.schedule, date(2026, 1, 1), date(2026, 5, 31)) == [
            "2026-01-31",
            "2026-02-28",
            "2026-03-31",
            "2026-04-30",
            "2026-05-31",
        ]

    def test_a_leap_february(self):
        assert dates(self.schedule, date(2028, 2, 1), date(2028, 3, 31)) == [
            "2028-02-29",
            "2028-03-31",
        ]

    def test_it_never_drifts_over_years(self):
        found = due_dates(self.schedule, date(2026, 1, 1), date(2036, 12, 31))
        assert len(found) == 132
        for due in found:
            following = due + timedelta(days=1)
            assert following.day == 1, f"{due} is not a month end"

    def test_an_explicit_due_day_beats_the_anchor_day(self):
        schedule = BillSchedule("monthly", date(2026, 1, 15), day_of_month=31)
        assert dates(schedule, date(2026, 2, 1), date(2026, 3, 31)) == ["2026-02-28", "2026-03-31"]


class TestAnnual:
    def test_once_a_year(self):
        schedule = BillSchedule("annual", date(2026, 3, 15))
        assert dates(schedule, date(2026, 1, 1), date(2028, 12, 31)) == [
            "2026-03-15",
            "2027-03-15",
            "2028-03-15",
        ]

    def test_feb_29_falls_back_in_common_years(self):
        schedule = BillSchedule("annual", date(2028, 2, 29))
        assert dates(schedule, date(2028, 1, 1), date(2032, 12, 31)) == [
            "2028-02-29",
            "2029-02-28",
            "2030-02-28",
            "2031-02-28",
            "2032-02-29",
        ]


class TestCustom:
    def test_every_six_weeks(self):
        schedule = BillSchedule("custom", date(2026, 1, 5), interval_count=6, interval_unit="week")
        found = due_dates(schedule, date(2026, 1, 1), date(2026, 12, 31))
        assert [d.isoformat() for d in found[:3]] == ["2026-01-05", "2026-02-16", "2026-03-30"]
        assert all((b - a).days == 42 for a, b in zip(found, found[1:], strict=False))
        assert all(d.weekday() == 0 for d in found)  # always a Monday
        assert len(found) == 9

    def test_every_45_days(self):
        schedule = BillSchedule("custom", date(2026, 1, 1), interval_count=45, interval_unit="day")
        assert dates(schedule, date(2026, 1, 1), date(2026, 4, 30)) == [
            "2026-01-01",
            "2026-02-15",
            "2026-04-01",
        ]

    def test_every_two_months_from_the_31st(self):
        schedule = BillSchedule(
            "custom", date(2026, 8, 31), interval_count=2, interval_unit="month"
        )
        assert dates(schedule, date(2026, 1, 1), date(2027, 4, 30)) == [
            "2026-08-31",
            "2026-10-31",
            "2026-12-31",
            "2027-02-28",
            "2027-04-30",
        ]


class TestWindowAndEnd:
    def test_nothing_before_the_first_due_date(self):
        schedule = BillSchedule("weekly", date(2026, 9, 10))
        assert dates(schedule, date(2026, 9, 1), date(2026, 9, 20)) == ["2026-09-10", "2026-09-17"]

    def test_the_window_is_inclusive(self):
        schedule = BillSchedule("biweekly", date(2026, 9, 4))
        assert dates(schedule, date(2026, 9, 18), date(2026, 10, 2)) == ["2026-09-18", "2026-10-02"]

    def test_an_end_date_stops_it(self):
        schedule = BillSchedule("monthly", date(2026, 1, 10), end=date(2026, 3, 10))
        assert dates(schedule, date(2026, 1, 1), date(2027, 1, 1)) == [
            "2026-01-10",
            "2026-02-10",
            "2026-03-10",
        ]
        assert next_due(schedule, date(2026, 3, 11)) is None

    def test_next_due(self):
        schedule = BillSchedule("quarterly", date(2026, 1, 31))
        assert next_due(schedule, date(2026, 5, 1)) == date(2026, 7, 31)
        assert next_due(schedule, date(2026, 4, 30)) == date(2026, 4, 30)


class TestProblems:
    @pytest.mark.parametrize(
        ("schedule", "fragment"),
        [
            (BillSchedule("hourly", date(2026, 1, 1)), "Unknown frequency"),
            (BillSchedule("custom", date(2026, 1, 1), interval_unit="year"), "unit"),
            (BillSchedule("custom", date(2026, 1, 1), 0, "day"), "1 or more"),
            (BillSchedule("monthly", date(2026, 1, 1), day_of_month=32), "between 1 and 31"),
            (BillSchedule("monthly", date(2026, 2, 1), end=date(2026, 1, 1)), "end date"),
        ],
    )
    def test_bad_schedules_are_named(self, schedule, fragment):
        assert fragment in schedule_problem(schedule)

    def test_a_good_one_passes(self):
        assert schedule_problem(BillSchedule("monthly", date(2026, 1, 31))) is None


class TestEquivalents:
    @pytest.mark.parametrize(
        ("frequency", "unit", "count", "annual", "monthly"),
        [
            ("weekly", None, 1, 52_000, 4_333),  # 520 / 12 = 43.333…
            ("biweekly", None, 1, 26_000, 2_167),  # 216.666… → 216.67
            ("monthly", None, 1, 12_000, 1_000),
            ("quarterly", None, 1, 4_000, 333),
            ("semiannual", None, 1, 2_000, 167),
            ("annual", None, 1, 1_000, 83),
            ("custom", "day", 45, 8_111, 676),  # 1000 × 365 / 45 = 8111.1…
            ("custom", "week", 6, 8_667, 722),  # 1000 × 52 / 6 = 8666.6…
            ("custom", "month", 2, 6_000, 500),
        ],
    )
    def test_annual_is_exact_and_monthly_is_a_twelfth(
        self, frequency, unit, count, annual, monthly
    ):
        schedule = BillSchedule(frequency, date(2026, 1, 1), count, unit)
        assert annual_cents(schedule, 1_000) == annual
        assert monthly_cents(schedule, 1_000) == monthly

    def test_monthly_rounds_the_exact_value_not_the_rounded_annual(self):
        schedule = BillSchedule("custom", date(2026, 1, 1), 7, "day")
        # 1 cent every 7 days: annual 52.142…, monthly 4.345… → 4
        assert annual_cents(schedule, 1) == 52
        assert monthly_cents(schedule, 1) == 4

    def test_half_cents_round_away_from_zero(self):
        schedule = BillSchedule("custom", date(2026, 1, 1), 2, "month")
        assert annual_cents(schedule, 1) == 6
        assert monthly_cents(schedule, 1) == 1  # 0.5 → 1


class TestMatching:
    base = {"bill_payee_id": 7, "bill_cents": 1_599, "due": date(2026, 9, 15), "payee_id": 7}

    def test_same_payee_close_amount_close_date(self):
        assert is_match(**self.base, paid_cents=-1_599, paid_on=date(2026, 9, 15))
        assert is_match(**self.base, paid_cents=-1_699, paid_on=date(2026, 9, 18))
        assert is_match(**self.base, paid_cents=-1_499, paid_on=date(2026, 9, 12))

    def test_too_far_in_time(self):
        assert not is_match(**self.base, paid_cents=-1_599, paid_on=date(2026, 9, 19))
        assert not is_match(**self.base, paid_cents=-1_599, paid_on=date(2026, 9, 11))

    def test_another_payee_or_none(self):
        assert not is_match(
            **{**self.base, "payee_id": 8}, paid_cents=-1_599, paid_on=date(2026, 9, 15)
        )
        assert not is_match(
            **{**self.base, "bill_payee_id": None, "payee_id": None},
            paid_cents=-1_599,
            paid_on=date(2026, 9, 15),
        )

    def test_the_amount_window_is_ten_percent_or_a_dollar(self):
        # Small bill: $1.00 wins over 10%.
        assert amounts_match(500, 600)
        assert not amounts_match(500, 601)
        # Large bill: 10% wins over $1.00.
        assert amounts_match(120_000, 132_000)
        assert not amounts_match(120_000, 132_001)
        assert amounts_match(120_000, -108_000)  # the sign of the payment does not matter
