"""Login, session lifetime, CSRF header, and lockout."""

from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from app.models import Session, User
from app.services import auth as auth_service
from tests.conftest import TEST_PASSWORD

LOGIN = "/api/v1/auth/login"
MUTATION_HEADERS = {"X-PB-Request": "1"}


def _login(client, username="sam", password=TEST_PASSWORD):
    return client.post(
        LOGIN, json={"username": username, "password": password}, headers=MUTATION_HEADERS
    )


def test_login_succeeds_and_sets_an_httponly_cookie(client, user):
    response = _login(client)

    assert response.status_code == 200
    assert response.json()["user"]["username"] == "sam"

    cookie = response.headers["set-cookie"]
    assert "HttpOnly" in cookie
    assert "SameSite=lax" in cookie
    # Secure is production-only so http://localhost works in development.
    assert "Secure" not in cookie


def test_login_stores_only_the_hash_of_the_token(client, user, db):
    response = _login(client)
    raw_token = response.cookies[auth_service.SESSION_COOKIE]

    stored = db.scalars(select(Session)).one()
    assert stored.token_hash != raw_token
    assert stored.token_hash == auth_service.token_hash(raw_token)


def test_login_fails_on_a_bad_password(client, user):
    response = _login(client, password="not-the-password")

    assert response.status_code == 401
    assert response.json()["code"] == "invalid_credentials"
    assert "set-cookie" not in response.headers


def test_login_fails_for_an_unknown_user(client):
    response = _login(client, username="nobody", password="whatever-long-enough")

    assert response.status_code == 401
    assert response.json()["code"] == "invalid_credentials"


def test_a_disabled_user_cannot_log_in(client, user, db):
    user.is_active = False
    db.commit()

    assert _login(client).status_code == 401


def test_lockout_after_five_failures(client, user):
    for _ in range(5):
        assert _login(client, password="wrong-password-here").status_code == 401

    # The sixth attempt is refused even with the right password.
    response = _login(client)
    assert response.status_code == 429
    assert response.json()["code"] == "too_many_attempts"


def test_a_successful_login_clears_the_failure_count(client, user):
    for _ in range(4):
        _login(client, password="wrong-password-here")

    assert _login(client).status_code == 200

    for _ in range(4):
        assert _login(client, password="wrong-password-here").status_code == 401
    assert _login(client).status_code == 200


def test_protected_routes_reject_anonymous_callers(client):
    response = client.get("/api/v1/settings")

    assert response.status_code == 401
    assert response.json()["code"] == "unauthenticated"


def test_mutations_require_the_request_header(auth_client):
    response = auth_client.patch("/api/v1/settings", json={"household_name": "Nope"})

    assert response.status_code == 403
    assert response.json()["code"] == "missing_request_header"

    allowed = auth_client.patch(
        "/api/v1/settings", json={"household_name": "Yes"}, headers=MUTATION_HEADERS
    )
    assert allowed.status_code == 200


def test_an_expired_session_is_rejected_and_cleaned_up(auth_client, db):
    session = db.scalars(select(Session)).one()
    session.expires_at = datetime.now(UTC) - timedelta(minutes=1)
    db.commit()

    response = auth_client.get("/api/v1/auth/me")

    assert response.status_code == 401
    assert response.json()["code"] == "session_expired"
    assert db.scalars(select(Session)).first() is None


def test_using_a_session_slides_its_expiry(auth_client, db):
    session = db.scalars(select(Session)).one()
    session.expires_at = datetime.now(UTC) + timedelta(days=2)
    db.commit()

    assert auth_client.get("/api/v1/auth/me").status_code == 200

    db.expire_all()
    refreshed = db.scalars(select(Session)).one()
    assert refreshed.expires_at.replace(tzinfo=UTC) > datetime.now(UTC) + timedelta(days=29)


def test_me_returns_the_signed_in_user(auth_client):
    response = auth_client.get("/api/v1/auth/me")

    assert response.status_code == 200
    assert response.json()["username"] == "sam"


def test_logout_clears_the_session_server_side(auth_client, db):
    assert db.scalars(select(Session)).first() is not None

    response = auth_client.post("/api/v1/auth/logout", headers=MUTATION_HEADERS)

    assert response.status_code == 204
    assert db.scalars(select(Session)).first() is None
    assert auth_client.get("/api/v1/auth/me").status_code == 401


def test_login_records_last_login_at(client, user, db):
    assert user.last_login_at is None

    _login(client)

    db.expire_all()
    assert db.scalars(select(User)).one().last_login_at is not None
