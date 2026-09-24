"""The ledger query: filters, running balance, pagination and bulk actions."""

from datetime import date, timedelta

import pytest

HEADERS = {"X-PB-Request": "1"}
TX = "/api/v1/transactions"
ACCOUNTS = "/api/v1/accounts"


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
def category(auth_client):
    group = auth_client.post(
        "/api/v1/category-groups", json={"name": "Food"}, headers=HEADERS
    ).json()
    return auth_client.post(
        "/api/v1/categories", json={"group_id": group["id"], "name": "Groceries"}, headers=HEADERS
    ).json()


@pytest.fixture
def payee(auth_client):
    return auth_client.post("/api/v1/payees", json={"name": "Kroger"}, headers=HEADERS).json()


def add(client, account, on, cents, **overrides):
    payload = {"account_id": account["id"], "date": on.isoformat(), "amount_cents": cents}
    payload.update(overrides)
    return client.post(TX, json=payload, headers=HEADERS).json()["transactions"][0]


class TestRunningBalance:
    def test_it_walks_the_account_forward_from_the_opening_balance(self, auth_client, checking):
        base = date(2026, 9, 1)
        add(auth_client, checking, base, -1000)
        add(auth_client, checking, base + timedelta(days=1), -2000)
        add(auth_client, checking, base + timedelta(days=2), 500)

        rows = auth_client.get(f"{TX}?account_id={checking['id']}").json()["items"]

        # Newest first, so the running balances count down.
        assert [row["running_balance_cents"] for row in rows] == [97_500, 97_000, 99_000]

    def test_it_is_absent_when_no_single_account_is_named(self, auth_client, checking, savings):
        add(auth_client, checking, date(2026, 9, 1), -1000)
        add(auth_client, savings, date(2026, 9, 1), -2000)

        rows = auth_client.get(TX).json()["items"]

        assert all(row["running_balance_cents"] is None for row in rows)

    def test_it_ignores_the_other_filters(self, auth_client, checking):
        base = date(2026, 9, 1)
        add(auth_client, checking, base, -1000)
        add(auth_client, checking, base + timedelta(days=1), -2000, memo="findme")

        rows = auth_client.get(f"{TX}?account_id={checking['id']}&text=findme").json()["items"]

        # 100,000 - 1,000 - 2,000: the filtered-out row still counts toward the balance.
        assert rows[0]["running_balance_cents"] == 97_000


class TestFilters:
    def test_by_account(self, auth_client, checking, savings):
        add(auth_client, checking, date(2026, 9, 1), -1000)
        add(auth_client, savings, date(2026, 9, 1), -2000)

        rows = auth_client.get(f"{TX}?account_id={savings['id']}").json()["items"]

        assert [row["transaction"]["amount_cents"] for row in rows] == [-2000]

    def test_by_date_range(self, auth_client, checking):
        add(auth_client, checking, date(2026, 8, 1), -1000)
        add(auth_client, checking, date(2026, 9, 15), -2000)

        rows = auth_client.get(f"{TX}?from=2026-09-01&to=2026-09-30").json()["items"]

        assert [row["transaction"]["amount_cents"] for row in rows] == [-2000]

    def test_by_payee(self, auth_client, checking, payee):
        add(auth_client, checking, date(2026, 9, 1), -1000, payee_id=payee["id"])
        add(auth_client, checking, date(2026, 9, 2), -2000)

        rows = auth_client.get(f"{TX}?payee_id={payee['id']}").json()["items"]

        assert len(rows) == 1

    def test_by_category(self, auth_client, checking, category):
        add(
            auth_client,
            checking,
            date(2026, 9, 1),
            -1000,
            splits=[{"amount_cents": -1000, "category_id": category["id"]}],
        )
        add(auth_client, checking, date(2026, 9, 2), -2000)

        rows = auth_client.get(f"{TX}?category_id={category['id']}").json()["items"]

        assert [row["transaction"]["amount_cents"] for row in rows] == [-1000]

    def test_by_status(self, auth_client, checking):
        add(auth_client, checking, date(2026, 9, 1), -1000, status="cleared")
        add(auth_client, checking, date(2026, 9, 2), -2000)

        rows = auth_client.get(f"{TX}?status=cleared").json()["items"]

        assert len(rows) == 1

    def test_by_amount_range(self, auth_client, checking):
        add(auth_client, checking, date(2026, 9, 1), -10_000)
        add(auth_client, checking, date(2026, 9, 2), -100)

        rows = auth_client.get(f"{TX}?min_cents=-5000&max_cents=0").json()["items"]

        assert [row["transaction"]["amount_cents"] for row in rows] == [-100]

    def test_by_text_across_memo_payee_and_split_memo(self, auth_client, checking, payee, category):
        add(auth_client, checking, date(2026, 9, 1), -1000, memo="dentist visit")
        add(auth_client, checking, date(2026, 9, 2), -2000, payee_id=payee["id"])
        add(
            auth_client,
            checking,
            date(2026, 9, 3),
            -3000,
            splits=[{"amount_cents": -3000, "category_id": category["id"], "memo": "school trip"}],
        )

        assert len(auth_client.get(f"{TX}?text=dentist").json()["items"]) == 1
        assert len(auth_client.get(f"{TX}?text=krog").json()["items"]) == 1
        assert len(auth_client.get(f"{TX}?text=school").json()["items"]) == 1

    def test_the_total_reflects_the_filters(self, auth_client, checking):
        add(auth_client, checking, date(2026, 9, 1), -1000, status="cleared")
        add(auth_client, checking, date(2026, 9, 2), -2000)

        body = auth_client.get(f"{TX}?status=cleared").json()

        assert body["total_cents"] == -1000


