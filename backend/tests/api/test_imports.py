"""Bank imports end to end: stage, review, commit, duplicates, matching, rules, undo."""

from pathlib import Path

import pytest

HEADERS = {"X-PB-Request": "1"}
FIXTURES = Path(__file__).parents[1] / "fixtures" / "imports"

SIGNED = {
    "name": "Signed bank",
    "date_column": 0,
    "date_format": "MM/DD/YYYY",
    "amount_mode": "single",
    "amount_column": 2,
    "description_column": 1,
}
DEBIT_CREDIT = {
    "name": "Debit credit bank",
    "delimiter": ";",
    "skip_rows": 1,
    "date_column": 0,
    "date_format": "YYYY-MM-DD",
    "amount_mode": "debit_credit",
    "debit_column": 1,
    "credit_column": 2,
    "description_column": 3,
    "memo_column": 4,
}


def post(client, path, body=None, status=(200, 201)):
    response = client.post(path, json=body or {}, headers=HEADERS)
    assert response.status_code in status, response.text
    return response.json()


def fixture(name):
    return (FIXTURES / name).read_text(encoding="utf-8")


@pytest.fixture
def checking(auth_client):
    return post(
        auth_client,
        "/api/v1/accounts",
        {
            "name": "Checking",
            "type": "checking",
            "opening_date": "2026-01-01",
            "opening_balance_cents": 100_000,
        },
    )


@pytest.fixture
def card(auth_client):
    return post(
        auth_client,
        "/api/v1/accounts",
        {"name": "Visa", "type": "credit_card", "opening_date": "2026-01-01"},
    )


def stage(client, account, name, profile_id=None, content=None):
    return post(
        client,
        "/api/v1/imports",
        {
            "account_id": account["id"],
            "filename": name,
            "content": content if content is not None else fixture(name),
            "profile_id": profile_id,
        },
    )


def commit(client, batch):
    return post(client, f"/api/v1/imports/{batch['id']}/commit")


def ledger(client, account):
    return [
        row["transaction"]
        for row in client.get(f"/api/v1/transactions?account_id={account['id']}").json()["items"]
    ]


class TestFixtures:
    def test_ofx(self, auth_client, checking):
        batch = stage(auth_client, checking, "checking.ofx")
        assert batch["format"] == "ofx" and batch["status"] == "staged"
        assert [(r["date"], r["amount_cents"], r["raw_description"]) for r in batch["rows"]] == [
            ("2026-09-02", -4520, "KROGER #0423"),
            ("2026-09-05", -1599, "NETFLIX.COM"),
            ("2026-09-10", 250000, "ACME PAYROLL & CO"),
        ]
        # Staging writes nothing to the ledger.
        assert ledger(auth_client, checking) == []

        result = commit(auth_client, batch)

        assert result["batch"]["imported_count"] == 3
        assert result["balances"][0]["current_cents"] == 100_000 - 4520 - 1599 + 250_000
        rows = ledger(auth_client, checking)
        assert sorted(tx["amount_cents"] for tx in rows) == [-4520, -1599, 250000]
        assert all(tx["status"] == "cleared" for tx in rows)

    def test_qfx(self, auth_client, card):
        batch = stage(auth_client, card, "card.qfx")
        assert batch["format"] == "qfx"
        commit(auth_client, batch)
        assert sorted(tx["amount_cents"] for tx in ledger(auth_client, card)) == [
            -8910,
            -1250,
            20000,
        ]

    def test_csv_with_one_signed_column(self, auth_client, checking):
        profile = post(auth_client, "/api/v1/import-profiles", SIGNED)
        batch = stage(auth_client, checking, "signed.csv", profile["id"])
        assert batch["format"] == "csv" and batch["row_count"] == 6
        commit(auth_client, batch)
        assert sorted(tx["amount_cents"] for tx in ledger(auth_client, checking)) == [
            -4520,
            -3800,
            -1234,
            -500,
            -500,
            250000,
        ]

    def test_csv_with_debit_and_credit_columns(self, auth_client, card):
        profile = post(auth_client, "/api/v1/import-profiles", DEBIT_CREDIT)
        batch = stage(auth_client, card, "debit_credit.csv", profile["id"])
        assert [(r["amount_cents"], r["raw_memo"]) for r in batch["rows"]] == [
            (-8910, "HOUSEHOLD"),
            (-1250, ""),
            (20000, "ONLINE"),
        ]

    def test_a_csv_needs_a_profile(self, auth_client, checking):
        response = auth_client.post(
            "/api/v1/imports",
            json={
                "account_id": checking["id"],
                "filename": "x.csv",
                "content": fixture("signed.csv"),
            },
            headers=HEADERS,
        )
        assert response.status_code == 422
        assert response.json()["code"] == "profile_required"

    def test_an_unreadable_file_is_refused_with_the_reason(self, auth_client, checking):
        profile = post(auth_client, "/api/v1/import-profiles", SIGNED)
        response = auth_client.post(
            "/api/v1/imports",
            json={
                "account_id": checking["id"],
                "filename": "x.csv",
                "content": "Date,Desc,Amount\nnope,x,y\n",
                "profile_id": profile["id"],
            },
            headers=HEADERS,
        )
        assert response.status_code == 422
        assert "line 2" in response.json()["detail"]

    def test_the_preview_shows_columns_and_rows(self, auth_client):
        body = post(
            auth_client,
            "/api/v1/imports/preview",
            {
                "content": fixture("debit_credit.csv"),
                "profile": {k: v for k, v in DEBIT_CREDIT.items() if k != "name"},
            },
        )
        assert body["columns"] == ["Posting Date", "Debit", "Credit", "Payee", "Details"]
        assert [row["amount_cents"] for row in body["rows"]] == [-8910, -1250, 20000]
        assert body["problems"] == []


