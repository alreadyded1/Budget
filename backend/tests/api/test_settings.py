"""The settings singleton."""

MUTATION_HEADERS = {"X-PB-Request": "1"}
SETTINGS = "/api/v1/settings"


def test_settings_start_from_the_seeded_row(auth_client):
    response = auth_client.get(SETTINGS)

    assert response.status_code == 200
    body = response.json()
    assert body["currency_symbol"] == "$"
    assert body["week_start"] == 0
    assert body["theme_default"] == "system"


def test_patch_updates_only_what_was_sent(auth_client):
    auth_client.patch(SETTINGS, json={"household_name": "Hawkins"}, headers=MUTATION_HEADERS)
    response = auth_client.patch(SETTINGS, json={"theme_default": "dark"}, headers=MUTATION_HEADERS)

    assert response.status_code == 200
    body = response.json()
    assert body["household_name"] == "Hawkins"
    assert body["theme_default"] == "dark"


def test_invalid_values_are_rejected(auth_client):
    assert (
        auth_client.patch(
            SETTINGS, json={"theme_default": "neon"}, headers=MUTATION_HEADERS
        ).status_code
        == 422
    )
    assert (
        auth_client.patch(SETTINGS, json={"week_start": 9}, headers=MUTATION_HEADERS).status_code
        == 422
    )


def test_the_ntfy_token_is_never_returned(auth_client):
    auth_client.patch(SETTINGS, json={"ntfy_token": "secret"}, headers=MUTATION_HEADERS)

    assert "ntfy_token" not in auth_client.get(SETTINGS).json()
