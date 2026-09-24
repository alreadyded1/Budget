"""Debt payoff simulator (SPEC §14): a hand-checked amortization, then several debts."""

from decimal import ROUND_HALF_UP, Decimal

import pytest

from app.domain.debt_payoff import Debt, monthly_interest, order_for, simulate

LOAN = Debt(id=1, name="Car loan", balance_cents=1_000_000, apr_bps=600, min_payment_cents=19_333)


def amortize(
    principal: str, annual_rate: str, payment: str
) -> list[tuple[Decimal, Decimal, Decimal]]:
    """A textbook amortization table in Decimal: (interest, payment, balance) per month."""
    balance = Decimal(principal)
    rate = Decimal(annual_rate) / 12
    rows = []
    while balance > 0:
        interest = (balance * rate).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        pay = min(Decimal(payment), balance + interest)
        balance = balance + interest - pay
        rows.append((interest, pay, balance))
    return rows


def cents(value: Decimal) -> int:
    return int(value * 100)


class TestSingleLoan:
    def test_the_first_months_match_the_hand_worked_table(self):
        # $10,000 at 6%: month 1 interest 10,000 × 0.005 = 50.00; 9,856.67 × 0.005 = 49.28335;
        # 9,712.62 × 0.005 = 48.5631.
        result = simulate([LOAN], 0, "avalanche", start=(2026, 10))
        rows = [
            (m.lines[0].interest_cents, m.lines[0].payment_cents, m.lines[0].balance_cents)
            for m in result.months[:3]
        ]
        assert rows == [
            (5_000, 19_333, 985_667),
            (4_928, 19_333, 971_262),
            (4_856, 19_333, 956_785),
        ]

    def test_every_month_matches_the_amortization_table_to_the_cent(self):
        expected = amortize("10000.00", "0.06", "193.33")
        result = simulate([LOAN], 0, "snowball", start=(2026, 10))
        got = [
            (m.lines[0].interest_cents, m.lines[0].payment_cents, m.lines[0].balance_cents)
            for m in result.months
        ]
        assert got == [(cents(i), cents(p), cents(b)) for i, p, b in expected]
        assert result.month_count == 60
        assert result.finished
        assert result.payoff_month == {1: 60}
        assert result.total_interest_cents == cents(sum(i for i, _, _ in expected))
        assert result.total_paid_cents == 1_000_000 + result.total_interest_cents
        # The last payment is only what was left.
        assert result.months[-1].lines[0].payment_cents < 19_333
        assert result.months[-1].label == "2031-09"

    def test_extra_payments_shorten_it(self):
        faster = simulate([LOAN], 10_000, "snowball", start=(2026, 10))
        slower = simulate([LOAN], 0, "snowball", start=(2026, 10))
        assert faster.month_count < slower.month_count
        assert faster.total_interest_cents < slower.total_interest_cents

    def test_a_minimum_below_the_interest_never_finishes(self):
        stuck = Debt(2, "Card", 1_000_000, 2_400, 10_000)  # interest 200/month, paying 100
        result = simulate([stuck], 0, "snowball", start=(2026, 1), max_months=24)
        assert not result.finished
        assert result.month_count == 24
        assert result.payoff_month == {2: None}


CARD = Debt(10, "Visa", 250_000, 2_499, 7_500)
STORE = Debt(11, "Store card", 60_000, 1_999, 2_500)
CAR = Debt(12, "Car", 900_000, 490, 30_000)


class TestStrategies:
    def test_orders(self):
        debts = [CARD, STORE, CAR]
        assert order_for("snowball", debts) == [11, 10, 12]
        assert order_for("avalanche", debts) == [10, 11, 12]
        assert order_for("custom", debts, [12, 99, 12]) == [12, 10, 11]

    def test_ties(self):
        a = Debt(1, "A", 50_000, 1_000, 100)
        b = Debt(2, "B", 50_000, 2_000, 100)
        c = Debt(3, "C", 40_000, 2_000, 100)
        assert order_for("snowball", [a, b, c]) == [3, 2, 1]
        assert order_for("avalanche", [a, b, c]) == [3, 2, 1]

    def test_minimums_roll_over_and_overflow_in_the_same_month(self):
        small = Debt(1, "Small", 10_000, 0, 5_000)
        big = Debt(2, "Big", 100_000, 0, 5_000)
        result = simulate([small, big], 3_000, "snowball", start=(2026, 1))
        first, second = result.months[:2]
        # Budget 13,000: minimums 5,000 + 5,000, extra 3,000 to Small.
        assert [line.payment_cents for line in first.lines] == [8_000, 5_000]
        # Small owes 2,000: it takes 2,000 and the other 11,000 go to Big.
        assert [line.payment_cents for line in second.lines] == [2_000, 11_000]
        assert result.payoff_month[1] == 2
        # After that Big gets the whole 13,000 a month.
        assert all(m.lines[1].payment_cents == 13_000 for m in result.months[2:-1])
        assert result.total_paid_cents == 110_000
        assert result.finished

    def test_avalanche_pays_less_interest_than_snowball_here(self):
        debts = [CARD, STORE, CAR]
        snowball = simulate(debts, 20_000, "snowball", start=(2026, 10))
        avalanche = simulate(debts, 20_000, "avalanche", start=(2026, 10))
        assert avalanche.total_interest_cents <= snowball.total_interest_cents
        assert snowball.payoff_month[11] < avalanche.payoff_month[11]
        for result in (snowball, avalanche):
            assert result.finished
            assert (
                result.total_paid_cents == 250_000 + 60_000 + 900_000 + result.total_interest_cents
            )

    def test_a_debt_already_at_zero(self):
        paid = Debt(5, "Done", 0, 1_000, 2_500)
        result = simulate([paid, STORE], 0, "snowball", start=(2026, 10))
        assert result.payoff_month[5] == 0
        # Its minimum still counts toward the monthly budget.
        assert result.months[0].lines[1].payment_cents == 5_000

    def test_negative_extra_is_refused(self):
        with pytest.raises(ValueError):
            simulate([LOAN], -1, "snowball", start=(2026, 1))


def test_monthly_interest_rounds_half_away_from_zero():
    assert monthly_interest(985_667, 600) == 4_928  # 49.28335
    assert monthly_interest(100, 600) == 1  # 0.5 cents rounds up
    assert monthly_interest(99, 600) == 0  # 0.495 cents rounds down
    assert monthly_interest(0, 2_499) == 0
