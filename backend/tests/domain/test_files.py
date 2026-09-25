"""Upload type sniffing and file names (SPEC §15)."""

from app.domain.files import HEIC, JPEG, PDF, PNG, WEBP, safe_filename, sniff


def test_sniff_by_content():
    assert sniff(b"\xff\xd8\xff\xe0\x00\x10JFIF") is JPEG
    assert sniff(b"\x89PNG\r\n\x1a\n\x00\x00") is PNG
    assert sniff(b"RIFF\x24\x00\x00\x00WEBPVP8 ") is WEBP
    assert sniff(b"%PDF-1.7\n") is PDF
    assert sniff(b"\x00\x00\x00\x18ftypheic\x00\x00\x00\x00") is HEIC
    assert sniff(b"\x00\x00\x00\x18ftypmif1\x00\x00\x00\x00") is HEIC
    assert HEIC.needs_preview and not JPEG.needs_preview


def test_refuses_everything_else():
    assert sniff(b"<html><script>") is None
    assert sniff(b"GIF89a") is None
    assert sniff(b"\x00\x00\x00\x18ftypisom\x00\x00") is None  # an MP4 video
    assert sniff(b"PK\x03\x04") is None
    assert sniff(b"") is None


def test_safe_filename():
    assert safe_filename("IMG_0042.HEIC") == "IMG_0042.HEIC"
    assert safe_filename("../../etc/passwd") == "passwd"
    assert safe_filename("C:\\Users\\me\\receipt.pdf") == "receipt.pdf"
    assert safe_filename('bad"name\x00.jpg') == "badname.jpg"
    assert safe_filename("   ") == "receipt"
    long = safe_filename("a" * 300 + ".jpeg")
    assert len(long) == 120 and long.endswith(".jpeg")
