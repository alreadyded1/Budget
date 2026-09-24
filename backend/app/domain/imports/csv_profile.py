"""CSV files read through a saved column mapping (SPEC §11, DATA_MODEL import_profiles).

Columns are 0-based indexes, so a file with or without a header row maps the same way.
"""

import csv
import io
from dataclasses import dataclass
from datetime import date, datetime

from app.domain.imports import ParsedRow, ParseResult
from app.domain.money import parse_amount

#: The date formats offered in the mapping screen, as shown → strptime.
DATE_FORMATS: dict[str, str] = {
    "YYYY-MM-DD": "%Y-%m-%d",
    "MM/DD/YYYY": "%m/%d/%Y",
    "DD/MM/YYYY": "%d/%m/%Y",
    "MM/DD/YY": "%m/%d/%y",
    "DD/MM/YY": "%d/%m/%y",
    "DD.MM.YYYY": "%d.%m.%Y",
    "YYYYMMDD": "%Y%m%d",
    "MM-DD-YYYY": "%m-%d-%Y",
}


@dataclass(frozen=True, slots=True)
class CsvProfile:
    delimiter: str = ","
    has_header: bool = True
    skip_rows: int = 0
    date_column: int = 0
    date_format: str = "MM/DD/YYYY"
    #: "single" = one signed column; "debit_credit" = money out and money in apart.
    amount_mode: str = "single"
    amount_column: int | None = 1
    debit_column: int | None = None
    credit_column: int | None = None
    #: For banks that write purchases as positive numbers.
    invert_sign: bool = False
    description_column: int = 2
    memo_column: int | None = None


def profile_problem(profile: CsvProfile) -> str | None:
    if len(profile.delimiter) != 1:
        return "The delimiter is a single character."
    if profile.date_format not in DATE_FORMATS:
        return f"Unknown date format: {profile.date_format}."
    if profile.amount_mode == "single" and profile.amount_column is None:
        return "Choose the amount column."
    if profile.amount_mode == "debit_credit" and (
        profile.debit_column is None or profile.credit_column is None
    ):
        return "Choose both the debit and the credit columns."
    if profile.amount_mode not in ("single", "debit_credit"):
        return "Amounts are one signed column or separate debit and credit columns."
    if profile.skip_rows < 0:
        return "Rows to skip cannot be negative."
    return None


def decode(raw: bytes) -> str:
    """UTF-8 (with or without a BOM), falling back to Windows-1252 as banks often use."""
    for encoding in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("latin-1", errors="replace")


def split_rows(text: str, delimiter: str) -> list[list[str]]:
    return list(csv.reader(io.StringIO(text.lstrip("\ufeff")), delimiter=delimiter))


def header(text: str, profile: CsvProfile) -> list[str]:
    """Column names for the mapping screen: the header row, or Column 1, Column 2, …"""
    rows = split_rows(text, profile.delimiter)[profile.skip_rows :]
    if not rows:
        return []
    if profile.has_header:
        return [cell.strip() for cell in rows[0]]
    return [f"Column {index + 1}" for index in range(len(rows[0]))]


def _cell(row: list[str], column: int | None) -> str:
    if column is None or column < 0 or column >= len(row):
        return ""
    return row[column].strip()


def _parse_date(value: str, fmt: str) -> date | None:
    try:
        return datetime.strptime(value.strip(), DATE_FORMATS[fmt]).date()
    except ValueError:
        return None


def parse(text: str, profile: CsvProfile) -> ParseResult:
    rows: list[ParsedRow] = []
    errors: list[tuple[int, str]] = []
    table = split_rows(text, profile.delimiter)
    start = profile.skip_rows + (1 if profile.has_header else 0)
    for number, row in enumerate(table[start:], start=start + 1):
        if not any(cell.strip() for cell in row):
            continue  # blank line
        on = _parse_date(_cell(row, profile.date_column), profile.date_format)
        if on is None:
            errors.append((number, f"unreadable date {_cell(row, profile.date_column)!r}"))
            continue
        if profile.amount_mode == "single":
            amount = parse_amount(_cell(row, profile.amount_column))
            if amount is None:
                errors.append((number, f"unreadable amount {_cell(row, profile.amount_column)!r}"))
                continue
        else:
            debit_text = _cell(row, profile.debit_column)
            credit_text = _cell(row, profile.credit_column)
            debit = parse_amount(debit_text) if debit_text else 0
            credit = parse_amount(credit_text) if credit_text else 0
            if debit is None or credit is None or (not debit_text and not credit_text):
                errors.append((number, "unreadable debit / credit"))
                continue
            # Banks disagree on whether a debit column is signed; money out is out either way.
            amount = abs(credit) - abs(debit)
        if profile.invert_sign:
            amount = -amount
        rows.append(
            ParsedRow(
                date=on,
                amount_cents=amount,
                description=_cell(row, profile.description_column),
                memo=_cell(row, profile.memo_column),
            )
        )
    return ParseResult(rows=rows, errors=errors)
