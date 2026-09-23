"""Accounts: CRUD, close and reopen, debt fields, manual valuations."""

from datetime import date

HEADERS = {"X-PB-Request": "1"}
ACCOUNTS = "/api/v1/accounts"


def make_account(client, **overrides):
    payload = {"name": "Everyday Checking", "type": "checking", "opening_balance_cents": 125_00}
    payload.update(overrides)
    return client.post(ACCOUNTS, json=payload, headers=HEADERS)


def test_create_defaults_on_budget_from_the_type(auth_client):
    checking = make_account(auth_client).json()
    mortgage = make_account(auth_client, name="Mortgage", type="mortgage").json()

    assert checking["on_budget"] is True
    assert mortgage["on_budget"] is False
    assert mortgage["is_liability"] is True


def test_on_budget_can_be_overridden(auth_client):
    account = make_account(auth_client, name="Brokerage", type="investment", on_budget=True).json()

    assert account["on_budget"] is True


def test_names_are_unique_case_insensitively(auth_client):
    make_account(auth_client)
    clash = make_account(auth_client, name="everyday checking")

    assert clash.status_code == 409
    assert clash.json()["code"] == "account_name_taken"


def test_unknown_type_is_rejected(auth_client):
    response = make_account(auth_client, type="crypto")

    assert response.status_code == 422


def test_debt_fields_round_trip_in_basis_points(auth_client):
    card = make_account(
        auth_client,
        name="Visa",
        type="credit_card",
        apr_bps=2499,
        min_payment_cents=3500,
        payment_due_day=17,
    ).json()

    assert card["apr_bps"] == 2499
    assert card["min_payment_cents"] == 3500
    assert card["payment_due_day"] == 17


def test_money_stays_an_integer_number_of_cents(auth_client):
    account = make_account(auth_client, opening_balance_cents=-4211).json()

    assert account["opening_balance_cents"] == -4211
    assert isinstance(account["opening_balance_cents"], int)


def test_close_and_reopen_keep_the_account(auth_client):
    account = make_account(auth_client).json()

    closed = auth_client.post(f"{ACCOUNTS}/{account['id']}/close", headers=HEADERS).json()
    assert closed["is_closed"] is True

    listed = auth_client.get(f"{ACCOUNTS}?include_closed=false").json()["items"]
    assert listed == []

    reopened = auth_client.post(f"{ACCOUNTS}/{account['id']}/reopen", headers=HEADERS).json()
    assert reopened["is_closed"] is False
    assert len(auth_client.get(ACCOUNTS).json()["items"]) == 1


def test_rename_an_account(auth_client):
    account = make_account(auth_client).json()

    renamed = auth_client.patch(
        f"{ACCOUNTS}/{account['id']}", json={"name": "Joint Checking"}, headers=HEADERS
    ).json()

    assert renamed["name"] == "Joint Checking"


def test_reorder_accounts(auth_client):
    first = make_account(auth_client, name="A").json()
    second = make_account(auth_client, name="B").json()

    reordered = auth_client.post(
        f"{ACCOUNTS}/reorder", json={"ordered_ids": [second["id"], first["id"]]}, headers=HEADERS
    ).json()["items"]

    assert [row["name"] for row in reordered] == ["B", "A"]


def test_manual_valuations(auth_client):
    account = make_account(
        auth_client, name="House", type="other_asset", valuation_mode="manual"
    ).json()

    created = auth_client.post(
        f"{ACCOUNTS}/{account['id']}/valuations",
        json={"date": date(2026, 9, 1).isoformat(), "balance_cents": 250_000_00},
        headers=HEADERS,
    )
    assert created.status_code == 201

    # The same day twice updates rather than duplicating.
    auth_client.post(
        f"{ACCOUNTS}/{account['id']}/valuations",
        json={"date": date(2026, 9, 1).isoformat(), "balance_cents": 255_000_00},
        headers=HEADERS,
    )
    items = auth_client.get(f"{ACCOUNTS}/{account['id']}/valuations").json()["items"]

    assert len(items) == 1
    assert items[0]["balance_cents"] == 255_000_00


def test_valuations_are_refused_for_transaction_backed_accounts(auth_client):
    account = make_account(auth_client).json()

    response = auth_client.post(
        f"{ACCOUNTS}/{account['id']}/valuations",
        json={"date": date(2026, 9, 1).isoformat(), "balance_cents": 100},
        headers=HEADERS,
    )

    assert response.status_code == 409
    assert response.json()["code"] == "account_not_manually_valued"


def test_unknown_account_is_404(auth_client):
    assert auth_client.get(f"{ACCOUNTS}/999").status_code == 404


def test_accounts_need_a_session(client):
    assert client.get(ACCOUNTS).status_code == 401
