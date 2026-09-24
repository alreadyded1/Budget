"""Reconciliation end to end (SPEC §12): worksheet, finish, adjustment, protection, undo."""

import pytest

HEADERS = {"X-PB-Request": "1"}
TX = "/api/v1/transactions"
ACCOUNTS = "/api/v1/accounts"


def post(client, path, body=None):
    return client.post(path, json=body or {}, headers=HEADERS)


@pytest.fixture
def checking(auth_client):
    return post(
        auth_client,
        ACCOUNTS,
        {
            "name": "Checking",
            "type": "checking",
            "opening_date": "2026-08-01",
            "opening_balance_cents": 100_000,
        },
    ).json()


@pytest.fixture
def card(auth_client):
    return post(
        auth_client, ACCOUNTS, {"name": "Visa", "type": "credit_card", "opening_date": "2026-08-01"}
    ).json()


def add(client, account, on, cents, status="uncleared"):
    response = post(
        client,
        TX,
        {"account_id": account["id"], "date": on, "amount_cents": cents, "status": status},
    )
    assert response.status_code == 201, response.text
    return response.json()["transactions"][0]


def tick(client, row, status="cleared", confirm=False):
    query = "?confirm=true" if confirm else ""
    return client.patch(f"{TX}/{row['id']}{query}", json={"status": status}, headers=HEADERS)


def sheet(client, account, on="2026-09-30"):
    response = client.get(f"{ACCOUNTS}/{account['id']}/reconcile?statement_date={on}")
    assert response.status_code == 200, response.text
    return response.json()


def finish(client, account, balance, on="2026-09-30", **extra):
    return post(
        client,
        f"{ACCOUNTS}/{account['id']}/reconciliations",
        {"statement_date": on, "statement_balance_cents": balance, **extra},
    )


def statuses(client, account):
    rows = client.get(f"{TX}?account_id={account['id']}").json()["items"]
    return {row["transaction"]["id"]: row["transaction"]["status"] for row in rows}


class TestWorksheet:
    def test_it_lists_open_rows_up_to_the_statement_date(self, auth_client, checking, lock):
        old = lock(add(auth_client, checking, "2026-08-15", -1_000))
        a = add(auth_client, checking, "2026-09-02", -4_520)
        b = add(auth_client, checking, "2026-09-10", 250_000, status="cleared")
        add(auth_client, checking, "2026-10-02", -999)  # after the statement

        body = sheet(auth_client, checking)

        assert [row["id"] for row in body["rows"]] == [a["id"], b["id"]]
        assert old["id"] not in [row["id"] for row in body["rows"]]
        assert body["reconciled_cents"] == 100_000 - 1_000
        assert body["ticked_cents"] == 250_000
        assert body["is_liability"] is False
        assert body["last"]["statement_date"] == "2026-08-15"

    def test_a_typed_balance_account_cannot_be_reconciled(self, auth_client):
        house = post(
            auth_client,
            ACCOUNTS,
            {"name": "House", "type": "other_asset", "valuation_mode": "manual"},
        ).json()
        response = auth_client.get(f"{ACCOUNTS}/{house['id']}/reconcile?statement_date=2026-09-30")
        assert response.status_code == 422
        assert response.json()["code"] == "reconcile_manual_account"


