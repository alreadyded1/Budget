"""`pb run-daily`: keep the timelines extended, auto-post due bills, and send reminders.

Runs hourly from a systemd timer (D-068). Every step is idempotent:
  * extending pay periods and bill occurrences only adds what is missing
  * a bill is auto-posted at most once, because posting marks it paid
  * each notification goes out once, through notification_log (SPEC §10)
Notifications wait until the household's reminder hour; the rest runs every time.
"""

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession
from sqlalchemy.orm import selectinload

from app.domain import subscriptions as bill_math
from app.domain.money import format_cents
from app.jobs import ntfy
from app.models import Account, Subscription, SubscriptionOccurrence, Transaction
from app.services import auth as auth_service
from app.services import balances as balances_service
from app.services import notifications
from app.services import pay_schedule as pay_schedule_service
from app.services import settings as settings_service
from app.services import subscriptions as subscriptions_service
from app.services import transactions as transactions_service

#: Notifications about something that happened once, rather than a state the job sees
#: again on every run. These are queued before the reminder hour and retried if they fail.
ONE_OFF_KINDS = ("auto_post",)


@dataclass
class Report:
    periods_added: int = 0
    occurrences_added: int = 0
    posted: list[str] = field(default_factory=list)
    linked: list[str] = field(default_factory=list)
    sent: int = 0
    failed: int = 0
    skipped: int = 0
    notifications_on: bool = True
    before_reminder_hour: bool = False
    sessions_removed: int = 0

    def summary(self) -> str:
        parts = [
            f"periods +{self.periods_added}",
            f"bills +{self.occurrences_added}",
            f"posted {len(self.posted)}",
            f"linked {len(self.linked)}",
        ]
        if not self.notifications_on:
            parts.append("notifications off (no ntfy settings)")
        elif self.before_reminder_hour:
            parts.append("notifications wait for the reminder hour")
        else:
            parts.append(f"sent {self.sent}, failed {self.failed}, already sent {self.skipped}")
        parts.append(f"expired sessions {self.sessions_removed}")
        return "; ".join(parts)


def _money(db: DbSession, cents: int) -> str:
    return format_cents(cents, settings_service.get_settings_row(db).currency_symbol)


def _bill_link(occurrence: SubscriptionOccurrence) -> str:
    return notifications.app_link(
        f"/calendar?month={occurrence.due_date:%Y-%m}&bill={occurrence.id}"
    )


# ------------------------------------------------------------------------ auto-post


def _existing_payment(
    db: DbSession, subscription: Subscription, occurrence: SubscriptionOccurrence
) -> Transaction | None:
    """A payment already entered by hand for this bill, not yet linked to any bill (D-067)."""
    if subscription.payee_id is None:
        return None
    start, end = bill_math.match_window(
        occurrence.due_date,
        bill_math.previous_due(
            subscriptions_service.schedule_of(subscription), occurrence.due_date
        ),
    )
    linked = select(SubscriptionOccurrence.transaction_id).where(
        SubscriptionOccurrence.transaction_id.is_not(None)
    )
    candidates = db.scalars(
        select(Transaction).where(
            Transaction.payee_id == subscription.payee_id,
            Transaction.transfer_id.is_(None),
            Transaction.amount_cents < 0,
            Transaction.date >= start,
            Transaction.date <= end,
            Transaction.id.not_in(linked),
        )
    ).all()
    matching = [
        row
        for row in candidates
        if bill_math.amounts_match(occurrence.amount_cents, row.amount_cents)
    ]
    if not matching:
        return None
    return min(
        matching,
        key=lambda row: (
            abs((row.date - occurrence.due_date).days),
            abs(row.amount_cents + occurrence.amount_cents),
        ),
    )


