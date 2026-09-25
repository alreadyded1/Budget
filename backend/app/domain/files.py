"""What an uploaded file really is, from its first bytes (SPEC §15, D-099). Pure.

The name and the browser's declared type are never trusted: a .jpg that is really an HTML
page is refused.
"""

import re
import unicodedata
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Kind:
    mime: str
    extension: str
    is_image: bool
    #: Browsers other than Safari cannot show it, so a JPEG preview is made (D-101).
    needs_preview: bool = False


JPEG = Kind("image/jpeg", "jpg", True)
PNG = Kind("image/png", "png", True)
WEBP = Kind("image/webp", "webp", True)
HEIC = Kind("image/heic", "heic", True, needs_preview=True)
PDF = Kind("application/pdf", "pdf", False)

#: ISO-BMFF brands used by iPhone photos (HEIC/HEIF).
_HEIF_BRANDS = {b"heic", b"heix", b"hevc", b"hevx", b"heim", b"heis", b"mif1", b"msf1", b"heif"}

#: How many leading bytes sniff() needs.
SNIFF_BYTES = 32


def sniff(head: bytes) -> Kind | None:
    """The file's kind from its leading bytes, or None if it is not an allowed type."""
    if head.startswith(b"\xff\xd8\xff"):
        return JPEG
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return PNG
    if len(head) >= 12 and head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return WEBP
    if head.startswith(b"%PDF-"):
        return PDF
    if len(head) >= 12 and head[4:8] == b"ftyp" and head[8:12] in _HEIF_BRANDS:
        return HEIC
    return None


def safe_filename(name: str, fallback: str = "receipt") -> str:
    """A display name without paths, control characters or quotes; at most 120 characters."""
    name = unicodedata.normalize("NFC", name or "")
    name = name.replace("\\", "/").rsplit("/", 1)[-1]
    name = re.sub(r"[\x00-\x1f\x7f\"]", "", name).strip().strip(".")
    if not name:
        return fallback
    if len(name) > 120:
        stem, dot, ext = name.rpartition(".")
        name = (stem[: 119 - len(ext)] + dot + ext) if dot and len(ext) <= 10 else name[:120]
    return name
