"""Sending notifications exactly once, and the log behind that promise (SPEC §10).

`notify()` looks up (kind, ref_key): a successful row means it already went out and
nothing happens; a failed row is retried; no row means a first attempt. Every attempt
is recorded, so Settings → Notifications can show what happened and why.
"""

import json
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.config import get_settings
from app.errors import AppError
from app.jobs import ntfy
from app.models import NotificationLog, utcnow
from app.services import settings as settings_service


@dataclass(frozen=True, slots=True)
class Outcome:
    #: "sent", "failed", "skipped" (already sent), or "off" (ntfy not configured)
    status: str
    error: str | None = None


def target(db: DbSession) -> ntfy.Target | None:
    row = settings_service.get_settings_row(db)
    if not (row.ntfy_url and row.ntfy_topic):
        return None
    return ntfy.Target(url=row.ntfy_url, topic=row.ntfy_topic, token=row.ntfy_token or None)


def app_link(path: str) -> str:
    """An absolute link into the app, for a notification's click action."""
    return get_settings().base_url.rstrip("/") + path


def already_sent(db: DbSession, kind: str, ref_key: str) -> bool:
    row = _row(db, kind, ref_key)
    return row is not None and row.success


def _row(db: DbSession, kind: str, ref_key: str) -> NotificationLog | None:
    return db.scalars(
        select(NotificationLog).where(
            NotificationLog.kind == kind, NotificationLog.ref_key == ref_key
        )
    ).first()


#: Written on a queued row until the reminder hour lets it go out.
QUEUED = "waiting for the reminder hour"


def _payload(message: ntfy.Message) -> str:
    return json.dumps(
        {"priority": message.priority, "tags": list(message.tags), "click": message.click}
    )


def message_of(row: NotificationLog) -> ntfy.Message:
    extra = json.loads(row.payload or "{}")
    return ntfy.Message(
        title=row.title,
        body=row.message,
        priority=extra.get("priority", 3),
        tags=tuple(extra.get("tags", ())),
        click=extra.get("click"),
    )


def queue(db: DbSession, kind: str, ref_key: str, message: ntfy.Message) -> Outcome:
    """Record a one-off notification to send once the reminder hour comes (D-072)."""
    if _row(db, kind, ref_key) is not None:
        return Outcome("skipped")
    if target(db) is None:
        return Outcome("off")
    db.add(
        NotificationLog(
            kind=kind,
            ref_key=ref_key,
            title=message.title,
            message=message.body,
            payload=_payload(message),
            success=False,
            error=QUEUED,
        )
    )
    db.commit()
    return Outcome("queued")


def unsent(db: DbSession, kinds: tuple[str, ...]) -> list[NotificationLog]:
    """Queued or failed one-off notifications, oldest first."""
    return list(
        db.scalars(
            select(NotificationLog)
            .where(NotificationLog.kind.in_(kinds), NotificationLog.success.is_(False))
            .order_by(NotificationLog.id)
        )
    )


def notify(
    db: DbSession,
    kind: str,
    ref_key: str,
    message: ntfy.Message,
    *,
    sender: ntfy.Sender | None = None,
) -> Outcome:
    existing = _row(db, kind, ref_key)
    if existing is not None and existing.success:
        return Outcome("skipped")
    where = target(db)
    if where is None:
        return Outcome("off")

    row = existing or NotificationLog(kind=kind, ref_key=ref_key)
    row.title = message.title
    row.message = message.body
    row.payload = _payload(message)
    row.sent_at = utcnow()
    try:
        # Looked up at call time, so tests can swap the real client out.
        (sender or ntfy.send)(where, message)
    except ntfy.SendError as exc:
        row.success = False
        row.error = str(exc)
    else:
        row.success = True
        row.error = None
    db.add(row)
    db.commit()
    return Outcome("sent" if row.success else "failed", row.error)


def send_test(db: DbSession, *, sender: ntfy.Sender | None = None) -> Outcome:
    if target(db) is None:
        raise AppError(422, "Set the ntfy server URL and topic first.", "ntfy_not_configured")
    stamp = datetime.now().isoformat(timespec="microseconds")
    message = ntfy.Message(
        title="Payday Budget test",
        body="Notifications are working.",
        priority=2,
        tags=("bell",),
        click=app_link("/settings/notifications"),
    )
    return notify(db, "test", f"test:{stamp}", message, sender=sender)


def recent(db: DbSession, limit: int = 100) -> list[NotificationLog]:
    return list(
        db.scalars(
            select(NotificationLog)
            .order_by(NotificationLog.sent_at.desc(), NotificationLog.id.desc())
            .limit(max(1, min(limit, 500)))
        )
    )
