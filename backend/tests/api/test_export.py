"""Data export (SPEC §17): the full JSON snapshot and the all-transactions CSV."""

import csv
import io
import json

from fastapi.testclient import TestClient

from app.main import create_app

HEADERS = {"X-PB-Request": "1"}


def post(client, path, body):
    response = client.post(path, json=body, headers=HEADERS)
    assert response.status_code in (200, 201), response.text
    return response.json()


def seed(client):
    checking = post(client, "/api/v1/accounts", {"name": "Checking, main", "type": "checking"})
    savings = post(client, "/api/v1/accounts", {"name": "Savings", "type": "savings"})
    group = post(client, "/api/v1/category-groups", {"name": "Living"})
    food = post(client, "/api/v1/categories", {"group_id": group["id"], "name": "Groceries"})
    fuel = post(client, "/api/v1/categories", {"group_id": group["id"], "name": "Fuel"})
    target = post(client, "/api/v1/payees", {"name": 'Target "Main"'})
    post(
        client,
        "/api/v1/transactions",
        {
            "account_id": checking["id"],
            "date": "2026-09-02",
            "amount_cents": -10_000,
            "payee_id": target["id"],
            "memo": "weekly",
            "splits": [
                {"amount_cents": -6_000, "category_id": food["id"], "memo": "food"},
                {"amount_cents": -4_000, "category_id": fuel["id"]},
            ],
        },
    )
    post(
        client,
        "/api/v1/transfers",
        {
            "from_account_id": checking["id"],
            "to_account_id": savings["id"],
            "date": "2026-09-03",
            "amount_cents": 2_500,
        },
    )
    client.patch(
        "/api/v1/settings",
        json={"ntfy_url": "https://ntfy.sh", "ntfy_topic": "t", "ntfy_token": "tk_secret_value"},
        headers=HEADERS,
    )


def test_json_export_has_everything_but_secrets(auth_client):
    seed(auth_client)
    response = auth_client.get("/api/v1/export/json")
    assert response.status_code == 200
    assert response.headers["content-disposition"].startswith(
        'attachment; filename="payday-budget-'
    )
    body = response.json()
    assert body["app"] == "payday-budget"
    tables = body["tables"]
    assert "sessions" not in tables
    assert len(tables["transactions"]) == 3
    assert len(tables["transaction_splits"]) == 2
    assert {row["name"] for row in tables["accounts"]} == {"Checking, main", "Savings"}
    assert "password_hash" not in tables["users"][0]
    assert tables["users"][0]["username"] == "sam"
    assert "ntfy_token" not in tables["settings"][0]
    assert tables["settings"][0]["ntfy_topic"] == "t"
    text = response.text
    assert "tk_secret_value" not in text
    assert "argon2" not in text
    assert isinstance(tables["transactions"][0]["date"], str)


def test_transactions_csv_is_one_line_per_split(auth_client):
    seed(auth_client)
    response = auth_client.get("/api/v1/export/transactions.csv")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    rows = list(csv.DictReader(io.StringIO(response.text)))
    assert [(r["date"], r["category"], r["amount"], r["transaction_amount"]) for r in rows] == [
        ("2026-09-02", "Groceries", "-60.00", "-100.00"),
        ("2026-09-02", "Fuel", "-40.00", "-100.00"),
        ("2026-09-03", "", "-25.00", "-25.00"),
        ("2026-09-03", "", "25.00", "25.00"),
    ]
    assert rows[0]["account"] == "Checking, main"
    assert rows[0]["payee"] == 'Target "Main"'
    assert rows[0]["split_memo"] == "food" and rows[0]["memo"] == "weekly"
    assert rows[2]["transfer_account"] == "Savings"
    assert rows[3]["transfer_account"] == "Checking, main"
    assert '"Target ""Main"""' in response.text  # quoted properly


def test_exports_need_a_session(client):
    with TestClient(create_app()) as stranger:
        assert stranger.get("/api/v1/export/json").status_code == 401
        assert stranger.get("/api/v1/export/transactions.csv").status_code == 401


def test_large_exports_stream_in_batches(auth_client, monkeypatch):
    from app.services import export

    monkeypatch.setattr(export, "BATCH", 2)
    seed(auth_client)
    body = json.loads(auth_client.get("/api/v1/export/json").text)
    assert len(body["tables"]["transactions"]) == 3
    rows = list(csv.reader(io.StringIO(auth_client.get("/api/v1/export/transactions.csv").text)))
    assert len(rows) == 5
