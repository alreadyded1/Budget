"""Payees: nocase uniqueness, the rename-into-merge offer, and merging itself."""

import pytest
from sqlalchemy.exc import IntegrityError

from app.models import Payee
from app.services import references

HEADERS = {"X-PB-Request": "1"}
PAYEES = "/api/v1/payees"
GROUPS = "/api/v1/category-groups"
CATEGORIES = "/api/v1/categories"


def add_payee(client, name, **overrides):
    payload = {"name": name}
    payload.update(overrides)
    return client.post(PAYEES, json=payload, headers=HEADERS)


@pytest.fixture
def category(auth_client):
    group = auth_client.post(GROUPS, json={"name": "Food"}, headers=HEADERS).json()
    return auth_client.post(
        CATEGORIES, json={"group_id": group["id"], "name": "Groceries"}, headers=HEADERS
    ).json()


def test_payees_are_listed_alphabetically_ignoring_case(auth_client):
    for name in ("zoo supplies", "Apple Store", "meijer"):
        add_payee(auth_client, name)

    names = [row["name"] for row in auth_client.get(PAYEES).json()["items"]]

    assert names == ["Apple Store", "meijer", "zoo supplies"]


def test_search_is_case_insensitive_and_partial(auth_client):
    add_payee(auth_client, "Kroger")
    add_payee(auth_client, "Meijer")

    found = auth_client.get(f"{PAYEES}?search=ROG").json()["items"]

    assert [row["name"] for row in found] == ["Kroger"]


def test_creating_a_duplicate_name_in_another_casing_is_refused(auth_client):
    add_payee(auth_client, "Kroger")

    clash = add_payee(auth_client, "KROGER")

    assert clash.status_code == 409
    assert clash.json()["code"] == "payee_name_taken"


def test_the_database_enforces_nocase_uniqueness(auth_client, db):
    add_payee(auth_client, "Kroger")

    db.add(Payee(name="kroger"))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_renaming_onto_an_existing_name_offers_a_merge(auth_client):
    keeper = add_payee(auth_client, "Kroger").json()
    other = add_payee(auth_client, "Kroger Fuel").json()

    response = auth_client.patch(
        f"{PAYEES}/{other['id']}", json={"name": "KROGER"}, headers=HEADERS
    )

    assert response.status_code == 409
    assert response.json()["code"] == "payee_name_taken"
    # The message names both sides so the UI can offer the merge.
    assert "Kroger" in response.json()["detail"]
    assert "Merge" in response.json()["detail"]
    assert keeper["id"] != other["id"]


def test_a_plain_rename_still_works(auth_client):
    payee = add_payee(auth_client, "Krogr").json()

    renamed = auth_client.patch(f"{PAYEES}/{payee['id']}", json={"name": "Kroger"}, headers=HEADERS)

    assert renamed.status_code == 200
    assert renamed.json()["name"] == "Kroger"


def test_renaming_to_the_same_name_in_a_different_casing_is_allowed(auth_client):
    payee = add_payee(auth_client, "kroger").json()

    renamed = auth_client.patch(f"{PAYEES}/{payee['id']}", json={"name": "Kroger"}, headers=HEADERS)

    assert renamed.status_code == 200
    assert renamed.json()["name"] == "Kroger"


def test_merging_removes_the_source_and_keeps_the_target(auth_client):
    target = add_payee(auth_client, "Kroger").json()
    source = add_payee(auth_client, "Kroger Fuel").json()

    response = auth_client.post(
        f"{PAYEES}/{target['id']}/merge", json={"source_id": source["id"]}, headers=HEADERS
    )

    assert response.status_code == 200
    names = [row["name"] for row in auth_client.get(PAYEES).json()["items"]]
    assert names == ["Kroger"]


def test_merging_moves_every_registered_reference(auth_client):
    """Transactions, subscriptions and rules each register a handler in their own phase."""
    target = add_payee(auth_client, "Kroger").json()
    source = add_payee(auth_client, "Kroger Fuel").json()

    calls: list[tuple[str, int, int]] = []
    for table in ("transactions", "subscriptions", "rules"):
        references.register_payee_reassigner(
            table,
            lambda db, s, t, table=table: calls.append((table, s, t)) or 2,
        )
    try:
        result = auth_client.post(
            f"{PAYEES}/{target['id']}/merge", json={"source_id": source["id"]}, headers=HEADERS
        ).json()

        assert result["moved"] == {"transactions": 2, "subscriptions": 2, "rules": 2}
        assert sorted(call[0] for call in calls) == ["rules", "subscriptions", "transactions"]
        assert all(call[1] == source["id"] and call[2] == target["id"] for call in calls)
    finally:
        for table in ("transactions", "subscriptions", "rules"):
            references._payee_reassigners.pop(table, None)


def test_merging_keeps_the_pinned_default_category(auth_client, category):
    target = add_payee(auth_client, "Kroger").json()
    source = add_payee(auth_client, "Kroger Fuel", default_category_id=category["id"]).json()

    merged = auth_client.post(
        f"{PAYEES}/{target['id']}/merge", json={"source_id": source["id"]}, headers=HEADERS
    ).json()

    assert merged["payee"]["default_category_id"] == category["id"]


def test_a_payee_cannot_be_merged_into_itself(auth_client):
    payee = add_payee(auth_client, "Kroger").json()

    response = auth_client.post(
        f"{PAYEES}/{payee['id']}/merge", json={"source_id": payee["id"]}, headers=HEADERS
    )

    assert response.status_code == 422
    assert response.json()["code"] == "same_payee"


def test_pinning_a_default_category(auth_client, category):
    payee = add_payee(auth_client, "Kroger").json()

    updated = auth_client.patch(
        f"{PAYEES}/{payee['id']}",
        json={"default_category_id": category["id"]},
        headers=HEADERS,
    ).json()

    assert updated["default_category_id"] == category["id"]


def test_an_unknown_default_category_is_rejected(auth_client):
    payee = add_payee(auth_client, "Kroger").json()

    response = auth_client.patch(
        f"{PAYEES}/{payee['id']}", json={"default_category_id": 9999}, headers=HEADERS
    )

    assert response.status_code == 404


def test_hiding_a_payee_keeps_it_out_of_the_filtered_list(auth_client):
    payee = add_payee(auth_client, "Old Shop").json()
    auth_client.patch(f"{PAYEES}/{payee['id']}", json={"is_hidden": True}, headers=HEADERS)

    assert auth_client.get(f"{PAYEES}?include_hidden=false").json()["items"] == []
    assert len(auth_client.get(PAYEES).json()["items"]) == 1


def test_usage_stats_are_zero_until_transactions_exist(auth_client):
    add_payee(auth_client, "Kroger")

    row = auth_client.get(PAYEES).json()["items"][0]

    assert row["transaction_count"] == 0
    assert row["last_used"] is None
    assert row["total_spent_cents"] == 0


def test_deleting_an_unused_payee(auth_client):
    payee = add_payee(auth_client, "Typo").json()

    assert auth_client.delete(f"{PAYEES}/{payee['id']}", headers=HEADERS).status_code == 204
    assert auth_client.get(PAYEES).json()["items"] == []


def test_payees_need_a_session(client):
    assert client.get(PAYEES).status_code == 401
