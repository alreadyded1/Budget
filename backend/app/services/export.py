"""Data export (SPEC §17, D-107): the whole database as JSON, and every transaction as CSV.

Both stream, so a large household never holds the whole export in memory. Secrets never
leave: password hashes, sessions and the ntfy token are left out. Receipt files are not
included; the attachments table lists them and the nightly backups hold the files.
"""

import csv
import io
import json
from collections.abc import Iterator
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import select, text
from sqlalchemy.orm import Session as DbSession

from app import __version__
from app.models import (
    Account,
    Base,
    Category,
    CategoryGroup,
    Payee,
    Transaction,
    TransactionSplit,
)

#: Tables that are not exported at all.
SKIP_TABLES = {"sessions"}
#: Columns that are not exported, per table.
SKIP_COLUMNS = {"users": {"password_hash"}, "settings": {"ntfy_token"}}
BATCH = 2_000


def _value(value):
    if isinstance(value, datetime | date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, bytes):
        return value.hex()
    return value


def _revision(db: DbSession) -> str | None:
    try:
        return db.execute(text("SELECT version_num FROM alembic_version")).scalar()
    except Exception:
        return None


def json_chunks(db: DbSession, now: datetime) -> Iterator[str]:
    """The export as a stream of JSON text: one object, with each table as a list of rows."""
    head = {
        "app": "payday-budget",
        "version": __version__,
        "schema_revision": _revision(db),
        "exported_at": now.isoformat(),
        "note": "Secrets (password hashes, sessions, the ntfy token) are not included; "
        "receipt files are in the nightly backups.",
    }
    yield json.dumps(head)[:-1] + ', "tables": {'
    tables = [t for t in Base.metadata.sorted_tables if t.name not in SKIP_TABLES]
    for index, table in enumerate(sorted(tables, key=lambda t: t.name)):
        hidden = SKIP_COLUMNS.get(table.name, set())
        columns = [c for c in table.columns if c.name not in hidden]
        yield ("," if index else "") + json.dumps(table.name) + ": ["
        order = list(table.primary_key.columns) or columns[:1]
        offset = 0
        first = True
        while True:
            rows = db.execute(select(*columns).order_by(*order).limit(BATCH).offset(offset)).all()
            for row in rows:
                record = {c.name: _value(v) for c, v in zip(columns, row, strict=True)}
                yield ("" if first else ",") + json.dumps(record, ensure_ascii=False)
                first = False
            if len(rows) < BATCH:
                break
            offset += BATCH
        yield "]"
    yield "}}"


CSV_HEADER = [
    "date",
    "account",
    "payee",
    "category_group",
    "category",
    "amount",
    "memo",
    "split_memo",
    "transaction_amount",
    "status",
    "check_number",
    "transfer_account",
    "transaction_id",
]


def _decimal(cents: int) -> str:
    sign = "-" if cents < 0 else ""
    return f"{sign}{abs(cents) // 100}.{abs(cents) % 100:02d}"


def csv_chunks(db: DbSession) -> Iterator[str]:
    """Every transaction, one line per split (a transfer between budget accounts has one line
    per leg with no category), oldest first. Amounts are plain signed decimals."""
    accounts = dict(db.execute(select(Account.id, Account.name)).all())
    payees = dict(db.execute(select(Payee.id, Payee.name)).all())
    categories = {
        cid: (name, group)
        for cid, name, group in db.execute(
            select(Category.id, Category.name, CategoryGroup.name).join(
                CategoryGroup, CategoryGroup.id == Category.group_id
            )
        ).all()
    }
    partners = {
        (tid, acc): other
        for tid, acc, other in db.execute(
            text(
                "SELECT a.transfer_id, a.account_id, b.account_id FROM transactions a "
                "JOIN transactions b ON a.transfer_id = b.transfer_id AND a.id != b.id "
                "WHERE a.transfer_id IS NOT NULL"
            )
        ).all()
    }

    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\r\n")
    writer.writerow(CSV_HEADER)
    offset = 0
    while True:
        rows = db.scalars(
            select(Transaction)
            .order_by(Transaction.date, Transaction.id)
            .limit(BATCH)
            .offset(offset)
        ).all()
        ids = [row.id for row in rows]
        splits: dict[int, list[TransactionSplit]] = {}
        if ids:
            for split in db.scalars(
                select(TransactionSplit)
                .where(TransactionSplit.transaction_id.in_(ids))
                .order_by(TransactionSplit.transaction_id, TransactionSplit.sort_order)
            ):
                splits.setdefault(split.transaction_id, []).append(split)
        for tx in rows:
            other = partners.get((tx.transfer_id, tx.account_id)) if tx.transfer_id else None
            lines = splits.get(tx.id) or [None]
            for split in lines:
                category = (
                    categories.get(split.category_id) if split and split.category_id else None
                )
                writer.writerow(
                    [
                        tx.date.isoformat(),
                        accounts.get(tx.account_id, ""),
                        payees.get(tx.payee_id, "") if tx.payee_id else "",
                        category[1] if category else "",
                        category[0] if category else "",
                        _decimal(split.amount_cents if split else tx.amount_cents),
                        tx.memo or "",
                        (split.memo or "") if split else "",
                        _decimal(tx.amount_cents),
                        tx.status,
                        tx.check_number or "",
                        accounts.get(other, "") if other else "",
                        tx.id,
                    ]
                )
        yield buffer.getvalue()
        buffer.seek(0)
        buffer.truncate()
        db.expunge_all()
        if len(rows) < BATCH:
            break
        offset += BATCH
