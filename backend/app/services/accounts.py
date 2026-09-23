"""Account management. Balances arrive in Phase 4; this is names, types and settings."""

from datetime import date

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DbSession

from app.errors import AppError
from app.models import ACCOUNT_TYPES, DEFAULT_ON_BUDGET_TYPES, Account, AccountValuation


def default_on_budget(account_type: str) -> bool:
    return account_type in DEFAULT_ON_BUDGET_TYPES


def list_accounts(db: DbSession, *, include_closed: bool = True) -> list[Account]:
    query = select(Account).order_by(Account.sort_order, func.lower(Account.name))
    if not include_closed:
        query = query.where(Account.is_closed.is_(False))
    return list(db.scalars(query))


def get_account(db: DbSession, account_id: int) -> Account:
    account = db.get(Account, account_id)
    if account is None:
        raise AppError(404, "Account not found", "account_not_found")
    return account


def _validate(account_type: str, valuation_mode: str) -> None:
    if account_type not in ACCOUNT_TYPES:
        raise AppError(422, f"Unknown account type: {account_type}", "invalid_account_type")
    if valuation_mode not in ("transactions", "manual"):
        raise AppError(422, f"Unknown valuation mode: {valuation_mode}", "invalid_valuation_mode")


def _next_sort_order(db: DbSession) -> int:
    highest = db.scalar(select(func.max(Account.sort_order)))
    return 0 if highest is None else highest + 1


def create_account(db: DbSession, **fields) -> Account:
    name = (fields.pop("name", "") or "").strip()
    if not name:
        raise AppError(422, "Account name is required.", "name_required")

    account_type = fields.pop("type")
    valuation_mode = fields.pop("valuation_mode", None) or "transactions"
    _validate(account_type, valuation_mode)

    on_budget = fields.pop("on_budget", None)
    account = Account(
        name=name,
        type=account_type,
        valuation_mode=valuation_mode,
        on_budget=default_on_budget(account_type) if on_budget is None else on_budget,
        opening_balance_cents=fields.pop("opening_balance_cents", 0) or 0,
        opening_date=fields.pop("opening_date", None) or date.today(),
        sort_order=_next_sort_order(db),
        **{key: value for key, value in fields.items() if value is not None},
    )
    db.add(account)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise AppError(
            409, "An account with that name already exists.", "account_name_taken"
        ) from exc
    db.refresh(account)
    return account


def update_account(db: DbSession, account_id: int, changes: dict) -> Account:
    account = get_account(db, account_id)

    if "name" in changes:
        name = (changes["name"] or "").strip()
        if not name:
            raise AppError(422, "Account name is required.", "name_required")
        changes["name"] = name
    if "type" in changes or "valuation_mode" in changes:
        _validate(
            changes.get("type", account.type),
            changes.get("valuation_mode", account.valuation_mode),
        )

    for field, value in changes.items():
        setattr(account, field, value)

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise AppError(
            409, "An account with that name already exists.", "account_name_taken"
        ) from exc
    db.refresh(account)
    return account


def set_closed(db: DbSession, account_id: int, is_closed: bool) -> Account:
    """Closing hides an account from entry lists but keeps all its history (SPEC §3)."""
    account = get_account(db, account_id)
    account.is_closed = is_closed
    db.commit()
    db.refresh(account)
    return account


def reorder(db: DbSession, ordered_ids: list[int]) -> list[Account]:
    accounts = {account.id: account for account in list_accounts(db)}
    unknown = [item for item in ordered_ids if item not in accounts]
    if unknown:
        raise AppError(422, f"Unknown account ids: {unknown}", "unknown_account")

    for position, account_id in enumerate(ordered_ids):
        accounts[account_id].sort_order = position
    db.commit()
    return list_accounts(db)


def list_valuations(db: DbSession, account_id: int) -> list[AccountValuation]:
    get_account(db, account_id)
    return list(
        db.scalars(
            select(AccountValuation)
            .where(AccountValuation.account_id == account_id)
            .order_by(AccountValuation.date.desc())
        )
    )


def set_valuation(
    db: DbSession, account_id: int, on: date, balance_cents: int, note: str | None = None
) -> AccountValuation:
    """Record a dated balance. One valuation per account per day; the newest wins."""
    account = get_account(db, account_id)
    if account.valuation_mode != "manual":
        raise AppError(
            409,
            "This account's balance comes from its transactions, not from valuations.",
            "account_not_manually_valued",
        )

    existing = db.scalars(
        select(AccountValuation).where(
            AccountValuation.account_id == account_id, AccountValuation.date == on
        )
    ).first()
    if existing is not None:
        existing.balance_cents = balance_cents
        existing.note = note
        db.commit()
        db.refresh(existing)
        return existing

    valuation = AccountValuation(
        account_id=account_id, date=on, balance_cents=balance_cents, note=note
    )
    db.add(valuation)
    db.commit()
    db.refresh(valuation)
    return valuation
