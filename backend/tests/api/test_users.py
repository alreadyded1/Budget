"""Household member management and its lockout guard rails."""

from sqlalchemy import select

from app.models import Session, User
from tests.conftest import TEST_PASSWORD

USERS = "/api/v1/users"
MUTATION_HEADERS = {"X-PB-Request": "1"}
STRONG_PASSWORD = "a-perfectly-fine-passphrase"


def test_list_users(auth_client):
    response = auth_client.get(USERS)

    assert response.status_code == 200
    assert [u["username"] for u in response.json()["items"]] == ["sam"]


def test_create_a_user(auth_client):
    response = auth_client.post(
        USERS,
        json={"username": "alex", "display_name": "Alex", "password": STRONG_PASSWORD},
        headers=MUTATION_HEADERS,
    )

    assert response.status_code == 201
    assert response.json()["username"] == "alex"
    assert "password" not in response.json()


def test_usernames_are_unique_case_insensitively(auth_client):
    response = auth_client.post(
        USERS,
        json={"username": "SAM", "display_name": "Sam again", "password": STRONG_PASSWORD},
        headers=MUTATION_HEADERS,
    )

    assert response.status_code == 409
    assert response.json()["code"] == "username_taken"


def test_short_passwords_are_rejected(auth_client):
    response = auth_client.post(
        USERS,
        json={"username": "alex", "display_name": "Alex", "password": "short"},
        headers=MUTATION_HEADERS,
    )

    assert response.status_code == 422
    assert response.json()["code"] == "password_too_weak"


def test_a_new_user_can_log_in(client, auth_client, db):
    auth_client.post(
        USERS,
        json={"username": "alex", "display_name": "Alex", "password": STRONG_PASSWORD},
        headers=MUTATION_HEADERS,
    )

    response = client.post(
        "/api/v1/auth/login",
        json={"username": "alex", "password": STRONG_PASSWORD},
        headers=MUTATION_HEADERS,
    )
    assert response.status_code == 200


def test_you_cannot_disable_yourself(auth_client, user):
    response = auth_client.patch(
        f"{USERS}/{user.id}", json={"is_active": False}, headers=MUTATION_HEADERS
    )

    assert response.status_code == 409
    assert response.json()["code"] == "cannot_disable_self"


def test_the_last_active_user_cannot_be_disabled(auth_client, user, db):
    other = auth_client.post(
        USERS,
        json={"username": "alex", "display_name": "Alex", "password": STRONG_PASSWORD},
        headers=MUTATION_HEADERS,
    ).json()

    # Disable the other account, leaving only the signed-in user active.
    assert (
        auth_client.patch(
            f"{USERS}/{other['id']}", json={"is_active": False}, headers=MUTATION_HEADERS
        ).status_code
        == 200
    )

    # Now make someone else the actor and try to disable the last active account.
    db.expire_all()
    sam = db.get(User, user.id)
    sam.is_active = True
    db.commit()

    response = auth_client.patch(
        f"{USERS}/{user.id}", json={"is_active": False}, headers=MUTATION_HEADERS
    )
    assert response.status_code == 409


def test_disabling_a_user_ends_their_sessions(client, auth_client, db):
    created = auth_client.post(
        USERS,
        json={"username": "alex", "display_name": "Alex", "password": STRONG_PASSWORD},
        headers=MUTATION_HEADERS,
    ).json()

    # Alex signs in from their own browser.
    alex = client.__class__(client.app)
    alex.post(
        "/api/v1/auth/login",
        json={"username": "alex", "password": STRONG_PASSWORD},
        headers=MUTATION_HEADERS,
    )
    assert alex.get("/api/v1/auth/me").status_code == 200

    auth_client.patch(
        f"{USERS}/{created['id']}", json={"is_active": False}, headers=MUTATION_HEADERS
    )

    assert alex.get("/api/v1/auth/me").status_code == 401
    assert db.scalars(select(Session).where(Session.user_id == created["id"])).first() is None


def test_renaming_a_user(auth_client, user):
    response = auth_client.patch(
        f"{USERS}/{user.id}", json={"display_name": "Samantha"}, headers=MUTATION_HEADERS
    )

    assert response.status_code == 200
    assert response.json()["display_name"] == "Samantha"


def test_resetting_your_own_password_keeps_you_signed_in(auth_client, user):
    response = auth_client.post(
        f"{USERS}/{user.id}/password",
        json={"password": STRONG_PASSWORD},
        headers=MUTATION_HEADERS,
    )

    assert response.status_code == 200
    assert auth_client.get("/api/v1/auth/me").status_code == 200


def test_resetting_someone_elses_password_signs_them_out(client, auth_client):
    created = auth_client.post(
        USERS,
        json={"username": "alex", "display_name": "Alex", "password": STRONG_PASSWORD},
        headers=MUTATION_HEADERS,
    ).json()

    alex = client.__class__(client.app)
    alex.post(
        "/api/v1/auth/login",
        json={"username": "alex", "password": STRONG_PASSWORD},
        headers=MUTATION_HEADERS,
    )
    assert alex.get("/api/v1/auth/me").status_code == 200

    auth_client.post(
        f"{USERS}/{created['id']}/password",
        json={"password": "another-good-passphrase"},
        headers=MUTATION_HEADERS,
    )

    assert alex.get("/api/v1/auth/me").status_code == 401
    assert (
        client.post(
            "/api/v1/auth/login",
            json={"username": "alex", "password": "another-good-passphrase"},
            headers=MUTATION_HEADERS,
        ).status_code
        == 200
    )


def test_unknown_user_returns_404(auth_client):
    response = auth_client.patch(
        f"{USERS}/9999", json={"display_name": "Ghost"}, headers=MUTATION_HEADERS
    )

    assert response.status_code == 404
    assert response.json()["code"] == "user_not_found"


def test_the_old_password_stops_working_after_a_reset(client, user, auth_client):
    auth_client.post(
        f"{USERS}/{user.id}/password",
        json={"password": "a-brand-new-passphrase"},
        headers=MUTATION_HEADERS,
    )

    fresh = client.__class__(client.app)
    assert (
        fresh.post(
            "/api/v1/auth/login",
            json={"username": "sam", "password": TEST_PASSWORD},
            headers=MUTATION_HEADERS,
        ).status_code
        == 401
    )
