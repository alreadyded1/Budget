"""Receipt attachments (SPEC §15). The files live under the receipts directory, never in the DB."""

from sqlalchemy import ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class Attachment(TimestampMixin, Base):
    __tablename__ = "attachments"

    id: Mapped[int] = mapped_column(primary_key=True)
    #: Deleting the transaction deletes the row; the service deletes the files (D-100).
    transaction_id: Mapped[int] = mapped_column(
        ForeignKey("transactions.id", ondelete="CASCADE"), index=True
    )
    original_filename: Mapped[str] = mapped_column(String(255))
    #: Relative to the receipts directory, e.g. 2026/09/<uuid>.jpg.
    stored_path: Mapped[str] = mapped_column(String(255))
    mime_type: Mapped[str] = mapped_column(String(64))
    size_bytes: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String(64))
    #: A small JPEG for lists; null for PDFs.
    thumbnail_path: Mapped[str | None] = mapped_column(String(255), default=None)
    #: A browser-viewable JPEG for formats browsers cannot show (HEIC); null otherwise (D-101).
    preview_path: Mapped[str | None] = mapped_column(String(255), default=None)
    uploaded_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), default=None)
