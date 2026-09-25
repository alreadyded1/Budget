"""Receipt attachment schemas (SPEC §15)."""

import datetime

from pydantic import BaseModel, ConfigDict


class AttachmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    transaction_id: int
    original_filename: str
    mime_type: str
    size_bytes: int
    sha256: str
    has_thumbnail: bool
    has_preview: bool
    created_at: datetime.datetime


class AttachmentListOut(BaseModel):
    items: list[AttachmentOut]
    #: The upload limit, so the browser can check before sending.
    max_bytes: int


class AttachmentChangeOut(BaseModel):
    """What an upload or delete changed: the file and the transaction's new count."""

    attachment: AttachmentOut
    transaction_id: int
    attachment_count: int
