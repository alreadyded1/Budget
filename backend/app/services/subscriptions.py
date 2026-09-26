"""Subscriptions and bills: CRUD, price history, occurrences, payments and matching.

Rules (SPEC §9, DATA_MODEL, D-063 to D-066):
  * Occurrences are materialized from today to about 13 months ahead.
  * Editing a subscription regenerates only its **future unpaid** occurrences (upcoming
    and due today or later). Paid and skipped rows are never touched, nor are overdue
    ones, which still need paying.
  * Pausing or cancelling deletes future upcoming occurrences; resuming regenerates them.
  * A price change is recorded with today's date and applies to regenerated occurrences.
"""

from dataclasses import dataclass
from datetime import date, timedelta

from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session as DbSession
from sqlalchemy.orm import selectinload

from app.domain import subscriptions as math
from app.errors import AppError
from app.models import (
    Subscription,
    SubscriptionOccurrence,
    SubscriptionPrice,
    Transaction,
)
from app.services import accounts as accounts_service
from app.services import categories as categories_service
from app.services import payees as payees_service

#: About 13 months (DATA_MODEL).
HORIZON_DAYS = 400

#: Changing any of these rebuilds future unpaid occurrences.
SCHEDULE_FIELDS = frozenset(
    {
        "amount_cents",
        "frequency",
        "interval_count",
        "interval_unit",
        "anchor_date",
        "day_of_month",
        "start_date",
        "end_date",
        "status",
    }
)
EDITABLE_FIELDS = SCHEDULE_FIELDS | {
    "name",
    "payee_id",
    "category_id",
    "account_id",
    "auto_post",
    "remind_days_before",
    "url",
    "notes",
}


def schedule_of(subscription: Subscription) -> math.BillSchedule:
    return math.BillSchedule(
        frequency=subscription.frequency,
        anchor=subscription.anchor_date,
        interval_count=subscription.interval_count,
        interval_unit=subscription.interval_unit,
        day_of_month=subscription.day_of_month,
        end=subscription.end_date,
    )


# ---------------------------------------------------------------------------- reading


def list_subscriptions(db: DbSession) -> list[Subscription]:
    return list(
        db.scalars(
            select(Subscription)
            .options(selectinload(Subscription.prices))
            .order_by(func.lower(Subscription.name))
        )
    )


def get_subscription(db: DbSession, subscription_id: int) -> Subscription:
    subscription = db.get(Subscription, subscription_id)
    if subscription is None:
        raise AppError(404, "Bill not found", "subscription_not_found")
    return subscription


def next_occurrence(db: DbSession, subscription_id: int) -> SubscriptionOccurrence | None:
    """The next bill still to pay: the oldest upcoming one, overdue included."""
    return db.scalars(
        select(SubscriptionOccurrence)
        .where(
            SubscriptionOccurrence.subscription_id == subscription_id,
            SubscriptionOccurrence.status == "upcoming",
        )
        .order_by(SubscriptionOccurrence.due_date)
        .limit(1)
    ).first()


@dataclass(frozen=True, slots=True)
class PriceChange:
    previous_cents: int | None
    increased: bool


def last_price_change(subscription: Subscription) -> PriceChange:
    prices = sorted(subscription.prices, key=lambda row: (row.effective_date, row.id))
    if len(prices) < 2:
        return PriceChange(previous_cents=None, increased=False)
    previous, latest = prices[-2], prices[-1]
    return PriceChange(previous.amount_cents, latest.amount_cents > previous.amount_cents)


# --------------------------------------------------------------------------- validation


