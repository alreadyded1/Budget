"""Bank imports: stage a file for review, commit it, undo it (SPEC §11, D-074 to D-077).

Nothing reaches the ledger before commit. Staging reads the file, and for each row:
  * flags a duplicate when the account already has a transaction with its key
  * applies the first matching rule (payee, category, memo)
  * otherwise uses an existing payee only when the description is exactly its name
  * offers a match with a manual entry: same account, exact amount, within ±3 days
  * offers a link to an unpaid bill the row looks like the payment for
Commit writes everything in one database transaction. Undo removes exactly what the
batch created and puts matched entries back as they were.
"""

from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

from app.domain.imports import ParsedRow, csv_profile, keys, ofx
from app.domain.imports import rules as rule_math
from app.errors import AppError
from app.models import (
    ImportBatch,
    ImportProfile,
    ImportStagedRow,
    Payee,
    SubscriptionOccurrence,
    Transaction,
    utcnow,
)
from app.services import accounts as accounts_service
from app.services import balances as balances_service
from app.services import categories as categories_service
from app.services import payees as payees_service
from app.services import references
from app.services import rules as rules_service
from app.services import subscriptions as subscriptions_service
from app.services import transactions as transactions_service

#: SPEC §11: a manual entry within this many days, for the exact amount, is a match.
MATCH_DAYS = 3
MAX_ROWS = 5000

PROFILE_FIELDS = {
    "name",
    "account_id",
    "delimiter",
    "has_header",
    "skip_rows",
    "date_column",
    "date_format",
    "amount_mode",
    "amount_column",
    "debit_column",
    "credit_column",
    "invert_sign",
    "description_column",
    "memo_column",
}


# ------------------------------------------------------------------------------ profiles


def spec_of(profile: ImportProfile) -> csv_profile.CsvProfile:
    return csv_profile.CsvProfile(
        delimiter=profile.delimiter or ",",
        has_header=bool(profile.has_header),
        skip_rows=profile.skip_rows or 0,
        date_column=profile.date_column or 0,
        date_format=profile.date_format or "MM/DD/YYYY",
        amount_mode=profile.amount_mode or "single",
        amount_column=profile.amount_column,
        debit_column=profile.debit_column,
        credit_column=profile.credit_column,
        invert_sign=bool(profile.invert_sign),
        description_column=profile.description_column
        if profile.description_column is not None
        else 1,
        memo_column=profile.memo_column,
    )


def list_profiles(db: DbSession) -> list[ImportProfile]:
    return list(db.scalars(select(ImportProfile).order_by(func.lower(ImportProfile.name))))


def get_profile(db: DbSession, profile_id: int) -> ImportProfile:
    profile = db.get(ImportProfile, profile_id)
    if profile is None:
        raise AppError(404, "Import profile not found", "profile_not_found")
    return profile


def _check_profile(db: DbSession, profile: ImportProfile) -> None:
    if not (profile.name or "").strip():
        raise AppError(422, "Give the profile a name, such as the bank's.", "name_required")
    problem = csv_profile.profile_problem(spec_of(profile))
    if problem:
        raise AppError(422, problem, "invalid_profile")
    if profile.account_id is not None:
        accounts_service.get_account(db, profile.account_id)
    clash = db.scalars(
        select(ImportProfile).where(
            func.lower(ImportProfile.name) == profile.name.strip().lower(),
            ImportProfile.id != (profile.id or 0),
        )
    ).first()
    if clash is not None:
        raise AppError(409, f"A profile named {clash.name} already exists.", "profile_name_taken")


def save_profile(db: DbSession, fields: dict, profile_id: int | None = None) -> ImportProfile:
    profile = get_profile(db, profile_id) if profile_id else ImportProfile()
    for key, value in fields.items():
        if key in PROFILE_FIELDS:
            setattr(profile, key, value)
    profile.name = (profile.name or "").strip()
    _check_profile(db, profile)
    db.add(profile)
    db.commit()
    db.refresh(profile)
    return profile


def delete_profile(db: DbSession, profile_id: int) -> None:
    db.delete(get_profile(db, profile_id))
    db.commit()


# ------------------------------------------------------------------------------- reading


@dataclass(slots=True)
class Parsed:
    format: str
    rows: list[ParsedRow]
    errors: list[tuple[int, str]]


def detect_format(filename: str, content: str) -> str:
    lower = filename.lower()
    if lower.endswith(".qfx"):
        return "qfx"
    if lower.endswith(".ofx") or ofx.looks_like_ofx(content):
        return "ofx"
    return "csv"


