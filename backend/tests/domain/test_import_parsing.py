"""OFX/QFX and CSV parsing, duplicate keys, and rule matching (SPEC §11)."""

from datetime import date
from pathlib import Path

import pytest

from app.domain.imports import ParsedRow, csv_profile, keys, ofx
from app.domain.imports.rules import RuleSpec, first_match, matches, rule_problem

FIXTURES = Path(__file__).parents[1] / "fixtures" / "imports"


def read(name: str) -> str:
    return csv_profile.decode((FIXTURES / name).read_bytes())


class TestOfx:
    def test_sgml_ofx_1(self):
        result = ofx.parse(read("checking.ofx"))
        assert result.errors == []
        assert [(r.date, r.amount_cents, r.description, r.memo, r.fitid) for r in result.rows] == [
            (date(2026, 9, 2), -4520, "KROGER #0423", "POS PURCHASE", "2026090201"),
            (date(2026, 9, 5), -1599, "NETFLIX.COM", "RECURRING", "2026090501"),
            (date(2026, 9, 10), 250000, "ACME PAYROLL & CO", "DIRECT DEP", "2026091001"),
        ]

    def test_xml_qfx(self):
        result = ofx.parse(read("card.qfx"))
        assert result.errors == []
        assert [(r.date, r.amount_cents, r.description, r.fitid) for r in result.rows] == [
            (date(2026, 9, 3), -8910, "TARGET 00012", "CC-7781"),
            (date(2026, 9, 8), -1250, "CORNER BAKERY", "CC-7792"),
            (date(2026, 9, 12), 20000, "PAYMENT THANK YOU", "CC-7800"),
        ]
        assert result.rows[1].memo == ""

    def test_detection(self):
        assert ofx.looks_like_ofx(read("checking.ofx"))
        assert ofx.looks_like_ofx(read("card.qfx"))
        assert not ofx.looks_like_ofx(read("signed.csv"))

    def test_a_broken_transaction_is_reported_not_guessed(self):
        text = (
            "<OFX><STMTTRN><DTPOSTED>2026-13-45<TRNAMT>-1.00<FITID>x"
            "<STMTTRN><DTPOSTED>20260901<TRNAMT>-2.00<FITID>y</OFX>"
        )
        result = ofx.parse(text)
        assert [row.fitid for row in result.rows] == ["y"]
        assert result.errors == [(1, "missing or unreadable DTPOSTED / TRNAMT")]


class TestCsv:
    def test_one_signed_amount_column(self):
        profile = csv_profile.CsvProfile(
            date_column=0, date_format="MM/DD/YYYY", amount_column=2, description_column=1
        )
        result = csv_profile.parse(read("signed.csv"), profile)
        assert result.errors == []
        assert [(r.date.isoformat(), r.amount_cents, r.description) for r in result.rows] == [
            ("2026-09-02", -4520, "KROGER #0423 CINCINNATI OH"),
            ("2026-09-04", -3800, "SHELL OIL 5741"),
            ("2026-09-04", -500, "COFFEE HOUSE"),
            ("2026-09-04", -500, "COFFEE HOUSE"),
            ("2026-09-10", 250000, "ACME PAYROLL"),
            ("2026-09-11", -1234, "REFUND AMAZON"),  # accounting parentheses
        ]

    def test_debit_and_credit_columns_with_a_preamble(self):
        profile = csv_profile.CsvProfile(
            delimiter=";",
            skip_rows=1,
            date_column=0,
            date_format="YYYY-MM-DD",
            amount_mode="debit_credit",
            amount_column=None,
            debit_column=1,
            credit_column=2,
            description_column=3,
            memo_column=4,
        )
        text = read("debit_credit.csv")
        assert csv_profile.header(text, profile) == [
            "Posting Date",
            "Debit",
            "Credit",
            "Payee",
            "Details",
        ]
        result = csv_profile.parse(text, profile)
        assert result.errors == []
        assert [(r.amount_cents, r.description, r.memo) for r in result.rows] == [
            (-8910, "TARGET 00012", "HOUSEHOLD"),
            (-1250, "CORNER BAKERY", ""),
            (20000, "PAYMENT THANK YOU", "ONLINE"),
        ]

    def test_invert_sign_for_banks_that_write_purchases_positive(self):
        text = "Date,Amount,Description\n2026-09-01,45.20,KROGER\n"
        profile = csv_profile.CsvProfile(
            date_format="YYYY-MM-DD", amount_column=1, description_column=2, invert_sign=True
        )
        assert csv_profile.parse(text, profile).rows[0].amount_cents == -4520

    def test_bad_rows_are_reported_with_their_line(self):
        text = (
            "Date,Description,Amount\n09/31/2026,X,-1.00\n09/01/2026,Y,abc\n\n09/02/2026,Z,-3.00\n"
        )
        profile = csv_profile.CsvProfile(amount_column=2, description_column=1)
        result = csv_profile.parse(text, profile)
        assert [row.description for row in result.rows] == ["Z"]
        assert result.errors == [
            (2, "unreadable date '09/31/2026'"),
            (3, "unreadable amount 'abc'"),
        ]

    def test_no_header(self):
        text = "09/02/2026,-4.00,TEA\n"
        profile = csv_profile.CsvProfile(has_header=False, amount_column=1, description_column=2)
        assert csv_profile.header(text, profile) == ["Column 1", "Column 2", "Column 3"]
        assert csv_profile.parse(text, profile).rows[0].amount_cents == -400

    def test_encodings(self):
        assert csv_profile.decode("﻿Date".encode()) == "Date"
        assert csv_profile.decode("Café".encode("cp1252")) == "Café"

    @pytest.mark.parametrize(
        ("changes", "fragment"),
        [
            ({"delimiter": ";;"}, "single character"),
            ({"date_format": "DDMMYYYY"}, "Unknown date format"),
            ({"amount_column": None}, "amount column"),
            ({"amount_mode": "debit_credit", "debit_column": 1}, "debit and the credit"),
        ],
    )
    def test_profile_problems(self, changes, fragment):
        base = {"amount_column": 1}
        assert fragment in csv_profile.profile_problem(
            csv_profile.CsvProfile(**{**base, **changes})
        )


