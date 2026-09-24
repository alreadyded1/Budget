"""Transactions, splits, transfers, balances and the reconciled-edit guard."""

from datetime import date

import pytest

HEADERS = {"X-PB-Request": "1"}
TX = "/api/v1/transactions"
ACCOUNTS = "/api/v1/accounts"
DAY = date(2026, 9, 1).isoformat()


@pytest.fixture
def checking(auth_client):
    return auth_client.post(
        ACCOUNTS,
        json={
            "name": "Checking",
            "type": "checking",
            "opening_balance_cents": 100_000,
            "opening_date": "2026-01-01",
        },
        headers=HEADERS,
    ).json()


@pytest.fixture
def savings(auth_client):
    return auth_client.post(
        ACCOUNTS,
        json={
            "name": "Savings",
            "type": "savings",
            "opening_balance_cents": 0,
            "opening_date": "2026-01-01",
        },
        headers=HEADERS,
    ).json()


@pytest.fixture
def card(auth_client):
    return auth_client.post(
        ACCOUNTS,
        json={
            "name": "Visa",
            "type": "credit_card",
            "opening_balance_cents": 0,
            "opening_date": "2026-01-01",
        },
        headers=HEADERS,
    ).json()


@pytest.fixture
def car_loan(auth_client):
    return auth_client.post(
        ACCOUNTS,
        json={
            "name": "Car loan",
            "type": "loan",
            "opening_balance_cents": -1_200_000,
            "opening_date": "2026-01-01",
        },
        headers=HEADERS,
    ).json()


@pytest.fixture
def category(auth_client):
    group = auth_client.post(
        "/api/v1/category-groups", json={"name": "Food"}, headers=HEADERS
    ).json()
    return auth_client.post(
        "/api/v1/categories", json={"group_id": group["id"], "name": "Groceries"}, headers=HEADERS
    ).json()


def spend(client, account, cents=-5000, **overrides):
    payload = {"account_id": account["id"], "date": DAY, "amount_cents": cents}
    payload.update(overrides)
    return client.post(TX, json=payload, headers=HEADERS)


class TestSplits:
    def test_a_plain_transaction_gets_one_split(self, auth_client, checking):
        body = spend(auth_client, checking).json()

        splits = body["transactions"][0]["splits"]
        assert len(splits) == 1
        assert splits[0]["amount_cents"] == -5000
        assert splits[0]["category_id"] is None

    def test_splits_must_add_up(self, auth_client, checking, category):
        response = spend(
            auth_client,
            checking,
            -5000,
            splits=[
                {"amount_cents": -3000, "category_id": category["id"]},
                {"amount_cents": -1999, "category_id": category["id"]},
            ],
        )

        assert response.status_code == 422
        assert response.json()["code"] == "split_sum_mismatch"

    def test_a_split_transaction_keeps_every_piece(self, auth_client, checking, category):
        body = spend(
            auth_client,
            checking,
            -5000,
            splits=[
                {"amount_cents": -3000, "category_id": category["id"], "memo": "food"},
                {"amount_cents": -2000, "category_id": None, "memo": "household"},
            ],
        ).json()

        splits = body["transactions"][0]["splits"]
        assert [s["amount_cents"] for s in splits] == [-3000, -2000]
        assert sum(s["amount_cents"] for s in splits) == -5000

    def test_a_zero_split_is_refused(self, auth_client, checking):
        response = spend(
            auth_client,
            checking,
            -5000,
            splits=[{"amount_cents": -5000}, {"amount_cents": 0}],
        )

        assert response.status_code == 422
        assert response.json()["code"] == "zero_split"

    def test_changing_the_amount_carries_a_single_split_with_it(self, auth_client, checking):
        created = spend(auth_client, checking).json()["transactions"][0]

        updated = auth_client.patch(
            f"{TX}/{created['id']}", json={"amount_cents": -7500}, headers=HEADERS
        ).json()["transactions"][0]

        assert updated["splits"][0]["amount_cents"] == -7500

    def test_uncategorized_splits_are_queryable(self, auth_client, checking, category):
        spend(auth_client, checking, -1000)
        spend(
            auth_client,
            checking,
            -2000,
            splits=[{"amount_cents": -2000, "category_id": category["id"]}],
        )

        found = auth_client.get(f"{TX}?uncategorized=true").json()["items"]

        assert len(found) == 1
        assert found[0]["transaction"]["amount_cents"] == -1000