def parse_file(filename: str, content: str, profile: csv_profile.CsvProfile | None) -> Parsed:
    fmt = detect_format(filename, content)
    if fmt in ("ofx", "qfx"):
        result = ofx.parse(content)
    else:
        if profile is None:
            raise AppError(422, "Choose or create a CSV profile for this file.", "profile_required")
        problem = csv_profile.profile_problem(profile)
        if problem:
            raise AppError(422, problem, "invalid_profile")
        result = csv_profile.parse(content, profile)
    if len(result.rows) > MAX_ROWS:
        raise AppError(422, f"That file has more than {MAX_ROWS} rows; split it.", "too_many_rows")
    return Parsed(format=fmt, rows=result.rows, errors=result.errors)


def preview_csv(content: str, profile: csv_profile.CsvProfile, limit: int = 12):
    """What the mapping screen shows while columns are chosen."""
    columns = csv_profile.header(content, profile)
    problem = csv_profile.profile_problem(profile)
    if problem:
        return columns, [], [(0, problem)]
    result = csv_profile.parse(content, profile)
    return columns, result.rows[:limit], result.errors[:limit]


# ------------------------------------------------------------------------------- staging


def _payee_named(db: DbSession, name: str) -> Payee | None:
    name = name.strip()
    if not name:
        return None
    return db.scalars(select(Payee).where(func.lower(Payee.name) == name.lower())).first()


def _manual_match(
    db: DbSession, account_id: int, row: ParsedRow, taken: set[int]
) -> Transaction | None:
    """SPEC §11: an entry typed by hand, same account and exact amount, within ±3 days."""
    window = timedelta(days=MATCH_DAYS)
    candidates = db.scalars(
        select(Transaction).where(
            Transaction.account_id == account_id,
            Transaction.amount_cents == row.amount_cents,
            Transaction.date >= row.date - window,
            Transaction.date <= row.date + window,
            Transaction.import_key.is_(None),
            Transaction.status != "reconciled",
        )
    ).all()
    candidates = [tx for tx in candidates if tx.id not in taken]
    if not candidates:
        return None
    return min(candidates, key=lambda tx: (abs((tx.date - row.date).days), tx.id))


def _bill_for(db: DbSession, payee_id: int | None, row: ParsedRow, taken: set[int]):
    """An unpaid bill this row looks like the payment for (D-064, D-076, D-117)."""
    found = subscriptions_service.matching_bills(
        db, payee_id, row.date, row.amount_cents, exclude=taken
    )
    return found[0] if found else None


def _suggest(
    db: DbSession,
    batch: ImportBatch,
    staged: ImportStagedRow,
    parsed: ParsedRow,
    specs,
    by_id,
    taken_tx: set[int],
    taken_bills: set[int],
) -> None:
    rule = rule_math.first_match(
        specs,
        description=parsed.description,
        memo=parsed.memo,
        amount_cents=parsed.amount_cents,
        account_id=batch.account_id,
    )
    if rule is not None:
        source = by_id[rule.id]
        staged.applied_rule_id = source.id
        staged.payee_id = source.set_payee_id
        staged.category_id = source.set_category_id
        staged.memo = source.set_memo
    if staged.payee_id is None:
        payee = _payee_named(db, parsed.description)
        if payee is not None:
            staged.payee_id = payee.id
            if staged.category_id is None:
                staged.category_id = payee.default_category_id

    if staged.is_duplicate:
        staged.disposition = "skip"
        return
    match = _manual_match(db, batch.account_id, parsed, taken_tx)
    if match is not None:
        taken_tx.add(match.id)
        staged.disposition = "match"
        staged.matched_transaction_id = match.id
        return
    staged.disposition = "import"
    bill = _bill_for(db, staged.payee_id, parsed, taken_bills)
    if bill is not None:
        taken_bills.add(bill.id)
        staged.bill_occurrence_id = bill.id
        staged.link_bill = True


def stage(
    db: DbSession,
    *,
    account_id: int,
    filename: str,
    content: str,
    profile_id: int | None,
    user_id: int | None,
) -> ImportBatch:
    account = accounts_service.get_account(db, account_id)
    profile = get_profile(db, profile_id) if profile_id else None
    parsed = parse_file(filename, content, spec_of(profile) if profile else None)
    if not parsed.rows:
        detail = "; ".join(f"line {n}: {why}" for n, why in parsed.errors[:5])
        raise AppError(
            422,
            "No transactions could be read from that file." + (f" ({detail})" if detail else ""),
            "nothing_to_import",
        )

    batch = ImportBatch(
        account_id=account.id,
        filename=filename[:255],
        format=parsed.format,
        profile_id=profile.id if profile else None,
        status="staged",
        row_count=len(parsed.rows),
        parse_errors="\n".join(f"line {n}: {why}" for n, why in parsed.errors) or None,
        created_by=user_id,
    )
    db.add(batch)
    db.flush()

    row_keys = keys.keys_for(parsed.rows, account.id)
    existing = set(
        db.scalars(
            select(Transaction.import_key).where(
                Transaction.account_id == account.id, Transaction.import_key.in_(row_keys)
            )
        )
    )
    specs, by_id = rules_service.active_specs(db)
    taken_tx: set[int] = set()
    taken_bills: set[int] = set()
    for index, (row, key) in enumerate(zip(parsed.rows, row_keys, strict=True)):
        staged = ImportStagedRow(
            batch_id=batch.id,
            row_index=index,
            date=row.date,
            amount_cents=row.amount_cents,
            raw_description=row.description,
            raw_memo=row.memo,
            import_key=key,
            is_duplicate=key in existing,
        )
        _suggest(db, batch, staged, row, specs, by_id, taken_tx, taken_bills)
        db.add(staged)
    batch.duplicate_count = sum(1 for key in row_keys if key in existing)
    db.commit()
    db.refresh(batch)
    return batch


