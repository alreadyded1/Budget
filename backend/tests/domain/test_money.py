"""Money parsing and formatting. These cases mirror frontend/src/lib/money.test.ts."""

from decimal import Decimal

import pytest

from app.domain.money import format_cents, parse_amount, round_to_cents, splits_balance


class TestParseAmount:
    @pytest.mark.parametrize(
        ("text", "cents"),
        [
            ("12.34", 1234),
            ("0.05", 5),
            ("7", 700),
            (".5", 50),
            ("1234.5", 123450),
        ],
    )
    def test_plain_numbers(self, text, cents):
        assert parse_amount(text) == cents

    def test_symbols_commas_and_spaces_are_ignored(self):
        assert parse_amount(" $1,234.56 ") == 123456

    def test_negatives(self):
        assert parse_amount("-42.10") == -4210

    def test_accounting_parentheses_mean_negative(self):
        assert parse_amount("(42.10)") == -4210
        assert parse_amount("($1,234.56)") == -123456

    @pytest.mark.parametrize("text", ["", "abc", "-", "1.2.3", "12-34", None])
    def test_rejects_things_that_are_not_amounts(self, text):
        assert parse_amount(text) is None

    def test_rounds_half_away_from_zero(self):
        # The case that a float would get wrong: 1.005 * 100 is 100.49999999999999.
        assert parse_amount("1.005") == 101
        assert parse_amount("-1.005") == -101
        assert parse_amount("2.675") == 268
        assert parse_amount("0.004") == 0

    def test_long_fractions_do_not_creep(self):
        assert parse_amount("1.004999") == 100
        assert parse_amount("1.9999") == 200


class TestRoundToCents:
    def test_decimals_are_exact(self):
        assert round_to_cents(Decimal("1.005")) == 101
        assert round_to_cents(Decimal("-1.005")) == -101
        assert round_to_cents(Decimal("2.675")) == 268

    def test_floats_go_through_their_string_form(self):
        assert round_to_cents(1.005) == 101
        assert round_to_cents(2.675) == 268

    def test_whole_numbers(self):
        assert round_to_cents(5) == 500
        assert round_to_cents(Decimal("0")) == 0

    def test_always_an_integer(self):
        for value in ("0.001", "-0.001", "19.999", "1e-3"):
            assert isinstance(round_to_cents(Decimal(value)), int)


class TestFormatCents:
    def test_formatting(self):
        assert format_cents(0) == "$0.00"
        assert format_cents(5) == "$0.05"
        assert format_cents(12345) == "$123.45"
        assert format_cents(123456789) == "$1,234,567.89"

    def test_the_sign_goes_in_front_of_the_symbol(self):
        assert format_cents(-12345) == "-$123.45"

    def test_another_symbol(self):
        assert format_cents(1050, "£") == "£10.50"

    def test_round_trips_with_parse(self):
        for cents in (1, 1999, 123450, -875):
            assert parse_amount(format_cents(cents)) == cents


def test_splits_balance():
    assert splits_balance(-5000, [-3000, -2000])
    assert not splits_balance(-5000, [-3000, -1999])
    assert splits_balance(0, [])
