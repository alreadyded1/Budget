"""Health endpoint and the SQLite pragmas it depends on."""

from sqlalchemy import text

from app import __version__
from app.db import engine


def test_health_reports_version_and_database(client):
    response = client.get("/api/v1/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["version"] == __version__
    assert body["env"] == "test"
    assert body["database"]["ok"] is True


def test_unknown_api_route_returns_json_error(client):
    response = client.get("/api/v1/nope")

    assert response.status_code == 404
    body = response.json()
    assert body["code"] == "not_found"
    assert "detail" in body


def test_connection_pragmas_are_applied():
    with engine.connect() as connection:
        assert connection.execute(text("PRAGMA journal_mode")).scalar() == "wal"
        assert connection.execute(text("PRAGMA foreign_keys")).scalar() == 1
        assert connection.execute(text("PRAGMA busy_timeout")).scalar() == 5000
        assert connection.execute(text("PRAGMA synchronous")).scalar() == 1