class TestFinish:
    def test_finishing_is_blocked_until_the_difference_is_zero(self, auth_client, checking):
        a = add(auth_client, checking, "2026-09-02", -4_520)
        b = add(auth_client, checking, "2026-09-10", 250_000)
        statement = 100_000 - 4_520 + 250_000

        tick(auth_client, a)
        refused = finish(auth_client, checking, statement)
        assert refused.status_code == 409
        assert refused.json()["code"] == "reconcile_not_balanced"
        assert "+2,500.00" in refused.json()["detail"]
        assert all(status != "reconciled" for status in statuses(auth_client, checking).values())

        tick(auth_client, b)
        done = finish(auth_client, checking, statement)

        assert done.status_code == 201, done.text
        record = done.json()["reconciliation"]
        assert record["transaction_count"] == 2
        assert record["adjustment_transaction_id"] is None
        assert done.json()["balances"][0]["reconciled_cents"] == statement
        assert set(statuses(auth_client, checking).values()) == {"reconciled"}

    def test_unticked_rows_stay_open(self, auth_client, checking):
        a = add(auth_client, checking, "2026-09-02", -4_520, status="cleared")
        b = add(auth_client, checking, "2026-09-03", -100)  # not on the statement yet
        assert finish(auth_client, checking, 100_000 - 4_520).status_code == 201
        assert statuses(auth_client, checking) == {a["id"]: "reconciled", b["id"]: "uncleared"}
        assert sheet(auth_client, checking, "2026-10-31")["rows"][0]["id"] == b["id"]

    def test_an_adjustment_closes_the_gap(self, auth_client, checking):
        group = post(auth_client, "/api/v1/category-groups", {"name": "Misc"}).json()
        fees = post(
            auth_client, "/api/v1/categories", {"group_id": group["id"], "name": "Bank fees"}
        ).json()
        add(auth_client, checking, "2026-09-02", -4_520, status="cleared")

        done = finish(
            auth_client,
            checking,
            100_000 - 4_520 - 350,
            adjust=True,
            adjustment_category_id=fees["id"],
        )

        assert done.status_code == 201, done.text
        record = done.json()["reconciliation"]
        assert record["adjustment_cents"] == -350
        assert record["transaction_count"] == 2
        adjustment = auth_client.get(f"{TX}/{record['adjustment_transaction_id']}").json()
        assert adjustment["status"] == "reconciled"
        assert adjustment["date"] == "2026-09-30"
        assert adjustment["splits"][0]["category_id"] == fees["id"]
        payees = {p["id"]: p["name"] for p in auth_client.get("/api/v1/payees").json()["items"]}
        assert payees[adjustment["payee_id"]] == "Reconciliation adjustment"
        assert done.json()["balances"][0]["reconciled_cents"] == 100_000 - 4_520 - 350

    def test_adjust_with_nothing_to_adjust_adds_nothing(self, auth_client, checking):
        done = finish(auth_client, checking, 100_000, adjust=True)
        assert done.json()["reconciliation"]["adjustment_transaction_id"] is None
        assert statuses(auth_client, checking) == {}

    def test_a_credit_card_balances_in_its_own_sign(self, auth_client, card):
        add(auth_client, card, "2026-09-03", -8_910, status="cleared")
        add(auth_client, card, "2026-09-12", 2_000, status="cleared")
        # The statement says $69.10 owed; the API takes the account's sign.
        assert finish(auth_client, card, 6_910).status_code == 409
        done = finish(auth_client, card, -6_910)
        assert done.status_code == 201
        assert done.json()["balances"][0]["reconciled_cents"] == -6_910
        assert sheet(auth_client, card)["is_liability"] is True

    def test_a_statement_before_the_last_one_is_refused(self, auth_client, checking):
        assert finish(auth_client, checking, 100_000).status_code == 201
        earlier = finish(auth_client, checking, 100_000, on="2026-09-01")
        assert earlier.status_code == 422
        assert earlier.json()["code"] == "statement_date_invalid"


class TestProtection:
    def test_reconciled_cannot_be_set_by_hand(self, auth_client, checking):
        row = add(auth_client, checking, "2026-09-02", -100)
        created = post(
            auth_client,
            TX,
            {
                "account_id": checking["id"],
                "date": "2026-09-02",
                "amount_cents": -1,
                "status": "reconciled",
            },
        )
        patched = tick(auth_client, row, "reconciled")
        bulk = post(auth_client, f"{TX}/bulk/status", {"ids": [row["id"]], "status": "reconciled"})

        for response in (created, patched, bulk):
            assert response.status_code == 422
            assert response.json()["code"] == "reconcile_through_flow"

    def test_unreconciling_needs_confirmation(self, auth_client, checking, lock):
        row = lock(add(auth_client, checking, "2026-09-02", -100))

        refused = tick(auth_client, row, "cleared")
        assert refused.status_code == 409
        assert refused.json()["code"] == "reconciled_edit_requires_confirm"
        refused_bulk = post(
            auth_client, f"{TX}/bulk/status", {"ids": [row["id"]], "status": "uncleared"}
        )
        assert refused_bulk.status_code == 409

        allowed = tick(auth_client, row, "cleared", confirm=True)
        assert allowed.status_code == 200
        assert allowed.json()["balances"][0]["reconciled_cents"] == 100_000
        history = auth_client.get(f"{ACCOUNTS}/{checking['id']}/reconciliations").json()["items"]
        assert history[0]["transaction_count"] == 0

    def test_amount_date_account_and_delete_still_need_confirmation(
        self, auth_client, checking, card, lock
    ):
        row = lock(add(auth_client, checking, "2026-09-02", -100))
        for change in ({"amount_cents": -200}, {"date": "2026-09-03"}, {"account_id": card["id"]}):
            response = auth_client.patch(f"{TX}/{row['id']}", json=change, headers=HEADERS)
            assert response.status_code == 409, change
        assert auth_client.delete(f"{TX}/{row['id']}", headers=HEADERS).status_code == 409
        # Moved with confirmation, it is not reconciled on an account it never balanced to.
        moved = auth_client.patch(
            f"{TX}/{row['id']}?confirm=true", json={"account_id": card["id"]}, headers=HEADERS
        )
        assert moved.json()["transactions"][0]["status"] == "cleared"