def _auto_post(db: DbSession, today: date, report: Report, pending: list) -> None:
    """Post (or link) every auto-post bill that is due and still unpaid (D-067, D-071)."""
    due = db.scalars(
        select(SubscriptionOccurrence)
        .join(Subscription, Subscription.id == SubscriptionOccurrence.subscription_id)
        .options(selectinload(SubscriptionOccurrence.subscription))
        .where(
            Subscription.auto_post.is_(True),
            Subscription.status == "active",
            SubscriptionOccurrence.status == "upcoming",
            SubscriptionOccurrence.due_date <= today,
        )
        .order_by(SubscriptionOccurrence.due_date, SubscriptionOccurrence.id)
    ).all()

    for occurrence in due:
        subscription = occurrence.subscription
        label = f"{subscription.name} {_money(db, occurrence.amount_cents)}"

        match = _existing_payment(db, subscription, occurrence)
        if match is not None:
            subscriptions_service.mark_paid(db, occurrence.id, match.id)
            report.linked.append(label)
            pending.append(
                (
                    "auto_post",
                    f"occ:{occurrence.id}:auto_post",
                    ntfy.Message(
                        title=f"{subscription.name} marked paid",
                        body=f"Linked to the {label} payment you entered on {match.date}.",
                        tags=("white_check_mark",),
                        click=_bill_link(occurrence),
                    ),
                )
            )
            continue

        if subscription.account_id is None:
            pending.append(
                (
                    "auto_post",
                    f"occ:{occurrence.id}:no_account",
                    ntfy.Message(
                        title=f"Pay {subscription.name} by hand",
                        body=f"{label} was due {occurrence.due_date} but has no account to "
                        "post from. Mark it paid from the calendar.",
                        priority=4,
                        tags=("warning",),
                        click=_bill_link(occurrence),
                    ),
                )
            )
            continue

        result = transactions_service.create_transaction(
            db,
            account_id=subscription.account_id,
            on=occurrence.due_date,
            amount_cents=-occurrence.amount_cents,
            payee_id=subscription.payee_id,
            memo=f"Auto-posted: {subscription.name}",
            splits=[
                transactions_service.SplitInput(
                    -occurrence.amount_cents, category_id=subscription.category_id
                )
            ],
        )
        subscriptions_service.mark_paid(db, occurrence.id, result.transactions[0].id)
        report.posted.append(label)
        pending.append(
            (
                "auto_post",
                f"occ:{occurrence.id}:auto_post",
                ntfy.Message(
                    title=f"Posted {subscription.name}",
                    body=f"{label} was entered in the ledger for {occurrence.due_date}.",
                    tags=("white_check_mark",),
                    click=_bill_link(occurrence),
                ),
            )
        )


# --------------------------------------------------------------------- reminders


def _bill_messages(db: DbSession, today: date) -> list:
    """A reminder inside each bill's lead days, and one overdue notice (SPEC §10)."""
    messages = []
    rows = db.scalars(
        select(SubscriptionOccurrence)
        .join(Subscription, Subscription.id == SubscriptionOccurrence.subscription_id)
        .options(selectinload(SubscriptionOccurrence.subscription))
        .where(
            Subscription.status == "active",
            SubscriptionOccurrence.status == "upcoming",
            SubscriptionOccurrence.due_date <= today + timedelta(days=60),
        )
        .order_by(SubscriptionOccurrence.due_date)
    ).all()
    for occurrence in rows:
        subscription = occurrence.subscription
        label = f"{subscription.name} {_money(db, occurrence.amount_cents)}"
        if occurrence.due_date < today:
            messages.append(
                (
                    "bill_overdue",
                    f"occ:{occurrence.id}:overdue",
                    ntfy.Message(
                        title=f"Overdue: {subscription.name}",
                        body=f"{label} was due {occurrence.due_date} and is not marked paid.",
                        priority=4,
                        tags=("warning",),
                        click=_bill_link(occurrence),
                    ),
                )
            )
            continue
        lead = timedelta(days=subscription.remind_days_before)
        if occurrence.due_date - lead <= today:
            days = (occurrence.due_date - today).days
            when = "today" if days == 0 else "tomorrow" if days == 1 else f"in {days} days"
            how = (
                " It will be posted automatically."
                if subscription.auto_post and subscription.account_id is not None
                else ""
            )
            messages.append(
                (
                    "bill_due",
                    f"occ:{occurrence.id}:due",
                    ntfy.Message(
                        title=f"{subscription.name} due {when}",
                        body=f"{label} is due {occurrence.due_date}.{how}",
                        tags=("calendar",),
                        click=_bill_link(occurrence),
                    ),
                )
            )
    return messages


