"""Receipt attachments (SPEC §15). Uploads are the raw request body (D-099)."""

from urllib.parse import quote, unquote

from fastapi import APIRouter, Depends, Header, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session as DbSession

from app.auth import current_user
from app.db import get_db
from app.errors import AppError
from app.models import Attachment, User
from app.schemas.attachments import AttachmentChangeOut, AttachmentListOut, AttachmentOut
from app.services import attachments as service

router = APIRouter(tags=["attachments"])


def attachment_out(row: Attachment) -> AttachmentOut:
    return AttachmentOut(
        id=row.id,
        transaction_id=row.transaction_id,
        original_filename=row.original_filename,
        mime_type=row.mime_type,
        size_bytes=row.size_bytes,
        sha256=row.sha256,
        has_thumbnail=row.thumbnail_path is not None,
        has_preview=row.preview_path is not None,
        created_at=row.created_at,
    )


def _change(db: DbSession, row: Attachment, transaction_id: int) -> AttachmentChangeOut:
    return AttachmentChangeOut(
        attachment=attachment_out(row),
        transaction_id=transaction_id,
        attachment_count=service.counts(db, [transaction_id]).get(transaction_id, 0),
    )


@router.get("/transactions/{transaction_id}/attachments", response_model=AttachmentListOut)
def list_attachments(transaction_id: int, db: DbSession = Depends(get_db)) -> AttachmentListOut:
    return AttachmentListOut(
        items=[attachment_out(row) for row in service.list_for(db, transaction_id)],
        max_bytes=service.max_bytes(),
    )


@router.post(
    "/transactions/{transaction_id}/attachments",
    response_model=AttachmentChangeOut,
    status_code=201,
)
async def upload_attachment(
    transaction_id: int,
    request: Request,
    x_filename: str = Header(default="receipt", max_length=1024),
    content_length: int | None = Header(default=None),
    db: DbSession = Depends(get_db),
    user: User = Depends(current_user),
) -> AttachmentChangeOut:
    """The file is the body; its name comes URL-encoded in X-Filename."""
    if content_length is not None and content_length > service.max_bytes():
        raise service.too_large()
    await run_in_threadpool(service.list_for, db, transaction_id)  # 404 before reading
    upload = await run_in_threadpool(service.Upload)
    try:
        async for chunk in request.stream():
            upload.write(chunk)
    except AppError:
        raise
    except Exception:
        upload.discard()
        raise
    row = await run_in_threadpool(
        service.store, db, transaction_id, upload, unquote(x_filename), user_id=user.id
    )
    return _change(db, row, transaction_id)


def _file(relative: str | None, media_type: str, filename: str) -> FileResponse:
    if relative is None:
        raise AppError(404, "File not found", "attachment_missing")
    path = service.resolve(relative)
    if not path.is_file():
        raise AppError(404, "File not found", "attachment_missing")
    return FileResponse(
        path,
        media_type=media_type,
        headers={
            "Content-Disposition": f"inline; filename*=UTF-8''{quote(filename)}",
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, max-age=3600",
        },
    )


@router.get("/attachments/{attachment_id}")
def download(attachment_id: int, db: DbSession = Depends(get_db)) -> FileResponse:
    row = service.get_attachment(db, attachment_id)
    return _file(row.stored_path, row.mime_type, row.original_filename)


@router.get("/attachments/{attachment_id}/thumbnail")
def thumbnail(attachment_id: int, db: DbSession = Depends(get_db)) -> FileResponse:
    row = service.get_attachment(db, attachment_id)
    return _file(row.thumbnail_path, "image/jpeg", f"thumb-{row.id}.jpg")


@router.get("/attachments/{attachment_id}/preview")
def preview(attachment_id: int, db: DbSession = Depends(get_db)) -> FileResponse:
    """A browser-viewable image: the JPEG preview for HEIC, otherwise the original."""
    row = service.get_attachment(db, attachment_id)
    if row.preview_path:
        return _file(row.preview_path, "image/jpeg", f"{row.original_filename}.jpg")
    return _file(row.stored_path, row.mime_type, row.original_filename)


@router.delete("/attachments/{attachment_id}", response_model=AttachmentChangeOut)
def delete_attachment(attachment_id: int, db: DbSession = Depends(get_db)) -> AttachmentChangeOut:
    row = service.get_attachment(db, attachment_id)
    out = attachment_out(row)
    transaction_id = service.delete_attachment(db, attachment_id)
    return AttachmentChangeOut(
        attachment=out,
        transaction_id=transaction_id,
        attachment_count=service.counts(db, [transaction_id]).get(transaction_id, 0),
    )