def _validate(db: DbSession, subscription: Subscription) -> None:
    if not (subscription.name or "").strip():
        raise AppError(422, "A bill needs a name.", "name_required")
    if subscription.amount_cents is None or subscription.amount_cents <= 0:
        raise AppError(422, "The amount must be more than zero.", "invalid_amount")
    if subscription.frequency != "custom":
        subscription.interval_count = 1
        subscription.interval_unit = None
    problem = math.schedule_problem(schedule_of(subscription))
    if problem:
        raise AppError(422, problem, "invalid_schedule")
    if subscription.status not in ("active", "paused", "cancelled"):
        raise AppError(422, "Status is active, paused or cancelled.", "invalid_status")
    if (
        subscription.remind_days_before is not None
        and not 0 <= subscription.remind_days_before <= 60
    ):
        raise AppError(422, "Reminders go out 0 to 60 days ahead.", "invalid_reminder")
    if subscription.payee_id is not None:
        payees_service.get_payee(db, subscription.payee_id)
    if subscription.category_id is not None:
        categories_service.get_category(db, subscription.category_id)
    if subscription.account_id is not None:
        accounts_service.get_account(db, subscription.account_id)


# ------------------------------------------------------------------------- occurrences


def _fill(db: DbSession, subscription: Subscription, today: date) -> int:
    """Add any missing occurrences from today to the horizon. Returns how many."""
    if subscription.status != "active":
        return 0
    start = max(today, subscription.start_date, subscription.anchor_date)
    through = today + timedelta(days=HORIZON_DAYS)
    existing = set(
        db.scalars(
            select(SubscriptionOccurrence.due_date).where(
                SubscriptionOccurrence.subscription_id == subscription.id,
                SubscriptionOccurrence.due_date >= start,
            )
        )
    )
    added = 0
    for due in math.due_dates(schedule_of(subscription), start, through):
        if due in existing:
            continue
        db.add(
            SubscriptionOccurrence(
                subscription_id=subscription.id,
                due_date=due,
                amount_cents=subscription.amount_cents,
            )
        )
        added += 1
    return added


def regenerate(db: DbSession, subscription: Subscription, today: date) -> None:
    """Rebuild future unpaid occurrences. Paid, skipped and overdue rows stay as they are."""
    db.execute(
        delete(SubscriptionOccurrence).where(
            SubscriptionOccurrence.subscription_id == subscription.id,
            SubscriptionOccurrence.status == "upcoming",
            SubscriptionOccurrence.due_date >= today,
        )
    )
    db.flush()
    _fill(db, subscription, today)


def ensure_horizon(db: DbSession, today: date) -> int:
    """Keep every active subscription materialized ~13 months ahead. Cheap when current."""
    added = 0
    for subscription in db.scalars(select(Subscription).where(Subscription.status == "active")):
        added += _fill(db, subscription, today)
    if added:
        db.commit()
    return added


# ------------------------------------------------------------------------------ writing


def create_subscription(db: DbSession, fields: dict, *, today: date) -> Subscription:
    fields = {key: value for key, value in fields.items() if key in EDITABLE_FIELDS}
    anchor = fields.get("anchor_date") or today
    fields["anchor_date"] = anchor
    fields["start_date"] = fields.get("start_date") or anchor
    subscription = Subscription(**fields)
    subscription.status = subscription.status or "active"
    subscription.interval_count = subscription.interval_count or 1
    if subscription.remind_days_before is None:
        subscription.remind_days_before = 3
    _validate(db, subscription)
    db.add(subscription)
    db.flush()
    db.add(
        SubscriptionPrice(
            subscription_id=subscription.id,
            effective_date=min(today, anchor),
            amount_cents=subscription.amount_cents,
        )
    )
    _fill(db, subscription, today)
    db.commit()
    db.refresh(subscription)
    return subscription


def update_subscription(
    db: DbSession, subscription_id: int, changes: dict, *, today: date
) -> Subscription:
    subscription = get_subscription(db, subscription_id)
    changes = {key: value for key, value in changes.items() if key in EDITABLE_FIELDS}
    old_amount = subscription.amount_cents
    for key, value in changes.items():
        setattr(subscription, key, value)
    _validate(db, subscription)

    if subscription.amount_cents != old_amount:
        # SPEC §9: every change is kept, so the old amount and its date stay on record.
        subscription.prices.append(
            SubscriptionPrice(effective_date=today, amount_cents=subscription.amount_cents)
        )

    if SCHEDULE_FIELDS & changes.keys():
        regenerate(db, subscription, today)
    db.commit()
    db.refresh(subscription)
    return subscription


