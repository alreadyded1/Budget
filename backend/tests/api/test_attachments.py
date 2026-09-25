"""Receipt attachments (SPEC §15): upload, thumbnails, auth, size limit, cleanup."""

import hashlib
import io
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from pillow_heif import register_heif_opener

from app.main import create_app
from app.models import Attachment
from app.services import attachments as attachments_service

register_heif_opener()
HEADERS = {"X-PB-Request": "1"}


def image_bytes(fmt: str, size=(40, 20), orientation: int | None = None) -> bytes:
    image = Image.new("RGB", size, "teal")
    out = io.BytesIO()
    if orientation is not None:
        exif = Image.Exif()
        exif[0x0112] = orientation
        image.save(out, fmt, exif=exif)
    else:
        image.save(out, fmt)
    return out.getvalue()


PDF = b"%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n"


def upload(client, transaction_id, content, name="receipt.jpg", headers=None):
    return client.post(
        f"/api/v1/transactions/{transaction_id}/attachments",
        content=content,
        headers={
            **HEADERS,
            "X-Filename": name,
            "Content-Type": "application/octet-stream",
            **(headers or {}),
        },
    )


@pytest.fixture
def tx(auth_client):
    account = auth_client.post(
        "/api/v1/accounts", json={"name": "Checking", "type": "checking"}, headers=HEADERS
    ).json()
    body = auth_client.post(
        "/api/v1/transactions",
        json={"account_id": account["id"], "date": "2026-09-02", "amount_cents": -4520},
        headers=HEADERS,
    ).json()
    return body["transactions"][0]


def files_of(db, attachment_id) -> list[Path]:
    row = db.get(Attachment, attachment_id)
    db.refresh(row)
    return [
        attachments_service.resolve(p)
        for p in (row.stored_path, row.thumbnail_path, row.preview_path)
        if p
    ]


def tmp_leftovers() -> list[Path]:
    folder = attachments_service.receipts_dir() / "tmp"
    return list(folder.glob("*.part")) if folder.exists() else []


class TestUpload:
    def test_a_photo_gets_an_upright_thumbnail(self, auth_client, tx, db):
        # A 40×20 photo taken with the phone turned: orientation 6 means "rotate 90°".
        content = image_bytes("JPEG", orientation=6)
        response = upload(auth_client, tx["id"], content, "IMG_0042.JPG")

        assert response.status_code == 201, response.text
        body = response.json()
        assert body["attachment_count"] == 1
        attachment = body["attachment"]
        assert attachment["mime_type"] == "image/jpeg"
        assert attachment["original_filename"] == "IMG_0042.JPG"
        assert attachment["size_bytes"] == len(content)
        assert attachment["sha256"] == hashlib.sha256(content).hexdigest()
        assert attachment["has_thumbnail"] and not attachment["has_preview"]

        original = auth_client.get(f"/api/v1/attachments/{attachment['id']}")
        assert original.content == content  # kept exactly as uploaded
        assert original.headers["x-content-type-options"] == "nosniff"
        thumb = auth_client.get(f"/api/v1/attachments/{attachment['id']}/thumbnail")
        assert thumb.headers["content-type"] == "image/jpeg"
        with Image.open(io.BytesIO(thumb.content)) as image:
            assert image.size == (20, 40)
            assert not image.getexif()  # no metadata carried over

        stored = files_of(db, attachment["id"])[0]
        assert stored.suffix == ".jpg"
        assert stored.parent.parent.parent == attachments_service.receipts_dir().resolve()

    def test_heic_gets_a_viewable_preview(self, auth_client, tx):
        attachment = upload(
            auth_client, tx["id"], image_bytes("HEIF", (80, 60)), "IMG_1.HEIC"
        ).json()["attachment"]
        assert attachment["mime_type"] == "image/heic"
        assert attachment["has_preview"]
        preview = auth_client.get(f"/api/v1/attachments/{attachment['id']}/preview")
        assert preview.headers["content-type"] == "image/jpeg"
        with Image.open(io.BytesIO(preview.content)) as image:
            assert image.format == "JPEG" and image.size == (80, 60)

    def test_png_webp_and_pdf(self, auth_client, tx):
        for content, name, mime in (
            (image_bytes("PNG"), "scan.png", "image/png"),
            (image_bytes("WEBP"), "scan.webp", "image/webp"),
            (PDF, "invoice.pdf", "application/pdf"),
        ):
            response = upload(auth_client, tx["id"], content, name)
            assert response.status_code == 201, (name, response.text)
            assert response.json()["attachment"]["mime_type"] == mime
        pdf = response.json()["attachment"]
        assert not pdf["has_thumbnail"]
        assert auth_client.get(f"/api/v1/attachments/{pdf['id']}/thumbnail").status_code == 404
        assert auth_client.get(f"/api/v1/attachments/{pdf['id']}/preview").content == PDF

        listed = auth_client.get(f"/api/v1/transactions/{tx['id']}/attachments").json()
        assert [a["original_filename"] for a in listed["items"]] == [
            "scan.png",
            "scan.webp",
            "invoice.pdf",
        ]
        assert listed["max_bytes"] == 10 * 1024 * 1024
        ledger = auth_client.get("/api/v1/transactions").json()["items"]
        assert ledger[0]["transaction"]["attachment_count"] == 3

    def test_the_name_is_cleaned_and_can_be_unicode(self, auth_client, tx):
        response = upload(auth_client, tx["id"], PDF, "..%2F..%2Fcaf%C3%A9%20bill.pdf")
        assert response.json()["attachment"]["original_filename"] == "café bill.pdf"
        download = auth_client.get(f"/api/v1/attachments/{response.json()['attachment']['id']}")
        assert "filename*=UTF-8''caf%C3%A9%20bill.pdf" in download.headers["content-disposition"]

    def test_disguised_and_broken_files_are_refused(self, auth_client, tx):
        html = upload(auth_client, tx["id"], b"<html><script>alert(1)</script>", "receipt.jpg")
        assert html.status_code == 415
        assert html.json()["code"] == "unsupported_file_type"
        broken = upload(auth_client, tx["id"], b"\xff\xd8\xff\xe0" + b"\x00" * 200, "broken.jpg")
        assert broken.status_code == 415
        assert broken.json()["code"] == "unreadable_image"
        empty = upload(auth_client, tx["id"], b"", "empty.pdf")
        assert empty.status_code == 422
        assert tmp_leftovers() == []
        assert auth_client.get(f"/api/v1/transactions/{tx['id']}/attachments").json()["items"] == []

    def test_an_unknown_transaction_is_a_404(self, auth_client):
        assert upload(auth_client, 99_999, PDF).status_code == 404