class TestBalances:
    def test_current_cleared_and_reconciled(self, auth_client, checking):
        spend(auth_client, checking, -1000)
        spend(auth_client, checking, -2000, status="cleared")
        spend(auth_client, checking, -4000, status="reconciled")

        balance = auth_client.get(f"{ACCOUNTS}/{checking['id']}/balance").json()

        assert balance["current_cents"] == 100_000 - 7000
        assert balance["cleared_cents"] == 100_000 - 6000
        assert balance["reconciled_cents"] == 100_000 - 4000

    def test_a_mutation_returns_the_balances_it_changed(self, auth_client, checking):
        body = spend(auth_client, checking, -2500).json()

        assert body["balances"] == [
            {
                "account_id": checking["id"],
                "current_cents": 97_500,
                "cleared_cents": 100_000,
                "reconciled_cents": 100_000,
            }
        ]

    def test_liability_balances_stay_negative(self, auth_client, card):
        spend(auth_client, card, -12_345)

        balance = auth_client.get(f"{ACCOUNTS}/{card['id']}/balance").json()

        assert balance["current_cents"] == -12_345

    def test_paying_a_card_moves_its_balance_toward_zero(self, auth_client, checking, card):
        spend(auth_client, card, -20_000)
        auth_client.post(
            "/api/v1/transfers",
            json={
                "from_account_id": checking["id"],
                "to_account_id": card["id"],
                "date": DAY,
                "amount_cents": 15_000,
            },
            headers=HEADERS,
        )

        balance = auth_client.get(f"{ACCOUNTS}/{card['id']}/balance").json()
        assert balance["current_cents"] == -5_000

    def test_balance_as_of_a_date(self, auth_client, checking):
        auth_client.post(
            TX,
            json={
                "account_id": checking["id"],
                "date": date(2026, 8, 1).isoformat(),
                "amount_cents": -1000,
            },
            headers=HEADERS,
        )
        spend(auth_client, checking, -2000)

        earlier = auth_client.get(
            f"{ACCOUNTS}/{checking['id']}/balance?as_of={date(2026, 8, 15)}"
        ).json()

        assert earlier["current_cents"] == 99_000

    def test_a_manual_valuation_account_uses_its_typed_balance(self, auth_client):
        house = auth_client.post(
            ACCOUNTS,
            json={
                "name": "House",
                "type": "other_asset",
                "valuation_mode": "manual",
                "opening_balance_cents": 200_000_00,
                "opening_date": "2026-01-01",
            },
            headers=HEADERS,
        ).json()
        auth_client.post(
            f"{ACCOUNTS}/{house['id']}/valuations",
            json={"date": DAY, "balance_cents": 250_000_00},
            headers=HEADERS,
        )
        spend(auth_client, house, -9_999)

        balance = auth_client.get(f"{ACCOUNTS}/{house['id']}/balance").json()

        assert balance["current_cents"] == 250_000_00


