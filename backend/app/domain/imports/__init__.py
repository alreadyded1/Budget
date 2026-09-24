"""Bank file parsing, duplicate keys and rules (SPEC §11). Pure: no database, no clock."""

from dataclasses import dataclass
from datetime import date


@dataclass(frozen=True, slots=True)
class ParsedRow:
    """One transaction read from a bank file, before anything is decided about it."""

    date: date
    amount_cents: int
    description: str
    memo: str
    #: The bank's own transaction id (OFX FITID); None for CSV.
    fitid: str | None = None


@dataclass(frozen=True, slots=True)
class ParseResult:
    rows: list[ParsedRow]
    #: (1-based line or row number, reason) for anything that could not be read.
    errors: list[tuple[int, str]]