def get_batch(db: DbSession, batch_id: int) -> ImportBatch:
    batch = db.get(ImportBatch, batch_id)
    if batch is None:
        raise AppError(404, "Import not found", "import_not_found")
    return batch


def list_batches(
    db: DbSession, account_id: int | None = None, limit: int = 50
) -> list[ImportBatch]:
    query = select(ImportBatch).order_by(ImportBatch.id.desc()).limit(limit)
    if account_id is not None:
        query = query.where(ImportBatch.account_id == account_id)
    return list(db.scalars(query))


ROW_FIELDS = {"payee_id", "new_payee_name", "category_id", "memo", "disposition", "link_bill"}


def update_row(db: DbSession, batch_id: int, row_id: int, changes: dict) -> ImportStagedRow:
    batch = get_batch(db, batch_id)
    if batch.status != "staged":
        raise AppError(409, "This import is already committed.", "import_not_staged")
    row = db.get(ImportStagedRow, row_id)
    if row is None or row.batch_id != batch.id:
        raise AppError(404, "Row not found", "import_row_not_found")
    changes = {key: value for key, value in changes.items() if key in ROW_FIELDS}

    if changes.get("disposition") == "match" and row.matched_transaction_id is None:
        raise AppError(422, "There is no entry to match this row with.", "no_match")
    if "payee_id" in changes and changes["payee_id"] is not None:
        payees_service.get_payee(db, changes["payee_id"])
        changes.setdefault("new_payee_name", None)
    if changes.get("new_payee_name"):
        changes["new_payee_name"] = changes["new_payee_name"].strip()[:120] or None
        existing = _payee_named(db, changes["new_payee_name"] or "")
        if existing is not None:
            changes["payee_id"], changes["new_payee_name"] = existing.id, None
        else:
            changes["payee_id"] = None
    if changes.get("category_id") is not None:
        categories_service.get_category(db, changes["category_id"])
    for key, value in changes.items():
        setattr(row, key, value)

    if {"payee_id", "new_payee_name"} & changes.keys():
        # A different payee may pay a different bill (or none).
        taken = {
            other.bill_occurrence_id
            for other in batch.rows
            if other.id != row.id and other.bill_occurrence_id is not None
        }
        parsed = ParsedRow(row.date, row.amount_cents, row.raw_description, row.raw_memo)
        bill = _bill_for(db, row.payee_id, parsed, taken)
        row.bill_occurrence_id = bill.id if bill else None
        row.link_bill = bill is not None
    db.commit()
    db.refresh(row)
    return row


def apply_rules(db: DbSession, batch_id: int) -> tuple[ImportBatch, int]:
    """Run the rules again over rows nobody has filled in yet (a rule made during review).

    Only rows still to be imported with no payee, new payee, category or memo are touched,
    so nothing the household typed is overwritten. Returns the batch and how many changed.
    """
    batch = get_batch(db, batch_id)
    if batch.status != "staged":
        raise AppError(409, "This import is already committed.", "import_not_staged")
    specs, by_id = rules_service.active_specs(db)
    taken_bills = {r.bill_occurrence_id for r in batch.rows if r.bill_occurrence_id is not None}
    changed = 0
    for row in batch.rows:
        untouched = (
            row.disposition == "import"
            and row.payee_id is None
            and not row.new_payee_name
            and row.category_id is None
            and not row.memo
        )
        if not untouched:
            continue
        rule = rule_math.first_match(
            specs,
            description=row.raw_description,
            memo=row.raw_memo,
            amount_cents=row.amount_cents,
            account_id=batch.account_id,
        )
        if rule is None:
            continue
        source = by_id[rule.id]
        row.applied_rule_id = source.id
        row.payee_id = source.set_payee_id
        row.category_id = source.set_category_id
        row.memo = source.set_memo
        if row.bill_occurrence_id is None and row.payee_id is not None:
            parsed = ParsedRow(row.date, row.amount_cents, row.raw_description, row.raw_memo)
            bill = _bill_for(db, row.payee_id, parsed, taken_bills)
            if bill is not None:
                taken_bills.add(bill.id)
                row.bill_occurrence_id = bill.id
                row.link_bill = True
        changed += 1
    db.commit()
    db.refresh(batch)
    return batch, changed