class TestPagination:
    def test_the_cursor_walks_through_without_repeating(self, auth_client, checking):
        base = date(2026, 9, 1)
        for index in range(25):
            add(auth_client, checking, base + timedelta(days=index), -(index + 1) * 100)

        seen: list[int] = []
        cursor = None
        pages = 0
        while True:
            url = f"{TX}?account_id={checking['id']}&limit=10"
            if cursor:
                url += f"&cursor={cursor}"
            body = auth_client.get(url).json()
            seen.extend(row["transaction"]["id"] for row in body["items"])
            cursor = body["next_cursor"]
            pages += 1
            if not cursor:
                break

        assert pages == 3
        assert len(seen) == 25
        assert len(set(seen)) == 25

    def test_a_bad_cursor_is_rejected(self, auth_client):
        response = auth_client.get(f"{TX}?cursor=not-a-cursor")

        assert response.status_code == 422
        assert response.json()["code"] == "invalid_cursor"


class TestBulkActions:
    def test_set_status(self, auth_client, checking):
        rows = [add(auth_client, checking, date(2026, 9, index + 1), -100) for index in range(3)]

        body = auth_client.post(
            f"{TX}/bulk/status",
            json={"ids": [row["id"] for row in rows], "status": "cleared"},
            headers=HEADERS,
        ).json()

        assert all(row["status"] == "cleared" for row in body["transactions"])
        assert body["balances"][0]["cleared_cents"] == 99_700

    def test_set_category_collapses_splits(self, auth_client, checking, category):
        row = add(
            auth_client,
            checking,
            date(2026, 9, 1),
            -5000,
            splits=[{"amount_cents": -3000}, {"amount_cents": -2000}],
        )

        body = auth_client.post(
            f"{TX}/bulk/category",
            json={"ids": [row["id"]], "category_id": category["id"]},
            headers=HEADERS,
        ).json()

        splits = body["transactions"][0]["splits"]
        assert len(splits) == 1
        assert splits[0]["amount_cents"] == -5000
        assert splits[0]["category_id"] == category["id"]

    def test_bulk_delete_takes_both_legs_of_a_transfer_once(self, auth_client, checking, savings):
        legs = auth_client.post(
            "/api/v1/transfers",
            json={
                "from_account_id": checking["id"],
                "to_account_id": savings["id"],
                "date": "2026-09-01",
                "amount_cents": 5000,
            },
            headers=HEADERS,
        ).json()["transactions"]

        body = auth_client.post(
            f"{TX}/bulk/delete",
            json={"ids": [leg["id"] for leg in legs]},
            headers=HEADERS,
        ).json()

        assert sorted(body["deleted_ids"]) == sorted(leg["id"] for leg in legs)
        assert auth_client.get(TX).json()["items"] == []

    def test_bulk_delete_refuses_reconciled_rows_without_confirmation(
        self, auth_client, checking, lock
    ):
        row = lock(add(auth_client, checking, date(2026, 9, 1), -100))

        refused = auth_client.post(f"{TX}/bulk/delete", json={"ids": [row["id"]]}, headers=HEADERS)
        assert refused.status_code == 409

        allowed = auth_client.post(
            f"{TX}/bulk/delete?confirm=true", json={"ids": [row["id"]]}, headers=HEADERS
        )
        assert allowed.status_code == 200

    def test_an_unknown_id_is_reported(self, auth_client):
        response = auth_client.post(
            f"{TX}/bulk/status", json={"ids": [999], "status": "cleared"}, headers=HEADERS
        )

        assert response.status_code == 404


def test_the_ledger_needs_a_session(client):
    assert client.get(TX).status_code == 401
