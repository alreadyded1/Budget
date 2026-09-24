"""What a payee merge and a category delete actually move, now that transactions exist.

This closes the Phase 3 "Done when" box for transactions; subscriptions and rules
register with the same registry in Phases 8 and 10.
"""

import pytest

HEADERS = {"X-PB-Request": "1"}
TX = "/api/v1/transactions"
PAYEES = "/api/v1/payees"
CATEGORIES = "/api/v1/categories"


@pytest.fixture
def checking(auth_client):
    return auth_client.post(
        "/api/v1/accounts",
        json={
            "name": "Checking",
            "type": "checking",
            "opening_balance_cents": 100_000,
            "opening_date": "2026-01-01",
        },
        headers=HEADERS,
    ).json()


@pytest.fixture
def group(auth_client):
    return auth_client.post(
        "/api/v1/category-groups", json={"name": "Food"}, headers=HEADERS
    ).json()


def make_category(client, group, name):
    return client.post(
        CATEGORIES, json={"group_id": group["id"], "name": name}, headers=HEADERS
    ).json()


def add(client, account, cents, **overrides):
    payload = {"account_id": account["id"], "date": "2026-09-01", "amount_cents": cents}
    payload.update(overrides)
    return client.post(TX, json=payload, headers=HEADERS).json()["transactions"][0]


class TestPayeeMerge:
    def test_merging_moves_the_transactions(self, auth_client, checking):
        target = auth_client.post(PAYEES, json={"name": "Kroger"}, headers=HEADERS).json()
        source = auth_client.post(PAYEES, json={"name": "Kroger Fuel"}, headers=HEADERS).json()
        moved_rows = [add(auth_client, checking, -1000 * n, payee_id=source["id"]) for n in (1, 2)]
        stayed = add(auth_client, checking, -500, payee_id=target["id"])

        body = auth_client.post(
            f"{PAYEES}/{target['id']}/merge", json={"source_id": source["id"]}, headers=HEADERS
        ).json()

        assert body["moved"]["transactions"] == 2
        for row in moved_rows + [stayed]:
            assert auth_client.get(f"{TX}/{row['id']}").json()["payee_id"] == target["id"]

    def test_the_merged_payee_inherits_the_usage_stats(self, auth_client, checking):
        target = auth_client.post(PAYEES, json={"name": "Kroger"}, headers=HEADERS).json()
        source = auth_client.post(PAYEES, json={"name": "Kroger Fuel"}, headers=HEADERS).json()
        add(auth_client, checking, -2500, payee_id=source["id"])
        add(auth_client, checking, -1500, payee_id=target["id"])

        auth_client.post(
            f"{PAYEES}/{target['id']}/merge", json={"source_id": source["id"]}, headers=HEADERS
        )

        row = auth_client.get(PAYEES).json()["items"][0]
        assert row["name"] == "Kroger"
        assert row["transaction_count"] == 2
        assert row["total_spent_cents"] == 4000
        assert row["last_used"] == "2026-09-01"


class TestPayeeUsage:
    def test_usage_stats_are_real_now(self, auth_client, checking):
        payee = auth_client.post(PAYEES, json={"name": "Kroger"}, headers=HEADERS).json()
        add(auth_client, checking, -1234, payee_id=payee["id"])

        row = auth_client.get(PAYEES).json()["items"][0]

        assert row["transaction_count"] == 1
        assert row["total_spent_cents"] == 1234
        assert row["last_used"] == "2026-09-01"

    def test_autofill_comes_from_the_newest_transaction(self, auth_client, checking, group):
        category = make_category(auth_client, group, "Groceries")
        payee = auth_client.post(PAYEES, json={"name": "Kroger"}, headers=HEADERS).json()
        add(auth_client, checking, -1000, payee_id=payee["id"], date="2026-08-01")
        add(
            auth_client,
            checking,
            -4321,
            payee_id=payee["id"],
            splits=[{"amount_cents": -4321, "category_id": category["id"]}],
        )

        row = auth_client.get(PAYEES).json()["items"][0]

        assert row["last_category_id"] == category["id"]
        assert row["last_amount_cents"] == -4321

    def test_a_split_newest_transaction_autofills_no_category(self, auth_client, checking, group):
        category = make_category(auth_client, group, "Groceries")
        payee = auth_client.post(PAYEES, json={"name": "Target"}, headers=HEADERS).json()
        add(
            auth_client,
            checking,
            -3000,
            payee_id=payee["id"],
            splits=[
                {"amount_cents": -2000, "category_id": category["id"]},
                {"amount_cents": -1000, "category_id": None},
            ],
        )

        row = auth_client.get(PAYEES).json()["items"][0]

        assert row["last_category_id"] is None
        assert row["last_amount_cents"] == -3000

    def test_an_unused_payee_has_nothing_to_autofill(self, auth_client):
        auth_client.post(PAYEES, json={"name": "New"}, headers=HEADERS)

        row = auth_client.get(PAYEES).json()["items"][0]

        assert row["last_category_id"] is None
        assert row["last_amount_cents"] is None

    def test_a_payee_with_transactions_cannot_be_deleted(self, auth_client, checking):
        payee = auth_client.post(PAYEES, json={"name": "Kroger"}, headers=HEADERS).json()
        add(auth_client, checking, -1000, payee_id=payee["id"])

        response = auth_client.delete(f"{PAYEES}/{payee['id']}", headers=HEADERS)

        assert response.status_code == 409
        assert response.json()["code"] == "payee_in_use"


class TestCategoryDelete:
    def test_a_category_with_splits_needs_a_reassignment_target(self, auth_client, checking, group):
        doomed = make_category(auth_client, group, "Doomed")
        add(
            auth_client,
            checking,
            -1000,
            splits=[{"amount_cents": -1000, "category_id": doomed["id"]}],
        )

        response = auth_client.delete(f"{CATEGORIES}/{doomed['id']}", headers=HEADERS)

        assert response.status_code == 409
        assert response.json()["code"] == "category_in_use"

    def test_reassignment_moves_the_splits(self, auth_client, checking, group):
        doomed = make_category(auth_client, group, "Doomed")
        keep = make_category(auth_client, group, "Keep")
        row = add(
            auth_client,
            checking,
            -1000,
            splits=[{"amount_cents": -1000, "category_id": doomed["id"]}],
        )

        deleted = auth_client.delete(
            f"{CATEGORIES}/{doomed['id']}?reassign_to={keep['id']}", headers=HEADERS
        )

        assert deleted.status_code == 204
        splits = auth_client.get(f"{TX}/{row['id']}").json()["splits"]
        assert splits[0]["category_id"] == keep["id"]

    def test_an_unused_category_still_deletes_cleanly(self, auth_client, group):
        spare = make_category(auth_client, group, "Spare")

        assert auth_client.delete(f"{CATEGORIES}/{spare['id']}", headers=HEADERS).status_code == 204
