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
        # Settings too: the singleton is recreated with defaults on first read, so one
        # test's ntfy or reminder settings never leak into the next.
        for table in reversed(Base.metadata.sorted_tables):
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


@pytest.fixture(autouse=True)
def _restore_registries() -> Iterator[None]:
    """Keep a test's stub handlers from leaking into the next one.

    The real transaction handlers are registered once at import (app/services/__init__.py).
    A test that registers a stub under the same name would otherwise remove the real one
    on the way out, and every later test would silently lose it.
    """
    from app.services import payees as payees_service
    from app.services import references

    registries = (
        references._payee_reassigners,
        references._category_reassigners,
        references._category_counters,
        references._transaction_delete_listeners,
    )
    snapshots = [dict(registry) for registry in registries]
    provider = payees_service._usage_provider
    yield
    for registry, snapshot in zip(registries, snapshots, strict=True):
        registry.clear()
        registry.update(snapshot)
    payees_service.set_usage_provider(provider)


@pytest.fixture
def lock(auth_client):
    """Reconcile a transaction the only way there is (D-080): tick it, then finish.

    Every other cleared row on that account up to the same date is reconciled with it.
    """
    headers = {"X-PB-Request": "1"}

    def _lock(transaction: dict) -> dict:
        account, on = transaction["account_id"], transaction["date"]
        if transaction["status"] != "cleared":
            ticked = auth_client.patch(
                f"/api/v1/transactions/{transaction['id']}",
                json={"status": "cleared"},
                headers=headers,
            )
            assert ticked.status_code == 200, ticked.text
        sheet = auth_client.get(f"/api/v1/accounts/{account}/reconcile?statement_date={on}").json()
        done = auth_client.post(
            f"/api/v1/accounts/{account}/reconciliations",
            json={
                "statement_date": on,
                "statement_balance_cents": sheet["reconciled_cents"] + sheet["ticked_cents"],
            },
            headers=headers,
        )
        assert done.status_code == 201, done.text
        return {**transaction, "status": "reconciled"}

    return _lock