class TestDuplicates:
    def test_re_importing_the_same_file_flags_every_row(self, auth_client, checking):
        commit(auth_client, stage(auth_client, checking, "checking.ofx"))
        again = stage(auth_client, checking, "checking.ofx")
        assert again["duplicate_count"] == 3
        assert all(row["is_duplicate"] and row["disposition"] == "skip" for row in again["rows"])
        result = commit(auth_client, again)
        assert result["batch"]["imported_count"] == 0
        assert len(ledger(auth_client, checking)) == 3

    def test_csv_duplicates_keep_real_twins(self, auth_client, checking):
        profile = post(auth_client, "/api/v1/import-profiles", SIGNED)
        commit(auth_client, stage(auth_client, checking, "signed.csv", profile["id"]))
        again = stage(auth_client, checking, "signed.csv", profile["id"])
        assert again["duplicate_count"] == 6  # both $5.00 coffees included
        # The same file on another account is not a duplicate there.
        other = post(auth_client, "/api/v1/accounts", {"name": "Joint", "type": "checking"})
        assert stage(auth_client, other, "signed.csv", profile["id"])["duplicate_count"] == 0


class TestMatching:
    def test_a_manual_entry_is_matched_and_cleared_not_duplicated(self, auth_client, checking):
        groceries = post(auth_client, "/api/v1/category-groups", {"name": "Food"})
        category = post(
            auth_client, "/api/v1/categories", {"group_id": groceries["id"], "name": "Groceries"}
        )
        kroger = post(auth_client, "/api/v1/payees", {"name": "Kroger"})
        manual = post(
            auth_client,
            "/api/v1/transactions",
            {
                "account_id": checking["id"],
                "date": "2026-09-01",  # a day before the bank's date
                "amount_cents": -4520,
                "payee_id": kroger["id"],
                "memo": "weekly shop",
                "splits": [{"amount_cents": -4520, "category_id": category["id"]}],
            },
        )["transactions"][0]

        batch = stage(auth_client, checking, "checking.ofx")
        first = batch["rows"][0]
        assert first["disposition"] == "match"
        assert first["match"]["transaction_id"] == manual["id"]
        commit(auth_client, batch)

        rows = ledger(auth_client, checking)
        assert len(rows) == 3
        kept = next(tx for tx in rows if tx["id"] == manual["id"])
        assert kept["status"] == "cleared"
        assert kept["payee_id"] == kroger["id"]  # your payee and category stay
        assert kept["memo"] == "weekly shop"
        assert kept["splits"][0]["category_id"] == category["id"]
        # And the file is a duplicate next time, including the matched row.
        assert stage(auth_client, checking, "checking.ofx")["duplicate_count"] == 3

    def test_no_match_outside_three_days_or_for_another_amount(self, auth_client, checking):
        for when, cents in (("2026-08-29", -4520), ("2026-09-02", -4521)):
            post(
                auth_client,
                "/api/v1/transactions",
                {"account_id": checking["id"], "date": when, "amount_cents": cents},
            )
        batch = stage(auth_client, checking, "checking.ofx")
        assert batch["rows"][0]["disposition"] == "import"

    def test_choosing_import_instead_of_match_keeps_both(self, auth_client, checking):
        post(
            auth_client,
            "/api/v1/transactions",
            {"account_id": checking["id"], "date": "2026-09-02", "amount_cents": -4520},
        )
        batch = stage(auth_client, checking, "checking.ofx")
        row = batch["rows"][0]
        response = auth_client.patch(
            f"/api/v1/imports/{batch['id']}/rows/{row['id']}",
            json={"disposition": "import"},
            headers=HEADERS,
        )
        assert response.json()["disposition"] == "import"
        commit(auth_client, batch)
        assert len(ledger(auth_client, checking)) == 4


