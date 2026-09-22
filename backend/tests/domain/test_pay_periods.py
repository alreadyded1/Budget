"""Pay date and pay period math. These are the cases the build plan calls out by name."""

from datetime import date, timedelta

import pytest

from app.domain.pay_periods import (
    Frequency,
    ScheduleSpec,
    WeekendRule,
    apply_weekend_rule,
    build_periods,
    clamp_to_month,
    pay_dates,
    pay_dates_in_year,
    period_for_date,
    periods_from,
)


def monthly(day: int, *, start: date, rule: WeekendRule = WeekendRule.NONE) -> ScheduleSpec:
    return ScheduleSpec(
        frequency=Frequency.MONTHLY, effective_from=start, day_of_month_1=day, weekend_rule=rule
    )


def semimonthly(
    first: int, second: int, *, start: date, rule: WeekendRule = WeekendRule.NONE
) -> ScheduleSpec:
    return ScheduleSpec(
        frequency=Frequency.SEMIMONTHLY,
        effective_from=start,
        day_of_month_1=first,
        day_of_month_2=second,
        weekend_rule=rule,
    )


def biweekly(anchor: date) -> ScheduleSpec:
    return ScheduleSpec(frequency=Frequency.BIWEEKLY, effective_from=anchor, anchor_date=anchor)


class TestMonthEndClamp:
    def test_the_31st_clamps_and_then_recovers(self):
        dates = pay_dates(monthly(31, start=date(2026, 1, 1)), 4).dates

        assert dates == [date(2026, 1, 31), date(2026, 2, 28), date(2026, 3, 31), date(2026, 4, 30)]

    def test_february_is_29_in_a_leap_year(self):
        dates = pay_dates(monthly(31, start=date(2028, 1, 1)), 3).dates

        assert dates == [date(2028, 1, 31), date(2028, 2, 29), date(2028, 3, 31)]

    def test_the_30th_clamps_in_february_only(self):
        dates = pay_dates(monthly(30, start=date(2026, 1, 1)), 3).dates

        assert dates == [date(2026, 1, 30), date(2026, 2, 28), date(2026, 3, 30)]

    def test_clamp_helper(self):
        assert clamp_to_month(2026, 2, 31) == date(2026, 2, 28)
        assert clamp_to_month(2028, 2, 31) == date(2028, 2, 29)
        assert clamp_to_month(2026, 4, 31) == date(2026, 4, 30)
        assert clamp_to_month(2026, 1, 15) == date(2026, 1, 15)


class TestSemimonthly:
    def test_15_and_31_clamp_correctly(self):
        dates = pay_dates(semimonthly(15, 31, start=date(2026, 1, 1)), 6).dates

        assert dates == [
            date(2026, 1, 15),
            date(2026, 1, 31),
            date(2026, 2, 15),
            date(2026, 2, 28),
            date(2026, 3, 15),
            date(2026, 3, 31),
        ]

    def test_days_are_ordered_regardless_of_how_they_were_entered(self):
        dates = pay_dates(semimonthly(31, 15, start=date(2026, 1, 1)), 4).dates

        assert dates == [date(2026, 1, 15), date(2026, 1, 31), date(2026, 2, 15), date(2026, 2, 28)]

    def test_1st_and_15th(self):
        dates = pay_dates(semimonthly(1, 15, start=date(2026, 3, 1)), 4).dates

        assert dates == [date(2026, 3, 1), date(2026, 3, 15), date(2026, 4, 1), date(2026, 4, 15)]


