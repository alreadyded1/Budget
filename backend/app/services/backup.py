"""Backups: a consistent copy of the database plus an archive of the receipts.

The copy uses SQLite's online backup API, so it is safe while the app is serving
requests (DEPLOYMENT.md). Each run writes a pair sharing one timestamp:

    backups/budget-20260924-023000.db
    backups/receipts-20260924-023000.tar.gz

Files are written under a temporary name and renamed into place, so a half-written
backup never looks like a real one. Pruning reads the date from the file name rather
than the mtime, and always keeps the newest pair however old it is.
"""

import re
import sqlite3
import tarfile
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path

STAMP_FORMAT = "%Y%m%d-%H%M%S"
_NAME = re.compile(r"^(?P<kind>budget|receipts)-(?P<stamp>\d{8}-\d{6})\.(?:db|tar\.gz)$")


class BackupError(Exception):
    """A backup could not be made or did not verify."""


@dataclass(frozen=True, slots=True)
class BackupSet:
    stamp: str
    database: Path | None
    receipts: Path | None

    @property
    def taken_at(self) -> datetime:
        return datetime.strptime(self.stamp, STAMP_FORMAT)


def integrity_ok(path: Path) -> bool:
    """True when SQLite's own integrity check passes on the file."""
    try:
        connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        try:
            row = connection.execute("PRAGMA integrity_check").fetchone()
        finally:
            connection.close()
    except sqlite3.DatabaseError:
        return False
    return row is not None and row[0] == "ok"


def _copy_database(source: Path, target: Path) -> None:
    partial = target.with_name(target.name + ".partial")
    partial.unlink(missing_ok=True)
    src = sqlite3.connect(f"file:{source}?mode=ro", uri=True)
    try:
        dest = sqlite3.connect(partial)
        try:
            src.backup(dest)
            # A standalone copy: fold any WAL content in and use a rollback journal.
            dest.execute("PRAGMA journal_mode=DELETE")
        finally:
            dest.close()
    finally:
        src.close()
    if not integrity_ok(partial):
        partial.unlink(missing_ok=True)
        raise BackupError(f"The copy of {source} failed its integrity check.")
    partial.replace(target)


def _archive_receipts(receipts_dir: Path, target: Path) -> None:
    partial = target.with_name(target.name + ".partial")
    partial.unlink(missing_ok=True)
    with tarfile.open(partial, "w:gz") as archive:
        if receipts_dir.is_dir():
            # Paths inside the archive are relative to the receipts folder itself.
            archive.add(receipts_dir, arcname=".")
    partial.replace(target)


def list_backups(backups_dir: Path) -> list[BackupSet]:
    """Every backup pair in the folder, newest first."""
    found: dict[str, dict[str, Path]] = {}
    if backups_dir.is_dir():
        for path in backups_dir.iterdir():
            match = _NAME.match(path.name)
            if match:
                found.setdefault(match["stamp"], {})[match["kind"]] = path
    return [
        BackupSet(stamp=stamp, database=parts.get("budget"), receipts=parts.get("receipts"))
        for stamp, parts in sorted(found.items(), reverse=True)
    ]


def prune(backups_dir: Path, keep_days: int, now: datetime) -> list[Path]:
    """Delete backups older than `keep_days`, always keeping the newest set."""
    cutoff = now - timedelta(days=keep_days)
    removed: list[Path] = []
    for index, backup in enumerate(list_backups(backups_dir)):
        if index == 0 or backup.taken_at >= cutoff:
            continue
        for path in (backup.database, backup.receipts):
            if path is not None:
                path.unlink(missing_ok=True)
                removed.append(path)
    return removed


def run_backup(
    database: Path,
    receipts_dir: Path,
    backups_dir: Path,
    *,
    keep_days: int,
    now: datetime,
) -> tuple[BackupSet, list[Path]]:
    """Make one backup pair and prune old ones. Returns the new set and what was deleted."""
    if not database.is_file():
        raise BackupError(f"There is no database at {database}.")
    backups_dir.mkdir(parents=True, exist_ok=True)
    stamp = now.strftime(STAMP_FORMAT)
    db_target = backups_dir / f"budget-{stamp}.db"
    receipts_target = backups_dir / f"receipts-{stamp}.tar.gz"
    if db_target.exists():
        raise BackupError(f"{db_target.name} already exists; try again in a second.")

    _copy_database(database, db_target)
    _archive_receipts(receipts_dir, receipts_target)
    removed = prune(backups_dir, keep_days, now)
    return BackupSet(stamp=stamp, database=db_target, receipts=receipts_target), removed