class TestSizeLimit:
    @pytest.fixture
    def one_mb(self, settings, monkeypatch):
        monkeypatch.setattr(settings, "max_upload_mb", 1)

    def test_a_declared_size_over_the_limit_is_refused_before_reading(
        self, auth_client, tx, one_mb
    ):
        response = upload(auth_client, tx["id"], PDF + b"0" * (1024 * 1024))
        assert response.status_code == 413
        assert response.json() == {
            "detail": "That file is over the 1 MB limit.",
            "code": "file_too_large",
        }

    def test_a_streamed_upload_is_cut_off_at_the_limit(self, auth_client, tx, one_mb):
        def chunks():
            yield PDF
            for _ in range(20):
                yield b"0" * 100_000

        response = upload(auth_client, tx["id"], chunks())
        assert response.status_code == 413
        assert tmp_leftovers() == []
        assert auth_client.get(f"/api/v1/transactions/{tx['id']}/attachments").json()["items"] == []


class TestAuth:
    def test_receipts_need_a_session(self, auth_client, tx):
        attachment = upload(auth_client, tx["id"], PDF, "a.pdf").json()["attachment"]
        with TestClient(create_app()) as stranger:
            for path in (
                f"/api/v1/attachments/{attachment['id']}",
                f"/api/v1/attachments/{attachment['id']}/thumbnail",
                f"/api/v1/attachments/{attachment['id']}/preview",
                f"/api/v1/transactions/{tx['id']}/attachments",
            ):
                response = stranger.get(path)
                assert response.status_code == 401, path
                assert b"%PDF" not in response.content
            assert upload(stranger, tx["id"], PDF).status_code == 401
            assert (
                stranger.delete(
                    f"/api/v1/attachments/{attachment['id']}", headers=HEADERS
                ).status_code
                == 401
            )

    def test_uploads_need_the_csrf_header(self, auth_client, tx):
        response = auth_client.post(
            f"/api/v1/transactions/{tx['id']}/attachments",
            content=PDF,
            headers={"X-Filename": "a.pdf"},
        )
        assert response.status_code == 403


class TestDeleting:
    def test_deleting_an_attachment_removes_its_files(self, auth_client, tx, db):
        attachment = upload(auth_client, tx["id"], image_bytes("HEIF"), "x.heic").json()[
            "attachment"
        ]
        paths = files_of(db, attachment["id"])
        assert len(paths) == 3 and all(p.exists() for p in paths)
        response = auth_client.delete(f"/api/v1/attachments/{attachment['id']}", headers=HEADERS)
        assert response.json()["attachment_count"] == 0
        assert not any(p.exists() for p in paths)

    def test_deleting_a_transaction_removes_its_files(self, auth_client, tx, db):
        a = upload(auth_client, tx["id"], image_bytes("JPEG"), "a.jpg").json()["attachment"]
        b = upload(auth_client, tx["id"], PDF, "b.pdf").json()["attachment"]
        paths = files_of(db, a["id"]) + files_of(db, b["id"])
        assert (
            auth_client.delete(f"/api/v1/transactions/{tx['id']}", headers=HEADERS).status_code
            == 200
        )
        assert not any(p.exists() for p in paths)
        db.expire_all()
        assert db.get(Attachment, a["id"]) is None

    def test_bulk_delete_and_transfers_too(self, auth_client, tx, db):
        other = auth_client.post(
            "/api/v1/accounts", json={"name": "Savings", "type": "savings"}, headers=HEADERS
        ).json()
        transfer = auth_client.post(
            "/api/v1/transfers",
            json={
                "from_account_id": tx["account_id"],
                "to_account_id": other["id"],
                "date": "2026-09-03",
                "amount_cents": 1000,
            },
            headers=HEADERS,
        ).json()["transactions"]
        leg = upload(auth_client, transfer[1]["id"], PDF, "leg.pdf").json()["attachment"]
        mine = upload(auth_client, tx["id"], PDF, "mine.pdf").json()["attachment"]
        paths = files_of(db, leg["id"]) + files_of(db, mine["id"])
        response = auth_client.post(
            "/api/v1/transactions/bulk/delete",
            json={"ids": [tx["id"], transfer[0]["id"]]},
            headers=HEADERS,
        )
        assert response.status_code == 200
        assert not any(p.exists() for p in paths)

    def test_a_rolled_back_delete_keeps_the_files(self, auth_client, tx, db):
        attachment = upload(auth_client, tx["id"], PDF, "keep.pdf").json()["attachment"]
        paths = files_of(db, attachment["id"])
        attachments_service.forget_transactions(db, [tx["id"]])
        db.rollback()
        assert all(p.exists() for p in paths)
        db.commit()  # nothing pending any more
        assert all(p.exists() for p in paths)
