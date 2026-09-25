"""Payees: nocase-unique names, rename, merge, and usage stats.

Usage stats read from the transactions table, which Phase 4 adds. Until then the
counters are wired up and report nothing, rather than the page being built twice.
"""

from dataclasses import dataclass
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DbSession

from app.errors import AppError
from app.models import Payee
from app.services import categories as categories_service
from app.services import references


@dataclass(frozen=True, slots=True)
class PayeeUsage:
    """What a payee has been used for. Filled in by Phase 4."""

    transaction_count: int = 0
    last_used: date | None = None
    total_spent_cents: int = 0
    #: From the newest transaction, for the entry row's autofill (SPEC §7).
    last_category_id: int | None = None
    last_amount_cents: int | None = None


#: Phase 4 replaces this with a real query over transactions.
_usage_provider = None


def set_usage_provider(provider) -> None:
    """Later phases plug the real stats in here: `provider(db, payee_ids) -> {id: usage}`."""
    global _usage_provider
    _usage_provider = provider


def usage_for_many(db: DbSession, payee_ids: list[int]) -> dict[int, PayeeUsage]:
    """Usage for many payees in a few grouped queries, not a few per payee (D-111)."""
    if _usage_provider is None or not payee_ids:
        return {}
    return _usage_provider(db, payee_ids)


def usage_for(db: DbSession, payee_id: int) -> PayeeUsage:
    return usage_for_many(db, [payee_id]).get(payee_id, PayeeUsage())


def list_payees(db: DbSession, *, search: str = "", include_hidden: bool = True) -> list[Payee]:
    """Alphabetical, case-insensitive (SPEC §5)."""
    query = select(Payee).order_by(func.lower(Payee.name))
    if not include_hidden:
        query = query.where(Payee.is_hidden.is_(False))
    if search.strip():
        query = query.where(Payee.name.ilike(f"%{search.strip()}%"))
    return list(db.scalars(query))


def get_payee(db: DbSession, payee_id: int) -> Payee:
    payee = db.get(Payee, payee_id)
    if payee is None:
        raise AppError(404, "Payee not found", "payee_not_found")
    return payee


def find_by_name(db: DbSession, name: str) -> Payee | None:
    """Case-insensitive lookup, which is what makes a rename into a merge offer."""
    return db.scalars(select(Payee).where(Payee.name == name.strip())).first()


def create_payee(db: DbSession, name: str, **fields) -> Payee:
    name = (name or "").strip()
    if not name:
        raise AppError(422, "Payee name is required.", "name_required")
    if fields.get("default_category_id") is not None:
        categories_service.get_category(db, fields["default_category_id"])

    payee = Payee(name=name, **fields)
    db.add(payee)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise AppError(409, f"A payee named {name} already exists.", "payee_name_taken") from exc
    db.refresh(payee)
    return payee


def update_payee(db: DbSession, payee_id: int, changes: dict) -> Payee:
    """Rename and edit. A rename onto an existing name is refused so the UI can offer a merge."""
    payee = get_payee(db, payee_id)

    if "name" in changes:
        name = (changes["name"] or "").strip()
        if not name:
            raise AppError(422, "Payee name is required.", "name_required")
        clash = find_by_name(db, name)
        if clash is not None and clash.id != payee.id:
            raise AppError(
                409,
                f"{clash.name} already exists. Merge {payee.name} into it?",
                "payee_name_taken",
            )
        changes["name"] = name

    if changes.get("default_category_id") is not None:
        categories_service.get_category(db, changes["default_category_id"])

    for field, value in changes.items():
        setattr(payee, field, value)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise AppError(409, "A payee with that name already exists.", "payee_name_taken") from exc
    db.refresh(payee)
    return payee


def merge_payees(db: DbSession, source_id: int, target_id: int) -> dict[str, int]:
    """Move everything from source onto target, then delete source (SPEC §5).

    Which tables get moved grows with the phases; see app/services/references.py.
    """
    if source_id == target_id:
        raise AppError(422, "A payee cannot be merged into itself.", "same_payee")

    source = get_payee(db, source_id)
    target = get_payee(db, target_id)

    moved_rows = references.reassign_payee(db, source.id, target.id)

    # Keep a pinned default rather than losing it with the source row.
    if target.default_category_id is None and source.default_category_id is not None:
        target.default_category_id = source.default_category_id

    db.delete(source)
    db.commit()
    return moved_rows


def delete_payee(db: DbSession, payee_id: int) -> None:
    payee = get_payee(db, payee_id)
    usage = usage_for(db, payee_id)
    if usage.transaction_count:
        raise AppError(
            409,
            f"{payee.name} is used by {usage.transaction_count} transactions. "
            "Merge it into another payee instead, or hide it.",
            "payee_in_use",
        )
    db.delete(payee)
    db.commit()