class TestKeys:
    def rows(self):
        return [
            ParsedRow(date(2026, 9, 4), -500, "COFFEE HOUSE", ""),
            ParsedRow(date(2026, 9, 4), -500, "Coffee House ", ""),
            ParsedRow(date(2026, 9, 5), -500, "COFFEE HOUSE", ""),
        ]

    def test_same_day_twins_get_different_keys(self):
        first, second, third = keys.keys_for(self.rows(), account_id=1)
        assert len({first, second, third}) == 3

    def test_the_same_file_gives_the_same_keys(self):
        assert keys.keys_for(self.rows(), 1) == keys.keys_for(self.rows(), 1)

    def test_keys_belong_to_an_account(self):
        assert keys.keys_for(self.rows(), 1) != keys.keys_for(self.rows(), 2)

    def test_fitid_wins(self):
        row = ParsedRow(date(2026, 9, 4), -500, "X", "", fitid="ABC123")
        assert keys.keys_for([row], 1) == ["fitid:ABC123"]


class TestRules:
    def rule(self, **overrides):
        base = {
            "id": 1,
            "match_field": "description",
            "match_type": "contains",
            "match_value": "kroger",
        }
        base.update(overrides)
        return RuleSpec(**base)

    def hit(self, rule, description="POS KROGER #0423", memo="", amount=-4520, account=1):
        return matches(
            rule, description=description, memo=memo, amount_cents=amount, account_id=account
        )

    def test_match_types_ignore_case(self):
        assert self.hit(self.rule())
        assert self.hit(self.rule(match_type="starts_with", match_value="pos kroger"))
        assert not self.hit(self.rule(match_type="starts_with", match_value="kroger"))
        assert self.hit(self.rule(match_type="equals", match_value="pos kroger #0423 "))
        assert self.hit(self.rule(match_type="regex", match_value=r"kroger\s+#\d+"))
        assert not self.hit(self.rule(match_type="regex", match_value=r"^kroger"))

    def test_memo_amount_and_account_conditions(self):
        assert self.hit(self.rule(match_field="memo", match_value="fuel"), memo="FUEL CENTER")
        assert not self.hit(self.rule(match_field="memo"), memo="")
        assert self.hit(self.rule(amount_min_cents=-5000, amount_max_cents=-4000))
        assert not self.hit(self.rule(amount_max_cents=-5000))
        assert not self.hit(self.rule(account_id=2))
        assert not self.hit(self.rule(is_active=False))

    def test_the_first_matching_rule_wins(self):
        general = self.rule(id=1, match_value="kroger")
        fuel = self.rule(id=2, match_value="kroger fuel")
        assert (
            first_match(
                [general, fuel], description="KROGER FUEL", memo="", amount_cents=-1, account_id=1
            ).id
            == 1
        )
        assert (
            first_match(
                [fuel, general], description="KROGER FUEL", memo="", amount_cents=-1, account_id=1
            ).id
            == 2
        )
        assert (
            first_match([fuel], description="TARGET", memo="", amount_cents=-1, account_id=1)
            is None
        )

    def test_problems(self):
        assert "regex" in rule_problem(self.rule(match_type="regex", match_value="(unclosed"))
        assert "text to match" in rule_problem(self.rule(match_value="  "))
        assert "above the maximum" in rule_problem(
            self.rule(amount_min_cents=10, amount_max_cents=5)
        )
        assert rule_problem(self.rule()) is None
