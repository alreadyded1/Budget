"""OFX and QFX statements (SPEC §11): OFX 1.x (SGML, unclosed tags) and 2.x (XML).

Rather than a full SGML parser, each <STMTTRN> block is cut out and its simple
`<TAG>value` pairs are read. That covers both dialects and the Quicken (QFX) variant,
which is OFX with a few extra tags.
"""

import re
from datetime import date

from app.domain.imports import ParsedRow, ParseResult
from app.domain.money import parse_amount

_BLOCK = re.compile(r"<STMTTRN>(.*?)(?=</STMTTRN>|<STMTTRN>|</BANKTRANLIST>|$)", re.S | re.I)
_FIELD = re.compile(r"<([A-Z0-9.]+)>([^<\r\n]*)", re.I)
_OFX_DATE = re.compile(r"^(\d{4})(\d{2})(\d{2})")


def looks_like_ofx(text: str) -> bool:
    head = text[:2048].upper()
    return "OFXHEADER" in head or "<OFX>" in head or "<?OFX" in head


def _date(value: str) -> date | None:
    match = _OFX_DATE.match(value.strip())
    if match is None:
        return None
    try:
        return date(int(match[1]), int(match[2]), int(match[3]))
    except ValueError:
        return None


def _unescape(value: str) -> str:
    return (
        value.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&apos;", "'")
    ).strip()


def parse(text: str) -> ParseResult:
    rows: list[ParsedRow] = []
    errors: list[tuple[int, str]] = []
    for number, block in enumerate(_BLOCK.findall(text), start=1):
        fields = {tag.upper(): _unescape(value) for tag, value in _FIELD.findall(block)}
        posted = _date(fields.get("DTPOSTED", ""))
        amount = parse_amount(fields.get("TRNAMT", ""))
        if posted is None or amount is None:
            errors.append((number, "missing or unreadable DTPOSTED / TRNAMT"))
            continue
        name = fields.get("NAME") or fields.get("PAYEE") or ""
        memo = fields.get("MEMO", "")
        rows.append(
            ParsedRow(
                date=posted,
                amount_cents=amount,
                description=name or memo,
                memo=memo if name else "",
                fitid=fields.get("FITID") or None,
            )
        )
    return ParseResult(rows=rows, errors=errors)