class TestTransfers:
    def test_one_call_creates_two_signed_legs(self, auth_client, checking, savings):
        body = auth_client.post(
            "/api/v1/transfers",
            json={
                "from_account_id": checking["id"],
                "to_account_id": savings["id"],
                "date": DAY,
                "amount_cents": 25_000,
            },
            headers=HEADERS,
        ).json()

        legs = body["transactions"]
        assert len(legs) == 2
        assert sorted(leg["amount_cents"] for leg in legs) == [-25_000, 25_000]
        assert legs[0]["transfer_id"] == legs[1]["transfer_id"]
        assert all(leg["splits"] == [] for leg in legs)

    def test_each_leg_names_the_account_on_the_other_side(self, auth_client, checking, savings):
        body = auth_client.post(
            "/api/v1/transfers",
            json={
                "from_account_id": checking["id"],
                "to_account_id": savings["id"],
                "date": DAY,
                "amount_cents": 25_000,
            },
            headers=HEADERS,
        ).json()
        partner = {leg["account_id"]: leg["transfer_account_id"] for leg in body["transactions"]}
        assert partner == {checking["id"]: savings["id"], savings["id"]: checking["id"]}

        # A single-account ledger page still knows where the money went.
        rows = auth_client.get(f"{TX}?account_id={checking['id']}").json()["items"]
        assert rows[0]["transaction"]["transfer_account_id"] == savings["id"]

        plain = auth_client.post(
            TX,
            json={"account_id": checking["id"], "date": DAY, "amount_cents": -100},
            headers=HEADERS,
        ).json()["transactions"][0]
        assert plain["transfer_account_id"] is None

    def test_editing_one_leg_moves_the_other(self, auth_client, checking, savings):
        legs = auth_client.post(
            "/api/v1/transfers",
            json={
                "from_account_id": checking["id"],
                "to_account_id": savings["id"],
                "date": DAY,
                "amount_cents": 25_000,
            },
            headers=HEADERS,
        ).json()["transactions"]
        out_leg = next(leg for leg in legs if leg["amount_cents"] < 0)

        updated = auth_client.patch(
            f"{TX}/{out_leg['id']}",
            json={"amount_cents": -30_000, "date": date(2026, 9, 5).isoformat()},
            headers=HEADERS,
        ).json()["transactions"]

        assert sorted(leg["amount_cents"] for leg in updated) == [-30_000, 30_000]
        assert {leg["date"] for leg in updated} == {"2026-09-05"}

    def test_deleting_one_leg_deletes_both(self, auth_client, checking, savings):
        legs = auth_client.post(
            "/api/v1/transfers",
            json={
                "from_account_id": checking["id"],
                "to_account_id": savings["id"],
                "date": DAY,
                "amount_cents": 25_000,
            },
            headers=HEADERS,
        ).json()["transactions"]

        body = auth_client.delete(f"{TX}/{legs[0]['id']}", headers=HEADERS).json()

        assert sorted(body["deleted_ids"]) == sorted(leg["id"] for leg in legs)
        assert auth_client.get(TX).json()["items"] == []

    def test_a_transfer_between_on_budget_accounts_takes_no_category(
        self, auth_client, checking, savings, category
    ):
        response = auth_client.post(
            "/api/v1/transfers",
            json={
                "from_account_id": checking["id"],
                "to_account_id": savings["id"],
                "date": DAY,
                "amount_cents": 1000,
                "category_id": category["id"],
            },
            headers=HEADERS,
        )

        assert response.status_code == 422
        assert response.json()["code"] == "transfer_category_not_allowed"

    def test_an_on_budget_to_tracking_transfer_needs_a_category(
        self, auth_client, checking, car_loan
    ):
        response = auth_client.post(
            "/api/v1/transfers",
            json={
                "from_account_id": checking["id"],
                "to_account_id": car_loan["id"],
                "date": DAY,
                "amount_cents": 30_000,
            },
            headers=HEADERS,
        )

        assert response.status_code == 422
        assert response.json()["code"] == "transfer_category_required"

    def test_the_split_sits_on_the_on_budget_leg_only(
        self, auth_client, checking, car_loan, category
    ):
        legs = auth_client.post(
            "/api/v1/transfers",
            json={
                "from_account_id": checking["id"],
                "to_account_id": car_loan["id"],
                "date": DAY,
                "amount_cents": 30_000,
                "category_id": category["id"],
            },
            headers=HEADERS,
        ).json()["transactions"]

        on_budget = next(leg for leg in legs if leg["account_id"] == checking["id"])
        tracking = next(leg for leg in legs if leg["account_id"] == car_loan["id"])

        assert len(on_budget["splits"]) == 1
        assert on_budget["splits"][0]["category_id"] == category["id"]
        assert tracking["splits"] == []

    def test_a_transfer_needs_two_accounts(self, auth_client, checking):
        response = auth_client.post(
            "/api/v1/transfers",
            json={
                "from_account_id": checking["id"],
                "to_account_id": checking["id"],
                "date": DAY,
                "amount_cents": 1000,
            },
            headers=HEADERS,
        )

        assert response.status_code == 422
        assert response.json()["code"] == "same_account"

    def test_transfers_have_no_payee(self, auth_client, checking, savings):
        legs = auth_client.post(
            "/api/v1/transfers",
            json={
                "from_account_id": checking["id"],
                "to_account_id": savings["id"],
                "date": DAY,
                "amount_cents": 1000,
            },
            headers=HEADERS,
        ).json()["transactions"]
        payee = auth_client.post("/api/v1/payees", json={"name": "Shop"}, headers=HEADERS).json()

        response = auth_client.patch(
            f"{TX}/{legs[0]['id']}", json={"payee_id": payee["id"]}, headers=HEADERS
        )

        assert response.status_code == 422
        assert response.json()["code"] == "transfer_has_no_payee"