def discard(db: DbSession, batch_id: int) -> None:
    batch = get_batch(db, batch_id)
    if batch.status != "staged":
        raise AppError(
            409, "Only a staged import can be discarded; undo a committed one.", "import_not_staged"
        )
    db.delete(batch)
    db.commit()


# -------------------------------------------------------------------------------- commit


def commit(db: DbSession, batch_id: int, *, user_id: int | None):
    """Write the batch into the ledger in one database transaction."""
    batch = get_batch(db, batch_id)
    if batch.status != "staged":
        raise AppError(409, "This import is already committed.", "import_not_staged")

    new_payees: dict[str, Payee] = {}
    imported = matched = 0
    for row in batch.rows:
        if row.disposition == "skip":
            continue
        if row.disposition == "match":
            tx = (
                db.get(Transaction, row.matched_transaction_id)
                if row.matched_transaction_id
                else None
            )
            if tx is None or tx.import_key is not None:
                raise AppError(
                    409,
                    f"The entry matched to row {row.row_index + 1} changed since staging. "
                    "Discard and import the file again.",
                    "match_gone",
                )
            row.previous_status = tx.status
            if tx.status == "uncleared":
                tx.status = "cleared"
            tx.import_key = row.import_key
            tx.imported_description = row.raw_description or None
            tx.updated_by = user_id
            matched += 1
            continue

        payee_id = row.payee_id
        if payee_id is None and row.new_payee_name:
            key = row.new_payee_name.lower()
            payee = new_payees.get(key) or _payee_named(db, row.new_payee_name)
            if payee is None:
                payee = Payee(name=row.new_payee_name)
                db.add(payee)
                db.flush()
            new_payees[key] = payee
            payee_id = payee.id
        tx = Transaction(
            account_id=batch.account_id,
            date=row.date,
            amount_cents=row.amount_cents,
            payee_id=payee_id,
            memo=row.memo or None,
            status="cleared",  # it came from the bank, so the bank has it
            import_batch_id=batch.id,
            import_key=row.import_key,
            imported_description=row.raw_description or None,
            created_by=user_id,
            updated_by=user_id,
        )
        db.add(tx)
        db.flush()
        transactions_service._write_splits(
            db, tx, [transactions_service.SplitInput(row.amount_cents, category_id=row.category_id)]
        )
        row.created_transaction_id = tx.id
        imported += 1
        if row.link_bill and row.bill_occurrence_id is not None:
            bill = db.get(SubscriptionOccurrence, row.bill_occurrence_id)
            if bill is not None and bill.status == "upcoming":
                bill.status = "paid"
                bill.transaction_id = tx.id

    batch.status = "committed"
    batch.imported_count = imported
    batch.matched_count = matched
    batch.committed_at = utcnow()
    db.commit()
    db.refresh(batch)
    return batch, balances_service.balances_for_ids(db, [batch.account_id])


def undo(db: DbSession, batch_id: int):
    """Remove exactly what the batch did: its new transactions go, matched entries revert."""
    batch = get_batch(db, batch_id)
    if batch.status != "committed":
        raise AppError(409, "Only a committed import can be undone.", "import_not_committed")

    created_ids = [row.created_transaction_id for row in batch.rows if row.created_transaction_id]
    created = list(db.scalars(select(Transaction).where(Transaction.id.in_(created_ids))))
    matched_rows = [
        row for row in batch.rows if row.disposition == "match" and row.matched_transaction_id
    ]
    matched = {
        tx.id: tx
        for tx in db.scalars(
            select(Transaction).where(
                Transaction.id.in_([row.matched_transaction_id for row in matched_rows])
            )
        )
    }
    if any(tx.status == "reconciled" for tx in [*created, *matched.values()]):
        raise AppError(
            409,
            "Some of this import has been reconciled since, so it cannot be undone.",
            "import_reconciled",
        )

    references.transactions_deleting(db, [tx.id for tx in created])
    for tx in created:
        if tx.is_transfer:
            continue  # an import never creates transfers; defensive only
        db.delete(tx)
    for row in matched_rows:
        tx = matched.get(row.matched_transaction_id)
        if tx is None:
            continue
        tx.status = row.previous_status or tx.status
        tx.import_key = None
        tx.imported_description = None
    batch.status = "undone"
    batch.undone_at = utcnow()
    db.commit()
    db.refresh(batch)
    return batch, balances_service.balances_for_ids(db, [batch.account_id])
