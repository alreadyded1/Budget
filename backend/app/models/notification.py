"""Every notification the app has tried to send (DATA_MODEL "Notifications").

The unique (kind, ref_key) pair is what makes each notification go out once: a
successful row means "already sent"; a failed row is retried on the next run.
"""

from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, utcnow

NOTIFICATION_KINDS = (
    "bill_due",
    "bill_overdue",
    "low_balance",
    "auto_post",
    "backup_failed",
    "test",
)


class NotificationLog(Base):
    __tablename__ = "notification_log"
    __table_args__ = (
        UniqueConstraint("kind", "ref_key", name="uq_notification_log_kind_ref"),
        CheckConstraint(
            "kind IN (" + ", ".join(repr(kind) for kind in NOTIFICATION_KINDS) + ")",
            name="ck_notification_log_kind",
        ),
        Index("ix_notification_log_sent_at", "sent_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(24))
    #: What it is about, e.g. "occ:123:due" or "acct:4:low:2026-10-01".
    ref_key: Mapped[str] = mapped_column(String(120))
    title: Mapped[str] = mapped_column(Text, default="")
    message: Mapped[str] = mapped_column(Text, default="")
    #: UTC, like every audit timestamp. Updated on each retry.
    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    success: Mapped[bool] = mapped_column(Boolean, default=False)
    error: Mapped[str | None] = mapped_column(Text, default=None)
    #: The rest of the message (priority, tags, click) as JSON, so a queued or failed
    #: one-off notification can be sent later exactly as it was written.
    payload: Mapped[str | None] = mapped_column(Text, default=None)