class TestWeekendRules:
    def test_previous_business_day_moves_back_off_the_weekend(self):
        # 2026-08-15 is a Saturday.
        assert apply_weekend_rule(date(2026, 8, 15), WeekendRule.PREVIOUS_BUSINESS_DAY) == date(
            2026, 8, 14
        )

    def test_next_business_day_moves_forward_off_the_weekend(self):
        # 2026-08-16 is a Sunday.
        assert apply_weekend_rule(date(2026, 8, 16), WeekendRule.NEXT_BUSINESS_DAY) == date(
            2026, 8, 17
        )

    def test_a_weekday_is_never_moved(self):
        for rule in WeekendRule:
            assert apply_weekend_rule(date(2026, 8, 13), rule) == date(2026, 8, 13)

    def test_none_leaves_weekends_alone(self):
        assert apply_weekend_rule(date(2026, 8, 15), WeekendRule.NONE) == date(2026, 8, 15)

    def test_monthly_dates_shift_off_weekends(self):
        # 2026-02-15 is a Sunday, 2026-03-15 is a Sunday, 2026-08-15 is a Saturday.
        spec = monthly(15, start=date(2026, 1, 1), rule=WeekendRule.PREVIOUS_BUSINESS_DAY)
        dates = pay_dates(spec, 3).dates

        assert dates == [date(2026, 1, 15), date(2026, 2, 13), date(2026, 3, 13)]

    def test_weekly_and_biweekly_ignore_the_rule(self):
        # A biweekly anchor on a Saturday stays on Saturdays: the rule is scoped to
        # monthly and semimonthly in SPEC §2.
        spec = ScheduleSpec(
            frequency=Frequency.BIWEEKLY,
            effective_from=date(2026, 1, 3),
            anchor_date=date(2026, 1, 3),
            weekend_rule=WeekendRule.NEXT_BUSINESS_DAY,
        )
        dates = pay_dates(spec, 3).dates

        assert dates == [date(2026, 1, 3), date(2026, 1, 17), date(2026, 1, 31)]
        assert all(day.weekday() == 5 for day in dates)


class TestOrderingGuard:
    def test_a_backwards_shift_is_skipped_when_it_would_invert_the_order(self):
        # 2026-08-01 is a Saturday and 2026-08-02 a Sunday. Shifting both back lands them
        # on the same Friday, so the second keeps its configured date.
        spec = semimonthly(1, 2, start=date(2026, 7, 1), rule=WeekendRule.PREVIOUS_BUSINESS_DAY)
        result = pay_dates(spec, 4)

        assert result.dates == [
            date(2026, 7, 1),
            date(2026, 7, 2),
            date(2026, 7, 31),
            date(2026, 8, 2),
        ]
        assert date(2026, 8, 2) in result.unshifted

    def test_pay_dates_are_always_strictly_increasing(self):
        for rule in WeekendRule:
            for day_one, day_two in [(1, 15), (15, 31), (14, 28), (1, 2), (30, 31)]:
                spec = semimonthly(day_one, day_two, start=date(2026, 1, 1), rule=rule)
                dates = pay_dates(spec, 40).dates
                assert all(b > a for a, b in zip(dates, dates[1:], strict=False)), (
                    f"{rule} {day_one}/{day_two}"
                )


class TestBiweeklyYearCounts:
    def test_a_year_has_26_or_27_pay_dates(self):
        spec = biweekly(date(2026, 1, 2))

        for year in (2026, 2027, 2028, 2029, 2030):
            assert len(pay_dates_in_year(spec, year)) in (26, 27)

    def test_a_27_pay_date_year_turns_up_within_a_decade(self):
        spec = biweekly(date(2026, 1, 2))
        counts = {year: len(pay_dates_in_year(spec, year)) for year in range(2026, 2036)}

        assert 27 in counts.values()
        assert set(counts.values()) <= {26, 27}

    def test_dates_step_by_exactly_14_days_across_a_year_boundary(self):
        spec = biweekly(date(2026, 12, 18))
        dates = pay_dates(spec, 4).dates

        assert dates == [
            date(2026, 12, 18),
            date(2027, 1, 1),
            date(2027, 1, 15),
            date(2027, 1, 29),
        ]

    def test_weekly_gives_52_or_53_dates_a_year(self):
        spec = ScheduleSpec(
            frequency=Frequency.WEEKLY,
            effective_from=date(2026, 1, 2),
            anchor_date=date(2026, 1, 2),
        )

        for year in (2026, 2027, 2028):
            assert len(pay_dates_in_year(spec, year)) in (52, 53)


