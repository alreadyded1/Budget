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

from app.config import get_settings  # noqa: E402
from app.main import create_app  # noqa: E402


@pytest.fixture(scope="session")
def settings():
    return get_settings()


@pytest.fixture(scope="session")
def client() -> Iterator[TestClient]:
    with TestClient(create_app()) as test_client:
        yield test_client
