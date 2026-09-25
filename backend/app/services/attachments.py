"""Receipt attachments (SPEC §15, D-099 to D-102).

Files live under the receipts directory as YYYY/MM/<uuid>.<ext>, with a JPEG thumbnail
(<uuid>.thumb.jpg) beside images and a JPEG preview (<uuid>.preview.jpg) beside HEIC photos.
An upload is streamed to a temporary file, checked by content, hashed, and only then moved
into place, so a failed upload leaves nothing behind. Files are removed only after the
database change that dropped their rows has committed (D-100).
"""

import hashlib
import os
import uuid
from collections.abc import Iterable
from datetime import UTC, datetime
from pathlib import Path

from PIL import Image, ImageOps
from pillow_heif import register_heif_opener
from sqlalchemy import event, func, select
from sqlalchemy.orm import Session as DbSession

from app.config import get_settings
from app.domain import files
from app.errors import AppError
from app.models import Attachment, Transaction

register_heif_opener()
#: A receipt photo is a few megapixels; anything past this is a decompression bomb.
Image.MAX_IMAGE_PIXELS = 60_000_000

THUMBNAIL_SIZE = (256, 256)
PREVIEW_SIZE = (1600, 1600)
_PENDING = "pb_files_to_remove"


def receipts_dir() -> Path:
    return get_settings().receipts_dir


def max_bytes() -> int:
    return get_settings().max_upload_mb * 1024 * 1024


def too_large() -> AppError:
    return AppError(
        413,
        f"That file is over the {get_settings().max_upload_mb} MB limit.",
        "file_too_large",
    )


def resolve(relative: str) -> Path:
    """An absolute path inside the receipts directory, refusing anything that escapes it."""
    root = receipts_dir().resolve()
    path = (root / relative).resolve()
    if root not in path.parents:
        raise AppError(404, "File not found", "attachment_missing")
    return path


# --------------------------------------------------------------------------------- upload


class Upload:
    """Collects a streamed upload into a temporary file, counting and hashing as it goes."""

    def __init__(self) -> None:
        folder = receipts_dir() / "tmp"
        folder.mkdir(parents=True, exist_ok=True)
        self.path = folder / f"{uuid.uuid4().hex}.part"
        self._file = self.path.open("wb")
        self._hash = hashlib.sha256()
        self.size = 0
        self.head = b""
        self._limit = max_bytes()

    def write(self, chunk: bytes) -> None:
        self.size += len(chunk)
        if self.size > self._limit:
            self.discard()
            raise too_large()
        if len(self.head) < files.SNIFF_BYTES:
            self.head += chunk[: files.SNIFF_BYTES - len(self.head)]
        self._hash.update(chunk)
        self._file.write(chunk)

    def close(self) -> None:
        if not self._file.closed:
            self._file.close()

    def discard(self) -> None:
        self.close()
        self.path.unlink(missing_ok=True)

    @property
    def sha256(self) -> str:
        return self._hash.hexdigest()


def _jpeg(image: Image.Image, size: tuple[int, int], target: Path) -> None:
    """A fresh JPEG: rotated upright, shrunk, with no metadata carried over (D-101)."""
    upright = ImageOps.exif_transpose(image)
    upright.thumbnail(size)
    if upright.mode not in ("RGB", "L"):
        upright = upright.convert("RGB")
    upright.save(target, "JPEG", quality=85, optimize=True)