def _low_balance_messages(db: DbSession, today: date) -> list:
    """One alert per dip below an account's threshold (D-069)."""
    messages = []
    accounts = db.scalars(
        select(Account).where(
            Account.is_closed.is_(False), Account.low_balance_alert_cents.is_not(None)
        )
    ).all()
    for account in accounts:
        balance = balances_service.balances_for(db, account).current_cents
        if balance >= account.low_balance_alert_cents:
            account.low_balance_since = None  # recovered: the next dip alerts again
            continue
        if account.low_balance_since is None:
            account.low_balance_since = today
        messages.append(
            (
                "low_balance",
                f"acct:{account.id}:low:{account.low_balance_since.isoformat()}",
                ntfy.Message(
                    title=f"{account.name} is low",
                    body=f"The balance is {_money(db, balance)}, below your "
                    f"{_money(db, account.low_balance_alert_cents)} alert.",
                    priority=4,
                    tags=("money_with_wings",),
                    click=notifications.app_link(f"/transactions/{account.id}"),
                ),
            )
        )
    db.commit()
    return messages


# --------------------------------------------------------------------------- the job


def run_daily(
    db: DbSession, *, now: datetime | None = None, sender: ntfy.Sender | None = None
) -> Report:
    now = now or datetime.now()
    today = now.date()
    report = Report()

    if pay_schedule_service.current_schedule(db) is not None:
        report.periods_added = pay_schedule_service.ensure_horizon(db, today)
    report.occurrences_added = subscriptions_service.ensure_horizon(db, today)

    pending: list = []
    _auto_post(db, today, report, pending)
    pending += _bill_messages(db, today)
    pending += _low_balance_messages(db, today)

    report.notifications_on = notifications.target(db) is not None
    reminder_hour = settings_service.get_settings_row(db).reminder_hour
    report.before_reminder_hour = now.hour < reminder_hour
    if report.notifications_on and report.before_reminder_hour:
        # One-off events (a bill just posted) would not be seen again later; keep them.
        for kind, ref_key, message in pending:
            if kind in ONE_OFF_KINDS:
                notifications.queue(db, kind, ref_key, message)
    elif report.notifications_on:
        # First anything queued earlier or failed last time, then today's messages.
        for row in notifications.unsent(db, ONE_OFF_KINDS):
            pending.insert(0, (row.kind, row.ref_key, notifications.message_of(row)))
        for kind, ref_key, message in pending:
            outcome = notifications.notify(db, kind, ref_key, message, sender=sender)
            if outcome.status == "sent":
                report.sent += 1
            elif outcome.status == "failed":
                report.failed += 1
            elif outcome.status == "skipped":
                report.skipped += 1

    report.sessions_removed = auth_service.purge_expired_sessions(db)
    return report


def notify_failure(
    db: DbSession, unit: str, *, now: datetime | None = None, sender: ntfy.Sender | None = None
) -> notifications.Outcome:
    """Called by systemd's OnFailure= when a unit such as the nightly backup fails."""
    now = now or datetime.now()
    name = unit.removesuffix(".service")
    return notifications.notify(
        db,
        "backup_failed",
        f"{name}:{now.date().isoformat()}",
        ntfy.Message(
            title=f"{name} failed",
            body=f"The {name} job failed at {now:%H:%M}. See: journalctl -u {name} -n 50",
            priority=5,
            tags=("rotating_light",),
            click=notifications.app_link("/settings/notifications"),
        ),
        sender=sender,
    )