class TestPeriods:
    def test_a_period_ends_the_day_before_the_next_pay_date(self):
        periods = periods_from(monthly(15, start=date(2026, 1, 1)), 3)

        assert periods[0].start == date(2026, 1, 15)
        assert periods[0].end == date(2026, 2, 14)
        assert periods[1].start == date(2026, 2, 15)

    def test_periods_are_contiguous_with_no_gaps_or_overlaps(self):
        periods = periods_from(semimonthly(15, 31, start=date(2026, 1, 1)), 24)

        for previous, following in zip(periods, periods[1:], strict=False):
            assert following.start == previous.end + timedelta(days=1)

    def test_period_length_is_at_least_one_day(self):
        periods = periods_from(semimonthly(30, 31, start=date(2026, 1, 1)), 12)

        assert all(period.days >= 1 for period in periods)

    def test_build_periods_needs_one_more_date_than_periods(self):
        dates = [date(2026, 1, 1), date(2026, 1, 15), date(2026, 2, 1)]

        assert len(build_periods(dates)) == 2

    def test_period_for_date_finds_the_containing_period(self):
        periods = periods_from(monthly(15, start=date(2026, 1, 1)), 6)

        found = period_for_date(periods, date(2026, 2, 3))
        assert found is not None
        assert found.start == date(2026, 1, 15)

    def test_period_for_date_returns_none_outside_the_range(self):
        periods = periods_from(monthly(15, start=date(2026, 1, 1)), 3)

        assert period_for_date(periods, date(2025, 1, 1)) is None


class TestEveryDateBelongsToExactlyOnePeriod:
    """The invariant from SPEC §2, checked day by day across three years."""

    @pytest.mark.parametrize(
        "spec",
        [
            monthly(31, start=date(2026, 1, 1)),
            monthly(1, start=date(2026, 1, 1), rule=WeekendRule.PREVIOUS_BUSINESS_DAY),
            monthly(15, start=date(2026, 1, 1), rule=WeekendRule.NEXT_BUSINESS_DAY),
            semimonthly(15, 31, start=date(2026, 1, 1)),
            semimonthly(1, 16, start=date(2026, 1, 1), rule=WeekendRule.PREVIOUS_BUSINESS_DAY),
            biweekly(date(2026, 1, 2)),
            ScheduleSpec(
                frequency=Frequency.WEEKLY,
                effective_from=date(2026, 1, 2),
                anchor_date=date(2026, 1, 2),
            ),
        ],
        ids=[
            "monthly-31",
            "monthly-1-prev",
            "monthly-15-next",
            "semimonthly-15-31",
            "semimonthly-1-16-prev",
            "biweekly",
            "weekly",
        ],
    )
    def test_three_years_of_dates_map_to_exactly_one_period(self, spec):
        periods = periods_from(spec, 200)
        window_start = periods[0].start
        window_end = min(periods[-1].end, window_start + timedelta(days=365 * 3))

        day = window_start
        index = 0
        while day <= window_end:
            matches = [p for p in periods if p.contains(day)]
            assert len(matches) == 1, f"{day} matched {len(matches)} periods"
            # The sequence is ordered, so the match never moves backwards.
            assert periods.index(matches[0]) >= index
            index = periods.index(matches[0])
            day += timedelta(days=1)


class TestValidation:
    def test_weekly_requires_an_anchor(self):
        with pytest.raises(ValueError, match="anchor"):
            ScheduleSpec(frequency=Frequency.WEEKLY, effective_from=date(2026, 1, 1))

    def test_monthly_requires_a_day_of_month(self):
        with pytest.raises(ValueError, match="day of the month"):
            ScheduleSpec(frequency=Frequency.MONTHLY, effective_from=date(2026, 1, 1))

    def test_semimonthly_requires_two_different_days(self):
        with pytest.raises(ValueError, match="two days"):
            ScheduleSpec(
                frequency=Frequency.SEMIMONTHLY,
                effective_from=date(2026, 1, 1),
                day_of_month_1=15,
            )
        with pytest.raises(ValueError, match="must be different"):
            ScheduleSpec(
                frequency=Frequency.SEMIMONTHLY,
                effective_from=date(2026, 1, 1),
                day_of_month_1=15,
                day_of_month_2=15,
            )

    def test_day_of_month_bounds(self):
        with pytest.raises(ValueError, match="between 1 and 31"):
            ScheduleSpec(
                frequency=Frequency.MONTHLY, effective_from=date(2026, 1, 1), day_of_month_1=32
            )

    def test_monthly_rejects_a_second_day(self):
        with pytest.raises(ValueError, match="only one day"):
            ScheduleSpec(
                frequency=Frequency.MONTHLY,
                effective_from=date(2026, 1, 1),
                day_of_month_1=15,
                day_of_month_2=28,
            )

    def test_zero_or_negative_counts_give_nothing(self):
        assert pay_dates(monthly(15, start=date(2026, 1, 1)), 0).dates == []
