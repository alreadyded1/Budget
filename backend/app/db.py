"""Database engine, SQLite pragmas, and the request-scoped session dependency."""

import sqlite3
from collections.abc import Generator, Iterator
from contextlib import contextmanager
from typing import Any

from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from app.config import Settings, get_settings

PRAGMAS = (
    "journal_mode=WAL",
    "foreign_keys=ON",
    "busy_timeout=5000",
    "synchronous=NORMAL",
)


def _apply_pragmas(dbapi_connection: Any, _record: Any) -> None:
    """SQLite forgets most pragmas per connection, so set them on every one."""
    if not isinstance(dbapi_connection, sqlite3.Connection):
        return
    cursor = dbapi_connection.cursor()
    try:
        for pragma in PRAGMAS:
            cursor.execute(f"PRAGMA {pragma}")
    finally:
        cursor.close()


def create_app_engine(settings: Settings | None = None) -> Engine:
    settings = settings or get_settings()
    settings.ensure_dirs()
    engine = create_engine(
        settings.database_url,
        echo=False,
        future=True,
        # A FastAPI threadpool worker may hand a connection to another thread.
        connect_args={"check_same_thread": False},
    )
    event.listen(engine, "connect", _apply_pragmas)
    return engine


engine = create_app_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency: one session per request, always closed."""
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@contextmanager
def session_scope() -> Iterator[Session]:
    """Commit-on-success session for CLI commands and jobs."""
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
