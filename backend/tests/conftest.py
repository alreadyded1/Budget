"""Test setup: every run gets a throwaway SQLite file, never the dev database."""

import os
import tempfile
from collections.abc import Iterator
from pathlib import Path

import pytest

_TMP_DATA_DIR = Path(tempfile.mkdtemp(prefix="pb-tests-"))
# Set before app modules are imported: app.db builds its engine at import time.
os.environ["PB_ENV"] = "test"
os.environ["PB_DATA_DIR"] = str(_TMP_DATA_DIR)
os.environ["PB_SECRET_KEY"] = "test-secret-key"

from fastapi.testclient import TestClient  # noqa: E402

from app.api.v1.auth import login_failures  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.db import SessionLocal, engine  # noqa: E402
from app.main import create_app  # noqa: E402
from app.models import Base  # noqa: E402
from app.services import users as users_service  # noqa: E402

TEST_PASSWORD = "correct-horse-battery"


@pytest.fixture(scope="session")
def settings():
    return get_settings()


@pytest.fixture(scope="session", autouse=True)
def _schema() -> Iterator[None]:
    Base.metadata.create_all(engine)
    yield
    Base.metadata.drop_all(engine)


@pytest.fixture
def db() -> Iterator:
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture(autouse=True)
def _clean_state() -> Iterator[None]:
    """Each test starts with no users, no sessions, and no recorded login failures."""
    login_failures.clear()
    yield
    login_failures.clear()
    with SessionLocal() as session:
        for table in reversed(Base.metadata.sorted_tables):
            if table.name != "settings":
                session.execute(table.delete())
        session.commit()


@pytest.fixture
def client() -> Iterator[TestClient]:
    with TestClient(create_app()) as test_client:
        yield test_client


@pytest.fixture
def user(db):
    return users_service.create_user(db, "sam", "Sam", TEST_PASSWORD)


@pytest.fixture
def auth_client(client, user) -> TestClient:
    """A client with a live session cookie for `user`."""
    response = client.post(
        "/api/v1/auth/login",
        json={"username": user.username, "password": TEST_PASSWORD},
        headers={"X-PB-Request": "1"},
    )
    assert response.status_code == 200
    return client