def store(
    db: DbSession,
    transaction_id: int,
    upload: Upload,
    filename: str,
    *,
    user_id: int | None = None,
) -> Attachment:
    """Check the finished upload, move it into place and record it."""
    upload.close()
    try:
        if db.get(Transaction, transaction_id) is None:
            raise AppError(404, "Transaction not found", "transaction_not_found")
        if upload.size == 0:
            raise AppError(422, "That file is empty.", "file_empty")
        kind = files.sniff(upload.head)
        if kind is None:
            raise AppError(
                415,
                "Receipts can be JPG, PNG, WEBP, HEIC or PDF files.",
                "unsupported_file_type",
            )

        now = datetime.now(UTC)
        folder = f"{now:%Y}/{now:%m}"
        stem = uuid.uuid4().hex
        (receipts_dir() / folder).mkdir(parents=True, exist_ok=True)
        stored = f"{folder}/{stem}.{kind.extension}"
        thumb = preview = None
        made: list[Path] = []
        try:
            if kind.is_image:
                try:
                    with Image.open(upload.path) as image:
                        image.load()
                        thumb = f"{folder}/{stem}.thumb.jpg"
                        _jpeg(image, THUMBNAIL_SIZE, receipts_dir() / thumb)
                        made.append(receipts_dir() / thumb)
                        if kind.needs_preview:
                            preview = f"{folder}/{stem}.preview.jpg"
                            _jpeg(image, PREVIEW_SIZE, receipts_dir() / preview)
                            made.append(receipts_dir() / preview)
                except (OSError, SyntaxError, ValueError, Image.DecompressionBombError) as exc:
                    raise AppError(
                        415, "That image could not be read.", "unreadable_image"
                    ) from exc
            os.replace(upload.path, receipts_dir() / stored)
            made.append(receipts_dir() / stored)

            attachment = Attachment(
                transaction_id=transaction_id,
                original_filename=files.safe_filename(filename),
                stored_path=stored,
                mime_type=kind.mime,
                size_bytes=upload.size,
                sha256=upload.sha256,
                thumbnail_path=thumb,
                preview_path=preview,
                uploaded_by=user_id,
            )
            db.add(attachment)
            db.commit()
        except Exception:
            db.rollback()
            for path in made:
                path.unlink(missing_ok=True)
            raise
        db.refresh(attachment)
        return attachment
    finally:
        upload.discard()


# ---------------------------------------------------------------------------------- reads


def get_attachment(db: DbSession, attachment_id: int) -> Attachment:
    attachment = db.get(Attachment, attachment_id)
    if attachment is None:
        raise AppError(404, "Attachment not found", "attachment_not_found")
    return attachment


def list_for(db: DbSession, transaction_id: int) -> list[Attachment]:
    if db.get(Transaction, transaction_id) is None:
        raise AppError(404, "Transaction not found", "transaction_not_found")
    return list(
        db.scalars(
            select(Attachment)
            .where(Attachment.transaction_id == transaction_id)
            .order_by(Attachment.id)
        )
    )


def counts(db: DbSession, transaction_ids: Iterable[int]) -> dict[int, int]:
    ids = list(transaction_ids)
    if not ids:
        return {}
    rows = db.execute(
        select(Attachment.transaction_id, func.count())
        .where(Attachment.transaction_id.in_(ids))
        .group_by(Attachment.transaction_id)
    ).all()
    return {int(key): int(value) for key, value in rows}


# -------------------------------------------------------------------------------- deletes


def _paths(attachment: Attachment) -> list[str]:
    return [
        path
        for path in (attachment.stored_path, attachment.thumbnail_path, attachment.preview_path)
        if path
    ]


def _remove_after_commit(db: DbSession, relative_paths: Iterable[str]) -> None:
    db.info.setdefault(_PENDING, []).extend(relative_paths)


def delete_attachment(db: DbSession, attachment_id: int) -> int:
    attachment = get_attachment(db, attachment_id)
    transaction_id = attachment.transaction_id
    _remove_after_commit(db, _paths(attachment))
    db.delete(attachment)
    db.commit()
    return transaction_id


def forget_transactions(db: DbSession, transaction_ids: list[int]) -> int:
    """Transactions about to be deleted: their files go once the delete commits (D-100)."""
    if not transaction_ids:
        return 0
    rows = db.scalars(
        select(Attachment).where(Attachment.transaction_id.in_(transaction_ids))
    ).all()
    for attachment in rows:
        _remove_after_commit(db, _paths(attachment))
    return len(rows)


@event.listens_for(DbSession, "after_commit")
def _unlink_committed(session: DbSession) -> None:
    for relative in session.info.pop(_PENDING, []):
        try:
            resolve(relative).unlink(missing_ok=True)
        except AppError:
            continue


@event.listens_for(DbSession, "after_rollback")
def _keep_on_rollback(session: DbSession) -> None:
    session.info.pop(_PENDING, None)


def register() -> None:
    from app.services import references

    references.register_transaction_delete_listener("attachments", forget_transactions)