class TestTransfers:
    def transfer(self, client, checking, card, status="uncleared"):
        response = post(
            client,
            "/api/v1/transfers",
            {
                "from_account_id": checking["id"],
                "to_account_id": card["id"],
                "date": "2026-09-15",
                "amount_cents": 20_000,
                "status": status,
            },
        )
        assert response.status_code == 201, response.text
        legs = response.json()["transactions"]
        by_account = {leg["account_id"]: leg for leg in legs}
        return by_account[checking["id"]], by_account[card["id"]]

    def test_each_leg_has_its_own_status(self, auth_client, checking, card):
        out_leg, in_leg = self.transfer(auth_client, checking, card)
        tick(auth_client, out_leg)
        assert statuses(auth_client, checking)[out_leg["id"]] == "cleared"
        assert statuses(auth_client, card)[in_leg["id"]] == "uncleared"

    def test_reconciling_one_side_leaves_the_other_open(self, auth_client, checking, card, lock):
        out_leg, in_leg = self.transfer(auth_client, checking, card, status="cleared")
        lock(out_leg)
        assert statuses(auth_client, checking)[out_leg["id"]] == "reconciled"
        assert statuses(auth_client, card)[in_leg["id"]] == "cleared"

    def test_a_reconciled_other_leg_is_protected(self, auth_client, checking, card, lock):
        out_leg, in_leg = self.transfer(auth_client, checking, card)
        lock(out_leg)
        # Editing the card side would change the reconciled checking side.
        refused = auth_client.patch(
            f"{TX}/{in_leg['id']}", json={"amount_cents": 30_000}, headers=HEADERS
        )
        assert refused.status_code == 409
        assert auth_client.delete(f"{TX}/{in_leg['id']}", headers=HEADERS).status_code == 409
        bulk = post(auth_client, f"{TX}/bulk/delete", {"ids": [in_leg["id"]]})
        assert bulk.status_code == 409
        # Its own memo is fine.
        memo = auth_client.patch(f"{TX}/{in_leg['id']}", json={"memo": "paid"}, headers=HEADERS)
        assert memo.status_code == 200


class TestUndo:
    def test_undo_puts_rows_back_to_cleared_and_drops_the_adjustment(self, auth_client, checking):
        row = add(auth_client, checking, "2026-09-02", -4_520, status="cleared")
        record = finish(auth_client, checking, 100_000 - 4_520 - 350, adjust=True).json()[
            "reconciliation"
        ]

        undone = post(auth_client, f"/api/v1/reconciliations/{record['id']}/undo")

        assert undone.status_code == 200, undone.text
        assert undone.json()["balances"][0]["reconciled_cents"] == 100_000
        assert statuses(auth_client, checking) == {row["id"]: "cleared"}
        assert auth_client.get(f"{ACCOUNTS}/{checking['id']}/reconciliations").json()["items"] == []

    def test_only_the_latest_can_be_undone(self, auth_client, checking):
        first = finish(auth_client, checking, 100_000, on="2026-08-31").json()["reconciliation"]
        second = finish(auth_client, checking, 100_000).json()["reconciliation"]

        refused = post(auth_client, f"/api/v1/reconciliations/{first['id']}/undo")
        assert refused.status_code == 409
        assert refused.json()["code"] == "reconcile_not_latest"
        assert post(auth_client, f"/api/v1/reconciliations/{second['id']}/undo").status_code == 200
        assert post(auth_client, f"/api/v1/reconciliations/{first['id']}/undo").status_code == 200

    def test_deleting_an_adjustment_from_the_ledger_keeps_the_record(self, auth_client, checking):
        record = finish(auth_client, checking, 99_000, adjust=True).json()["reconciliation"]
        deleted = auth_client.delete(
            f"{TX}/{record['adjustment_transaction_id']}?confirm=true", headers=HEADERS
        )
        assert deleted.status_code == 200
        history = auth_client.get(f"{ACCOUNTS}/{checking['id']}/reconciliations").json()["items"]
        assert history[0]["adjustment_transaction_id"] is None
        assert post(auth_client, f"/api/v1/reconciliations/{record['id']}/undo").status_code == 200
