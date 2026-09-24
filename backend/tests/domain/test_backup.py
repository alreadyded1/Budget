"""Backups: the database copy, the receipts archive, verification and pruning."""

import sqlite3
import tarfile
from datetime import datetime, timedelta
from pathlib import Path

import pytest

from app.services import backup

NOW = datetime(2026, 9, 24, 2, 30, 0)


@pytest.fixture
def data(tmp_path: Path) -> Path:
    """A live WAL-mode database with a row still in the WAL, plus two receipts."""
    db = tmp_path / "budget.db"
    connection = sqlite3.connect(db)
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, amount_cents INTEGER)")
    connection.execute("INSERT INTO t (amount_cents) VALUES (-4520)")
    connection.commit()
    # Left open, like the running app: the insert may still live only in the WAL.
    receipts = tmp_path / "receipts" / "2026" / "09"
    receipts.mkdir(parents=True)
    (receipts / "kroger.jpg").write_bytes(b"\xff\xd8 jpeg bytes")
    (tmp_path / "receipts" / "note.pdf").write_bytes(b"%PDF-1.7")
    yield tmp_path
    connection.close()


def run(data: Path, now: datetime = NOW, keep_days: int = 14):
    return backup.run_backup(
        data / "budget.db",
        data / "receipts",
        data / "backups",
        keep_days=keep_days,
        now=now,
    )


def test_it_writes_a_verified_copy_and_a_receipts_archive(data):
    made, removed = run(data)

    assert made.database == data / "backups" / "budget-20260924-023000.db"
    assert made.receipts == data / "backups" / "receipts-20260924-023000.tar.gz"
    assert removed == []
    assert backup.integrity_ok(made.database)

    copy = sqlite3.connect(made.database)
    assert copy.execute("SELECT amount_cents FROM t").fetchall() == [(-4520,)]
    # A standalone file: no WAL sidecar needed to read it.
    assert copy.execute("PRAGMA journal_mode").fetchone()[0] == "delete"
    copy.close()

    with tarfile.open(made.receipts) as archive:
        names = sorted(name for name in archive.getnames() if name != ".")
    assert names == ["./2026", "./2026/09", "./2026/09/kroger.jpg", "./note.pdf"]


def test_no_partial_files_are_left_behind(data):
    run(data)
    assert not list((data / "backups").glob("*.partial"))


def test_an_empty_receipts_folder_still_gets_an_archive(tmp_path):
    sqlite3.connect(tmp_path / "budget.db").close()
    made, _ = backup.run_backup(
        tmp_path / "budget.db",
        tmp_path / "receipts",
        tmp_path / "backups",
        keep_days=14,
        now=NOW,
    )
    with tarfile.open(made.receipts) as archive:
        assert [name for name in archive.getnames() if name != "."] == []


def test_a_missing_database_is_an_error(tmp_path):
    with pytest.raises(backup.BackupError):
        backup.run_backup(
            tmp_path / "nope.db", tmp_path, tmp_path / "backups", keep_days=14, now=NOW
        )


def test_a_second_backup_in_the_same_second_is_refused(data):
    run(data)
    with pytest.raises(backup.BackupError):
        run(data)


def test_a_corrupt_file_fails_the_integrity_check(tmp_path):
    bad = tmp_path / "bad.db"
    bad.write_bytes(b"SQLite format 3\x00" + b"\x00" * 200)
    assert not backup.integrity_ok(bad)
    assert not backup.integrity_ok(tmp_path / "missing.db")


class TestPruning:
    def test_old_sets_go_and_recent_ones_stay(self, data):
        for days in (20, 15, 14, 3):
            run(data, now=NOW - timedelta(days=days))

        made, removed = run(data)

        # Every run prunes: the 20-day set went when the 3-day one was taken, and this
        # run removes the 15-day set.
        names = sorted(path.name for path in removed)
        assert names == ["budget-20260909-023000.db", "receipts-20260909-023000.tar.gz"]
        left = [entry.stamp for entry in backup.list_backups(data / "backups")]
        # Exactly 14 days old is inside the window.
        assert left == ["20260924-023000", "20260921-023000", "20260910-023000"]

    def test_the_newest_set_survives_however_old(self, data):
        run(data, now=NOW - timedelta(days=400))
        removed = backup.prune(data / "backups", keep_days=14, now=NOW)
        assert removed == []
        assert len(backup.list_backups(data / "backups")) == 1

    def test_other_files_are_never_touched(self, data):
        (data / "backups").mkdir()
        stray = data / "backups" / "budget.db.pre-restore"
        stray.write_bytes(b"keep me")
        run(data, now=NOW - timedelta(days=100))
        run(data)
        assert stray.exists()


def test_listing_pairs_the_files_newest_first(data):
    run(data, now=NOW - timedelta(days=1))
    run(data)
    (
        data
        / "backups"
        / f"receipts-{(NOW - timedelta(days=1)).strftime(backup.STAMP_FORMAT)}.tar.gz"
    ).unlink()

    sets = backup.list_backups(data / "backups")

    assert [entry.stamp for entry in sets] == ["20260924-023000", "20260923-023000"]
    assert sets[1].receipts is None
    assert sets[1].database is not None