class TestReconciledProtection:
    def test_changing_the_amount_needs_confirmation(self, auth_client, checking):
        created = spend(auth_client, checking, status="reconciled").json()["transactions"][0]

        refused = auth_client.patch(
            f"{TX}/{created['id']}", json={"amount_cents": -9999}, headers=HEADERS
        )

        assert refused.status_code == 409
        assert refused.json()["code"] == "reconciled_edit_requires_confirm"

    def test_confirm_lets_it_through(self, auth_client, checking):
        created = spend(auth_client, checking, status="reconciled").json()["transactions"][0]

        allowed = auth_client.patch(
            f"{TX}/{created['id']}?confirm=true", json={"amount_cents": -9999}, headers=HEADERS
        )

        assert allowed.status_code == 200
        assert allowed.json()["transactions"][0]["amount_cents"] == -9999

    def test_the_date_and_account_are_protected_too(self, auth_client, checking, savings):
        created = spend(auth_client, checking, status="reconciled").json()["transactions"][0]

        assert (
            auth_client.patch(
                f"{TX}/{created['id']}", json={"date": "2026-10-01"}, headers=HEADERS
            ).status_code
            == 409
        )
        assert (
            auth_client.patch(
                f"{TX}/{created['id']}", json={"account_id": savings["id"]}, headers=HEADERS
            ).status_code
            == 409
        )

    def test_a_memo_or_category_fix_needs_no_confirmation(self, auth_client, checking, category):
        created = spend(auth_client, checking, status="reconciled").json()["transactions"][0]

        memo = auth_client.patch(
            f"{TX}/{created['id']}", json={"memo": "corrected"}, headers=HEADERS
        )
        recategorized = auth_client.patch(
            f"{TX}/{created['id']}",
            json={"splits": [{"amount_cents": -5000, "category_id": category["id"]}]},
            headers=HEADERS,
        )

        assert memo.status_code == 200
        assert recategorized.status_code == 200

    def test_deleting_a_reconciled_transaction_needs_confirmation(self, auth_client, checking):
        created = spend(auth_client, checking, status="reconciled").json()["transactions"][0]

        refused = auth_client.delete(f"{TX}/{created['id']}", headers=HEADERS)
        assert refused.status_code == 409

        allowed = auth_client.delete(f"{TX}/{created['id']}?confirm=true", headers=HEADERS)
        assert allowed.status_code == 200