def delete_subscription(db: DbSession, subscription_id: int) -> None:
    """Deleting forgets the bill entirely; its payments stay in the ledger untouched."""
    db.delete(get_subscription(db, subscription_id))
    db.commit()


# ---------------------------------------------------------------- bills and payments


@dataclass(slots=True)
class Bill:
    occurrence: SubscriptionOccurrence
    subscription: Subscription
    overdue: bool


def bills(db: DbSession, start: date, end: date, *, today: date) -> list[Bill]:
    """Every occurrence due in [start, end], oldest first, for the calendar and dashboard."""
    ensure_horizon(db, today)
    rows = db.scalars(
        select(SubscriptionOccurrence)
        .options(selectinload(SubscriptionOccurrence.subscription))
        .where(SubscriptionOccurrence.due_date >= start, SubscriptionOccurrence.due_date <= end)
        .order_by(SubscriptionOccurrence.due_date, SubscriptionOccurrence.id)
    )
    return [
        Bill(
            occurrence=row,
            subscription=row.subscription,
            overdue=row.status == "upcoming" and row.due_date < today,
        )
        for row in rows
    ]


def get_occurrence(db: DbSession, occurrence_id: int) -> SubscriptionOccurrence:
    occurrence = db.get(SubscriptionOccurrence, occurrence_id)
    if occurrence is None:
        raise AppError(404, "That bill was not found.", "occurrence_not_found")
    return occurrence


def mark_paid(
    db: DbSession, occurrence_id: int, transaction_id: int | None = None
) -> SubscriptionOccurrence:
    occurrence = get_occurrence(db, occurrence_id)
    if transaction_id is not None:
        if db.get(Transaction, transaction_id) is None:
            raise AppError(404, "Transaction not found", "transaction_not_found")
        taken = db.scalars(
            select(SubscriptionOccurrence).where(
                SubscriptionOccurrence.transaction_id == transaction_id,
                SubscriptionOccurrence.id != occurrence.id,
            )
        ).first()
        if taken is not None:
            raise AppError(409, "That transaction already pays another bill.", "payment_linked")
    occurrence.status = "paid"
    occurrence.transaction_id = transaction_id
    db.commit()
    db.refresh(occurrence)
    return occurrence


def skip(db: DbSession, occurrence_id: int) -> SubscriptionOccurrence:
    occurrence = get_occurrence(db, occurrence_id)
    occurrence.status = "skipped"
    occurrence.transaction_id = None
    db.commit()
    db.refresh(occurrence)
    return occurrence


def reopen(db: DbSession, occurrence_id: int) -> SubscriptionOccurrence:
    """Undo a skip or a payment: back to upcoming, unlinked."""
    occurrence = get_occurrence(db, occurrence_id)
    occurrence.status = "upcoming"
    occurrence.transaction_id = None
    db.commit()
    db.refresh(occurrence)
    return occurrence


def matching_bills(
    db: DbSession,
    payee_id: int | None,
    paid_on: date,
    paid_cents: int,
    exclude: set[int] | frozenset[int] = frozenset(),
) -> list[SubscriptionOccurrence]:
    """Unpaid bills a payment could be for, best first (D-064, D-117).

    Same payee, amount within 10% or $1, paid from 14 days before the due date (never back
    past the previous due date) to 5 days after. The oldest bill comes first, so a payment
    settles an overdue bill before the next one; then the closest amount.
    """
    if payee_id is None or paid_cents >= 0:
        return []
    first, last = math.due_range_for(paid_on)
    rows = db.scalars(
        select(SubscriptionOccurrence)
        .join(Subscription, Subscription.id == SubscriptionOccurrence.subscription_id)
        .options(selectinload(SubscriptionOccurrence.subscription))
        .where(
            Subscription.payee_id == payee_id,
            SubscriptionOccurrence.status == "upcoming",
            SubscriptionOccurrence.due_date >= first,
            SubscriptionOccurrence.due_date <= last,
        )
    ).all()
    found = [
        row
        for row in rows
        if row.id not in exclude
        and math.is_match(
            bill_payee_id=row.subscription.payee_id,
            bill_cents=row.amount_cents,
            due=row.due_date,
            payee_id=payee_id,
            paid_cents=paid_cents,
            paid_on=paid_on,
            previous=math.previous_due(schedule_of(row.subscription), row.due_date),
        )
    ]
    return sorted(
        found,
        key=lambda row: (row.due_date, abs(row.amount_cents + paid_cents), row.id),
    )


