"""Net worth month-ends and which accounts count when (SPEC §14)."""

from datetime import date

import pytest

from app.domain.net_worth import counts_on, month_ends, months_since


def test_month_ends_end_with_today():
    assert month_ends(date(2026, 3, 15), 4) == [
        date(2025, 12, 31),
        date(2026, 1, 31),
        date(2026, 2, 28),
        date(2026, 3, 15),
    ]
    assert month_ends(date(2024, 3, 1), 2) == [date(2024, 2, 29), date(2024, 3, 1)]
    assert month_ends(date(2026, 1, 31), 1) == [date(2026, 1, 31)]
    with pytest.raises(ValueError):
        month_ends(date(2026, 1, 1), 0)


def test_months_since():
    assert months_since(date(2025, 11, 20), date(2026, 3, 1)) == 5
    assert months_since(date(2026, 3, 1), date(2026, 3, 1)) == 1


def test_opened_and_closed_mid_range():
    opened, closed = date(2026, 2, 10), date(2026, 5, 3)
    assert not counts_on(opened, closed, date(2026, 1, 31))
    assert counts_on(opened, closed, date(2026, 2, 10))
    assert counts_on(opened, closed, date(2026, 5, 3))
    assert not counts_on(opened, closed, date(2026, 5, 31))
    assert counts_on(opened, None, date(2030, 1, 1))
