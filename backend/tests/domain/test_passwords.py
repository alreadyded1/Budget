"""Password policy: length only, no composition rules."""

import pytest

from app.domain.passwords import MIN_LENGTH, is_acceptable, password_problem


@pytest.mark.parametrize(
    "password",
    ["correct-horse-battery", "x" * MIN_LENGTH + "y", "Tr0ub4dor&3 plus more"],
)
def test_long_enough_passwords_are_accepted(password):
    assert is_acceptable(password)


@pytest.mark.parametrize("password", ["", "short", "a" * (MIN_LENGTH - 1)])
def test_short_passwords_are_rejected(password):
    assert f"at least {MIN_LENGTH}" in password_problem(password)


def test_padding_with_whitespace_is_rejected():
    assert "whitespace" in password_problem("   spaces everywhere   ")


def test_obvious_passwords_are_rejected():
    assert password_problem("passwordpassword") is not None


def test_absurdly_long_passwords_are_rejected():
    assert "at most" in password_problem("x" * 1000)
