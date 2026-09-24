"""Subscriptions, their bills (occurrences), and paying or skipping them."""

from datetime import date

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session as DbSession

from app.db import get_db
from app.domain import subscriptions as math
from app.models import Subscription
from app.schemas.subscription import (
    BillListOut,
    BillOut,
    CategoryTotalOut,
    PayIn,
    PricePointOut,
    SubscriptionIn,
    SubscriptionListOut,
    SubscriptionOut,
    SubscriptionPatch,
)
from app.services import subscriptions as service

router = APIRouter(tags=["subscriptions"])


def _subscription_out(db: DbSession, row: Subscription) -> SubscriptionOut:
    schedule = service.schedule_of(row)
    change = service.last_price_change(row)
    upcoming = service.next_occurrence(db, row.id)
    return SubscriptionOut(
        id=row.id,
        name=row.name,
        payee_id=row.payee_id,
        category_id=row.category_id,
        account_id=row.account_id,
        amount_cents=row.amount_cents,
        frequency=row.frequency,
        interval_count=row.interval_count,
        interval_unit=row.interval_unit,
        anchor_date=row.anchor_date,
        day_of_month=row.day_of_month,
        start_date=row.start_date,
        end_date=row.end_date,
        status=row.status,
        auto_post=row.auto_post,
        remind_days_before=row.remind_days_before,
        url=row.url,
        notes=row.notes,
        next_due_date=upcoming.due_date if upcoming else None,
        monthly_cents=math.monthly_cents(schedule, row.amount_cents),
        annual_cents=math.annual_cents(schedule, row.amount_cents),
        previous_amount_cents=change.previous_cents,
        price_increased=change.increased,
        price_history=[
            PricePointOut(effective_date=p.effective_date, amount_cents=p.amount_cents)
            for p in row.prices
        ],
    )


def bill_out(bill: service.Bill) -> BillOut:
    return BillOut(
        occurrence_id=bill.occurrence.id,
        subscription_id=bill.subscription.id,
        name=bill.subscription.name,
        payee_id=bill.subscription.payee_id,
        category_id=bill.subscription.category_id,
        account_id=bill.subscription.account_id,
        due_date=bill.occurrence.due_date,
        amount_cents=bill.occurrence.amount_cents,
        status=bill.occurrence.status,
        overdue=bill.overdue,
        transaction_id=bill.occurrence.transaction_id,
        url=bill.subscription.url,
    )


def _fields(payload, *, partial: bool) -> dict:
    # A create takes the schema defaults (monthly, active, 3 days); a patch only what was sent.
    fields = payload.model_dump(exclude_unset=partial)
    if fields.get("url") is not None:
        fields["url"] = str(fields["url"])
    return fields


@router.get("/subscriptions", response_model=SubscriptionListOut)
def list_subscriptions(db: DbSession = Depends(get_db)) -> SubscriptionListOut:
    service.ensure_horizon(db, date.today())
    items = [_subscription_out(db, row) for row in service.list_subscriptions(db)]
    active = [item for item in items if item.status == "active"]
    by_category: dict[int | None, list[int]] = {}
    for item in active:
        totals = by_category.setdefault(item.category_id, [0, 0])
        totals[0] += item.monthly_cents
        totals[1] += item.annual_cents
    return SubscriptionListOut(
        items=items,
        monthly_cents=sum(item.monthly_cents for item in active),
        annual_cents=sum(item.annual_cents for item in active),
        by_category=[
            CategoryTotalOut(category_id=key, monthly_cents=m, annual_cents=a)
            for key, (m, a) in sorted(by_category.items(), key=lambda kv: -kv[1][1])
        ],
    )


@router.post("/subscriptions", response_model=SubscriptionOut, status_code=201)
def create_subscription(
    payload: SubscriptionIn, db: DbSession = Depends(get_db)
) -> SubscriptionOut:
    row = service.create_subscription(db, _fields(payload, partial=False), today=date.today())
    return _subscription_out(db, row)


@router.get("/subscriptions/{subscription_id}", response_model=SubscriptionOut)
def get_subscription(subscription_id: int, db: DbSession = Depends(get_db)) -> SubscriptionOut:
    return _subscription_out(db, service.get_subscription(db, subscription_id))


@router.patch("/subscriptions/{subscription_id}", response_model=SubscriptionOut)
def update_subscription(
    subscription_id: int, payload: SubscriptionPatch, db: DbSession = Depends(get_db)
) -> SubscriptionOut:
    row = service.update_subscription(
        db, subscription_id, _fields(payload, partial=True), today=date.today()
    )
    return _subscription_out(db, row)


@router.delete("/subscriptions/{subscription_id}", status_code=204)
def delete_subscription(subscription_id: int, db: DbSession = Depends(get_db)) -> Response:
    service.delete_subscription(db, subscription_id)
    return Response(status_code=204)


@router.get("/bills", response_model=BillListOut)
def list_bills(
    start: date = Query(alias="from"),
    end: date = Query(alias="to"),
    db: DbSession = Depends(get_db),
) -> BillListOut:
    return BillListOut(
        items=[bill_out(b) for b in service.bills(db, start, end, today=date.today())]
    )


def _one_bill(db: DbSession, occurrence_id: int) -> BillOut:
    occurrence = service.get_occurrence(db, occurrence_id)
    return bill_out(
        service.Bill(
            occurrence=occurrence,
            subscription=occurrence.subscription,
            overdue=occurrence.status == "upcoming" and occurrence.due_date < date.today(),
        )
    )


@router.get("/bills/{occurrence_id}", response_model=BillOut)
def get_bill(occurrence_id: int, db: DbSession = Depends(get_db)) -> BillOut:
    return _one_bill(db, occurrence_id)


@router.post("/bills/{occurrence_id}/pay", response_model=BillOut)
def pay_bill(occurrence_id: int, payload: PayIn, db: DbSession = Depends(get_db)) -> BillOut:
    service.mark_paid(db, occurrence_id, payload.transaction_id)
    return _one_bill(db, occurrence_id)


@router.post("/bills/{occurrence_id}/skip", response_model=BillOut)
def skip_bill(occurrence_id: int, db: DbSession = Depends(get_db)) -> BillOut:
    service.skip(db, occurrence_id)
    return _one_bill(db, occurrence_id)


@router.post("/bills/{occurrence_id}/reopen", response_model=BillOut)
def reopen_bill(occurrence_id: int, db: DbSession = Depends(get_db)) -> BillOut:
    service.reopen(db, occurrence_id)
    return _one_bill(db, occurrence_id)