class TestRulesAndPayees:
    def test_the_first_matching_rule_fills_payee_category_and_memo(self, auth_client, checking):
        group = post(auth_client, "/api/v1/category-groups", {"name": "Food"})
        groceries = post(
            auth_client, "/api/v1/categories", {"group_id": group["id"], "name": "Groceries"}
        )
        fuel = post(auth_client, "/api/v1/categories", {"group_id": group["id"], "name": "Fuel"})
        kroger = post(auth_client, "/api/v1/payees", {"name": "Kroger"})
        post(
            auth_client,
            "/api/v1/rules",
            {
                "match_value": "kroger",
                "set_payee_id": kroger["id"],
                "set_category_id": groceries["id"],
            },
        )
        post(
            auth_client,
            "/api/v1/rules",
            {"match_value": "kroger #", "set_category_id": fuel["id"], "set_memo": "never"},
        )

        row = stage(auth_client, checking, "checking.ofx")["rows"][0]

        assert row["payee_id"] == kroger["id"]
        assert row["category_id"] == groceries["id"]  # the earlier rule won
        assert row["memo"] is None
        assert row["applied_rule_id"] is not None

    def test_without_a_rule_only_an_exact_payee_name_is_used(self, auth_client, checking):
        netflix = post(auth_client, "/api/v1/payees", {"name": "netflix.com"})
        rows = stage(auth_client, checking, "checking.ofx")["rows"]
        assert rows[0]["payee_id"] is None  # "KROGER #0423" is not a payee
        assert rows[1]["payee_id"] == netflix["id"]  # case-insensitive exact name

    def test_a_new_payee_typed_on_review_is_created_once_at_commit(self, auth_client, checking):
        profile = post(auth_client, "/api/v1/import-profiles", SIGNED)
        batch = stage(auth_client, checking, "signed.csv", profile["id"])
        coffees = [row for row in batch["rows"] if row["raw_description"] == "COFFEE HOUSE"]
        for row in coffees:
            auth_client.patch(
                f"/api/v1/imports/{batch['id']}/rows/{row['id']}",
                json={"new_payee_name": "Coffee House"},
                headers=HEADERS,
            )
        commit(auth_client, batch)
        payees = [p["name"] for p in auth_client.get("/api/v1/payees").json()["items"]]
        assert payees.count("Coffee House") == 1

    def test_rules_reorder_and_test_against_past_imports(self, auth_client, checking):
        payee = post(auth_client, "/api/v1/payees", {"name": "Netflix"})
        first = post(
            auth_client, "/api/v1/rules", {"match_value": "zzz", "set_payee_id": payee["id"]}
        )
        second = post(
            auth_client, "/api/v1/rules", {"match_value": "netflix", "set_payee_id": payee["id"]}
        )
        moved = post(auth_client, f"/api/v1/rules/{second['id']}/move", {"offset": -1})
        assert [rule["id"] for rule in moved["items"]] == [second["id"], first["id"]]

        commit(auth_client, stage(auth_client, checking, "checking.ofx"))
        body = post(
            auth_client,
            "/api/v1/rules/test",
            {"match_value": "NETFLIX", "match_type": "starts_with", "set_payee_id": payee["id"]},
        )
        assert body["checked"] == 3
        assert [row["raw_description"] for row in body["matches"]] == ["NETFLIX.COM"]

    def test_a_rule_must_do_something_and_compile(self, auth_client):
        bad = auth_client.post("/api/v1/rules", json={"match_value": "x"}, headers=HEADERS)
        assert bad.json()["code"] == "rule_no_action"
        regex = auth_client.post(
            "/api/v1/rules",
            json={"match_value": "(", "match_type": "regex", "set_memo": "m"},
            headers=HEADERS,
        )
        assert regex.json()["code"] == "invalid_rule"