def best_match(db: DbSession, transaction: Transaction) -> Bill | None:
    """The unpaid bill this transaction most plausibly pays, if any (D-064)."""
    if transaction.payee_id is None or transaction.is_transfer or transaction.amount_cents >= 0:
        return None
    already = db.scalars(
        select(SubscriptionOccurrence.id).where(
            SubscriptionOccurrence.transaction_id == transaction.id
        )
    ).first()
    if already is not None:
        return None
    found = matching_bills(db, transaction.payee_id, transaction.date, transaction.amount_cents)
    if not found:
        return None
    best = found[0]
    return Bill(occurrence=best, subscription=best.subscription, overdue=False)


@dataclass(slots=True)
class AfterCreate:
    paid_occurrence_id: int | None = None
    match: Bill | None = None


def after_transaction_created(
    db: DbSession, transaction: Transaction, occurrence_id: int | None
) -> AfterCreate:
    """Mark the named bill paid by this transaction, or suggest the bill it matches."""
    if occurrence_id is not None:
        mark_paid(db, occurrence_id, transaction.id)
        return AfterCreate(paid_occurrence_id=occurrence_id)
    return AfterCreate(match=best_match(db, transaction))


# ------------------------------------------------------------------------ the planner


def committed_by_category(db: DbSession, start: date, end: date) -> dict[int, int]:
    """Bill amounts due in [start, end] per category, skipped bills left out (SPEC §8)."""
    rows = db.execute(
        select(Subscription.category_id, func.sum(SubscriptionOccurrence.amount_cents))
        .join(Subscription, Subscription.id == SubscriptionOccurrence.subscription_id)
        .where(
            Subscription.category_id.is_not(None),
            SubscriptionOccurrence.status != "skipped",
            SubscriptionOccurrence.due_date >= start,
            SubscriptionOccurrence.due_date <= end,
        )
        .group_by(Subscription.category_id)
    ).all()
    return {category_id: int(total or 0) for category_id, total in rows}


# ---------------------------------------------------------------------- reference moves


def move_payee(db: DbSession, source_id: int, target_id: int) -> int:
    result = db.execute(
        update(Subscription)
        .where(Subscription.payee_id == source_id)
        .values(payee_id=target_id)
        .execution_options(synchronize_session=False)
    )
    db.flush()
    return int(result.rowcount or 0)


def move_category(db: DbSession, source_id: int, target_id: int) -> int:
    result = db.execute(
        update(Subscription)
        .where(Subscription.category_id == source_id)
        .values(category_id=target_id)
        .execution_options(synchronize_session=False)
    )
    db.flush()
    return int(result.rowcount or 0)


def release_payments(db: DbSession, transaction_ids: list[int]) -> int:
    """Payments being deleted: their bills go back to upcoming."""
    if not transaction_ids:
        return 0
    result = db.execute(
        update(SubscriptionOccurrence)
        .where(SubscriptionOccurrence.transaction_id.in_(transaction_ids))
        .values(status="upcoming", transaction_id=None)
        .execution_options(synchronize_session=False)
    )
    db.flush()
    return int(result.rowcount or 0)


def register() -> None:
    from app.services import references

    references.register_payee_reassigner("subscriptions", move_payee)
    references.register_category_reassigner("subscriptions", move_category)
    references.register_transaction_delete_listener("subscriptions", release_payments)
