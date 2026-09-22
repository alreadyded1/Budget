"""Household settings: exactly one row, id = 1."""

from sqlalchemy import Boolean, CheckConstraint, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin

SETTINGS_ID = 1


class Settings(TimestampMixin, Base):
    __tablename__ = "settings"
    __table_args__ = (
        CheckConstraint("id = 1", name="ck_settings_single_row"),
        CheckConstraint("week_start BETWEEN 0 AND 6", name="ck_settings_week_start"),
        CheckConstraint("reminder_hour BETWEEN 0 AND 23", name="ck_settings_reminder_hour"),
        CheckConstraint(
            "theme_default IN ('light', 'dark', 'system')", name="ck_settings_theme_default"
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=SETTINGS_ID)
    household_name: Mapped[str] = mapped_column(String(120), default="Household")
    currency_symbol: Mapped[str] = mapped_column(String(8), default="$")
    week_start: Mapped[int] = mapped_column(Integer, default=0)  # 0 = Sunday
    theme_default: Mapped[str] = mapped_column(String(16), default="system")

    # ntfy settings exist in the schema from the start; their UI arrives in Phase 9.
    ntfy_url: Mapped[str | None] = mapped_column(String(255), default=None)
    ntfy_topic: Mapped[str | None] = mapped_column(String(120), default=None)
    ntfy_token: Mapped[str | None] = mapped_column(String(255), default=None)
    reminder_hour: Mapped[int] = mapped_column(Integer, default=7)

    prefill_last_amount: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
