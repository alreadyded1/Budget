"""Net worth over time (SPEC §14, D-094, D-095). Pure: no database, no clock."""

from datetime import date, timedelta


def month_ends(today: date, months: int) -> list[date]:
    """The last `months` month-ends, oldest first; the current month's point is today."""
    if months < 1:
        raise ValueError("months must be at least 1")
    points = [today]
    cursor = today.replace(day=1) - timedelta(days=1)
    while len(points) < months:
        points.append(cursor)
        cursor = cursor.replace(day=1) - timedelta(days=1)
    return sorted(points)


def months_since(first: date, today: date) -> int:
    """How many month points reach back to the month of `first`."""
    return max(1, (today.year - first.year) * 12 + today.month - first.month + 1)


def counts_on(opening_date: date, closed_on: date | None, on: date) -> bool:
    """An account counts from its opening date through the day it was closed (D-094)."""
    return opening_date <= on and (closed_on is None or on <= closed_on)