class TestBills:
    def test_a_row_that_pays_a_bill_links_it_when_ticked(self, auth_client, checking):
        from datetime import date

        payee = post(auth_client, "/api/v1/payees", {"name": "Netflix"})
        post(auth_client, "/api/v1/rules", {"match_value": "netflix", "set_payee_id": payee["id"]})
        today = date.today()
        sub = post(
            auth_client,
            "/api/v1/subscriptions",
            {
                "name": "Netflix",
                "payee_id": payee["id"],
                "amount_cents": 1599,
                "anchor_date": today.isoformat(),
            },
        )
        ofx = (
            "<OFX><BANKTRANLIST><STMTTRN><DTPOSTED>"
            + today.strftime("%Y%m%d")
            + "<TRNAMT>-15.99<FITID>N1<NAME>NETFLIX.COM</BANKTRANLIST></OFX>"
        )
        batch = stage(auth_client, checking, "n.ofx", content=ofx)
        row = batch["rows"][0]
        assert row["bill"]["name"] == "Netflix" and row["link_bill"] is True

        commit(auth_client, batch)

        bills = auth_client.get(f"/api/v1/bills?from={today}&to={today}").json()["items"]
        paid = next(b for b in bills if b["subscription_id"] == sub["id"])
        assert paid["status"] == "paid"
        assert paid["transaction_id"] == ledger(auth_client, checking)[0]["id"]


