"""Report date presets (SPEC §16): Jan 1, month-end, and inside a transition period."""

from datetime import date

import pytest

from app.domain.date_ranges import Preset, RangeError, months_between, resolve

D = date

# Biweekly, then a switch to semimonthly on Sep 15: Sep 5–14 is the transition period.
PERIODS = [
    (D(2025, 12, 19), D(2026, 1, 1)),
    (D(2026, 1, 2), D(2026, 1, 15)),
    (D(2026, 8, 22), D(2026, 9, 4)),
    (D(2026, 9, 5), D(2026, 9, 14)),  # transition
    (D(2026, 9, 15), D(2026, 9, 29)),
    (D(2026, 9, 30), D(2026, 10, 14)),
]


class TestJanuaryFirst:
    today = D(2026, 1, 1)

    def test_calendar_presets(self):
        assert resolve(Preset.MONTH_TO_DATE, self.today) == (D(2026, 1, 1), D(2026, 1, 1))
        assert resolve(Preset.YEAR_TO_DATE, self.today) == (D(2026, 1, 1), D(2026, 1, 1))
        assert resolve(Preset.LAST_MONTH, self.today) == (D(2025, 12, 1), D(2025, 12, 31))
        assert resolve(Preset.LAST_YEAR, self.today) == (D(2025, 1, 1), D(2025, 12, 31))

    def test_a_period_that_spans_new_year_is_taken_whole(self):
        assert resolve(Preset.THIS_PERIOD, self.today, PERIODS) == (D(2025, 12, 19), D(2026, 1, 1))
        with pytest.raises(RangeError):
            resolve(Preset.LAST_PERIOD, self.today, PERIODS)


class TestMonthEnd:
    def test_last_month_from_the_31st_and_from_march(self):
        assert resolve(Preset.LAST_MONTH, D(2026, 10, 31)) == (D(2026, 9, 1), D(2026, 9, 30))
        assert resolve(Preset.LAST_MONTH, D(2024, 3, 31)) == (D(2024, 2, 1), D(2024, 2, 29))
        assert resolve(Preset.MONTH_TO_DATE, D(2026, 9, 30)) == (D(2026, 9, 1), D(2026, 9, 30))

    def test_the_last_day_of_a_period_is_still_inside_it(self):
        assert resolve(Preset.THIS_PERIOD, D(2026, 9, 29), PERIODS) == PERIODS[4]
        assert resolve(Preset.THIS_PERIOD, D(2026, 9, 30), PERIODS) == PERIODS[5]


class TestTransitionPeriod:
    def test_inside_the_transition_it_is_this_period(self):
        assert resolve(Preset.THIS_PERIOD, D(2026, 9, 10), PERIODS) == (
            D(2026, 9, 5),
            D(2026, 9, 14),
        )
        assert resolve(Preset.LAST_PERIOD, D(2026, 9, 10), PERIODS) == (
            D(2026, 8, 22),
            D(2026, 9, 4),
        )

    def test_after_it_the_transition_is_the_last_period(self):
        assert resolve(Preset.LAST_PERIOD, D(2026, 9, 20), PERIODS) == (
            D(2026, 9, 5),
            D(2026, 9, 14),
        )


class TestCustomAndErrors:
    def test_custom(self):
        span = (D(2026, 2, 3), D(2026, 4, 5))
        assert resolve("custom", D(2026, 9, 1), custom=span) == span
        with pytest.raises(RangeError):
            resolve("custom", D(2026, 9, 1), custom=(D(2026, 4, 5), D(2026, 2, 3)))
        with pytest.raises(RangeError):
            resolve("custom", D(2026, 9, 1))

    def test_no_period_covers_today(self):
        with pytest.raises(RangeError):
            resolve(Preset.THIS_PERIOD, D(2030, 1, 1), PERIODS)

    def test_unknown_preset(self):
        with pytest.raises(ValueError):
            resolve("next_decade", D(2026, 1, 1))


def test_months_between_clips_the_edges():
    assert months_between(D(2026, 1, 15), D(2026, 3, 10)) == [
        (D(2026, 1, 15), D(2026, 1, 31)),
        (D(2026, 2, 1), D(2026, 2, 28)),
        (D(2026, 3, 1), D(2026, 3, 10)),
    ]
    assert months_between(D(2026, 12, 20), D(2027, 1, 2)) == [
        (D(2026, 12, 20), D(2026, 12, 31)),
        (D(2027, 1, 1), D(2027, 1, 2)),
    ]
