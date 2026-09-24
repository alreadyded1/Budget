"""deploy/restore.sh, run for real against a scratch data directory.

The script manages systemd and a service user on the LXC; here it runs with
--no-service and --user <current user> so the file handling, the checks, the
migration and the roll-back are exercised exactly as written. It needs root (the
script refuses otherwise), so it is skipped on a normal development login.
"""

import os
import shutil
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[3]
BACKEND = REPO / "backend"
RESTORE = REPO / "deploy" / "restore.sh"

pytestmark = [
    pytest.mark.skipif(os.geteuid() != 0, reason="restore.sh must run as root"),
    pytest.mark.skipif(shutil.which("runuser") is None, reason="needs util-linux"),
]


@pytest.fixture
def box(tmp_path: Path):
    """A scratch install: data dir, env file, and an environment pointing at them."""
    data = tmp_path / "data"
    (data / "receipts").mkdir(parents=True)
    env_file = tmp_path / "payday-budget.env"
    env_file.write_text(
        f"PB_ENV=production\nPB_DATA_DIR={data}\nPB_DATABASE_PATH={data}/budget.db\n"
        "PB_SECRET_KEY=test\nPB_BACKUP_KEEP_DAYS=14\n"
    )
    env = {
        **os.environ,
        "PB_ENV": "production",
        "PB_DATA_DIR": str(data),
        "PB_DATABASE_PATH": str(data / "budget.db"),
        "PB_SECRET_KEY": "test",
    }
    return data, env_file, env


def alembic(env, target="head"):
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", target],
        cwd=BACKEND,
        env=env,
        check=True,
        capture_output=True,
    )


def pb_backup(env) -> tuple[Path, Path]:
    subprocess.run(
        [sys.executable, "-m", "app.cli", "backup"],
        cwd=BACKEND,
        env=env,
        check=True,
        capture_output=True,
    )
    backups = Path(env["PB_DATA_DIR"]) / "backups"
    db = sorted(backups.glob("budget-*.db"))[-1]
    receipts = sorted(backups.glob("receipts-*.tar.gz"))[-1]
    return db, receipts


def add_group(db: Path, name: str) -> None:
    connection = sqlite3.connect(db)
    connection.execute("INSERT INTO category_groups (name, kind) VALUES (?, 'expense')", (name,))
    connection.commit()
    connection.close()


def groups(db: Path) -> list[str]:
    connection = sqlite3.connect(db)
    try:
        return [
            row[0] for row in connection.execute("SELECT name FROM category_groups ORDER BY id")
        ]
    finally:
        connection.close()


def version(db: Path) -> str:
    connection = sqlite3.connect(db)
    try:
        return connection.execute("SELECT version_num FROM alembic_version").fetchone()[0]
    finally:
        connection.close()


def restore(env_file: Path, data: Path, *files: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        [
            "bash",
            str(RESTORE),
            "--yes",
            "--no-service",
            "--user",
            subprocess.run(["id", "-un"], capture_output=True, text=True).stdout.strip(),
            "--app-dir",
            str(REPO),
            "--env-file",
            str(env_file),
            "--data-dir",
            str(data),
            *[str(path) for path in files],
        ],
        capture_output=True,
        text=True,
    )


def test_a_backup_restores_onto_a_changed_install(box):
    data, env_file, env = box
    alembic(env)
    add_group(data / "budget.db", "Before")
    (data / "receipts" / "a.txt").write_text("original")
    db_backup, receipts_backup = pb_backup(env)

    # Life goes on after the backup.
    add_group(data / "budget.db", "After")
    (data / "receipts" / "a.txt").write_text("changed")
    (data / "receipts" / "b.txt").write_text("new")

    result = restore(env_file, data, db_backup, receipts_backup)

    assert result.returncode == 0, result.stdout + result.stderr
    assert groups(data / "budget.db") == ["Before"]
    assert (data / "receipts" / "a.txt").read_text() == "original"
    assert not (data / "receipts" / "b.txt").exists()
    # What was there before the restore is kept beside it.
    assert groups(data / "budget.db.pre-restore") == ["Before", "After"]
    assert (data / "receipts.pre-restore" / "b.txt").read_text() == "new"


def test_a_bare_file_name_is_found_in_the_backups_folder(box):
    data, env_file, env = box
    alembic(env)
    db_backup, _ = pb_backup(env)
    result = restore(env_file, data, Path(db_backup.name))
    assert result.returncode == 0, result.stdout + result.stderr
    assert "receipts are left as they are" in result.stdout


def test_an_older_backup_is_migrated_forward(box):
    data, env_file, env = box
    alembic(env, "0005")
    add_group(data / "budget.db", "Old")
    db_backup, _ = pb_backup(env)
    alembic(env)  # the live install moves on to the newest schema

    result = restore(env_file, data, db_backup)

    assert result.returncode == 0, result.stdout + result.stderr
    assert version(data / "budget.db") == version(data / "budget.db.pre-restore")
    assert groups(data / "budget.db") == ["Old"]


def test_a_corrupt_backup_changes_nothing(box, tmp_path):
    data, env_file, env = box
    alembic(env)
    add_group(data / "budget.db", "Live")
    bad = tmp_path / "budget-20260101-000000.db"
    bad.write_bytes(b"SQLite format 3\x00" + b"\x00" * 500)

    result = restore(env_file, data, bad)

    assert result.returncode != 0
    assert "Nothing was changed" in result.stderr
    assert groups(data / "budget.db") == ["Live"]
    assert not (data / "budget.db.pre-restore").exists()


def test_a_failed_migration_puts_the_previous_data_back(box, tmp_path):
    data, env_file, env = box
    alembic(env)
    add_group(data / "budget.db", "Live")
    (data / "receipts" / "keep.txt").write_text("live receipt")
    db_backup, receipts_backup = pb_backup(env)
    # A backup whose schema version this code does not know: the migration will fail.
    broken = tmp_path / "budget-20260102-000000.db"
    shutil.copy(db_backup, broken)
    connection = sqlite3.connect(broken)
    connection.execute("UPDATE alembic_version SET version_num = 'from-the-future'")
    connection.commit()
    connection.close()
    add_group(data / "budget.db", "Newer")
    (data / "receipts" / "later.txt").write_text("added after the backup")

    result = restore(env_file, data, broken, receipts_backup)

    assert result.returncode != 0
    assert "previous data is back in place" in result.stderr
    assert groups(data / "budget.db") == ["Live", "Newer"]
    assert (data / "receipts" / "later.txt").exists()