class TestUndo:
    def test_undo_removes_exactly_that_batch(self, auth_client, checking):
        manual = post(
            auth_client,
            "/api/v1/transactions",
            {"account_id": checking["id"], "date": "2026-09-02", "amount_cents": -4520},
        )["transactions"][0]
        unrelated = post(
            auth_client,
            "/api/v1/transactions",
            {"account_id": checking["id"], "date": "2026-09-20", "amount_cents": -777},
        )["transactions"][0]
        first = stage(auth_client, checking, "checking.ofx")
        commit(auth_client, first)
        profile = post(auth_client, "/api/v1/import-profiles", SIGNED)
        second = stage(auth_client, checking, "signed.csv", profile["id"])
        commit(auth_client, second)
        before_undo = len(ledger(auth_client, checking))

        result = post(auth_client, f"/api/v1/imports/{first['id']}/undo")

        assert result["batch"]["status"] == "undone"
        rows = {tx["id"]: tx for tx in ledger(auth_client, checking)}
        # The OFX created 2 rows and matched 1: the 2 go, the match reverts, the rest stay.
        assert len(rows) == before_undo - 2
        assert rows[manual["id"]]["status"] == "uncleared"
        assert unrelated["id"] in rows
        # The second batch is untouched.
        second_rows = auth_client.get(f"/api/v1/imports/{second['id']}").json()
        assert second_rows["status"] == "committed"
        assert all(row["created_transaction_id"] in rows for row in second_rows["rows"])
        # The file can be imported again after an undo.
        assert stage(auth_client, checking, "checking.ofx")["duplicate_count"] == 0

    def test_undo_twice_or_discarding_a_committed_batch_is_refused(self, auth_client, checking):
        batch = stage(auth_client, checking, "checking.ofx")
        commit(auth_client, batch)
        post(auth_client, f"/api/v1/imports/{batch['id']}/undo")
        again = auth_client.post(f"/api/v1/imports/{batch['id']}/undo", headers=HEADERS)
        assert again.status_code == 409
        assert (
            auth_client.delete(f"/api/v1/imports/{batch['id']}", headers=HEADERS).status_code == 409
        )

    def test_history_lists_batches_per_account(self, auth_client, checking, card):
        stage(auth_client, checking, "checking.ofx")
        stage(auth_client, card, "card.qfx")
        mine = auth_client.get(f"/api/v1/imports?account_id={checking['id']}").json()["items"]
        assert [b["filename"] for b in mine] == ["checking.ofx"]

    def test_a_staged_batch_can_be_discarded(self, auth_client, checking):
        batch = stage(auth_client, checking, "checking.ofx")
        assert (
            auth_client.delete(f"/api/v1/imports/{batch['id']}", headers=HEADERS).status_code == 204
        )
        assert auth_client.get(f"/api/v1/imports/{batch['id']}").status_code == 404

    def test_undo_is_refused_once_anything_is_reconciled(self, auth_client, checking, lock):
        batch = stage(auth_client, checking, "checking.ofx")
        commit(auth_client, batch)
        lock(ledger(auth_client, checking)[0])

        refused = auth_client.post(f"/api/v1/imports/{batch['id']}/undo", headers=HEADERS)

        assert refused.status_code == 409
        assert len(ledger(auth_client, checking)) == 3


def test_merging_payees_moves_their_rules(auth_client):
    keep = post(auth_client, "/api/v1/payees", {"name": "Kroger"})
    old = post(auth_client, "/api/v1/payees", {"name": "KROGER #0423"})
    rule = post(auth_client, "/api/v1/rules", {"match_value": "kroger", "set_payee_id": old["id"]})
    post(auth_client, f"/api/v1/payees/{keep['id']}/merge", {"source_id": old["id"]})
    rules = auth_client.get("/api/v1/rules").json()["items"]
    assert [r["set_payee_id"] for r in rules if r["id"] == rule["id"]] == [keep["id"]]


def test_a_rule_made_during_review_fills_the_untouched_rows(auth_client, checking):
    profile = post(auth_client, "/api/v1/import-profiles", SIGNED)
    batch = stage(auth_client, checking, "signed.csv", profile["id"])
    coffees = [row for row in batch["rows"] if row["raw_description"] == "COFFEE HOUSE"]
    # One coffee was already given a payee by hand; the rule must not overwrite it.
    mine = post(auth_client, "/api/v1/payees", {"name": "My café"})
    auth_client.patch(
        f"/api/v1/imports/{batch['id']}/rows/{coffees[0]['id']}",
        json={"payee_id": mine["id"]},
        headers=HEADERS,
    )
    house = post(auth_client, "/api/v1/payees", {"name": "Coffee House"})
    post(auth_client, "/api/v1/rules", {"match_value": "coffee", "set_payee_id": house["id"]})

    body = post(auth_client, f"/api/v1/imports/{batch['id']}/apply-rules")

    rows = {row["id"]: row for row in body["rows"]}
    assert rows[coffees[0]["id"]]["payee_id"] == mine["id"]
    assert rows[coffees[1]["id"]]["payee_id"] == house["id"]
    assert rows[coffees[1]["id"]]["applied_rule_id"] is not None
    others = [row for row in body["rows"] if "COFFEE" not in row["raw_description"]]
    assert all(row["payee_id"] is None for row in others)
