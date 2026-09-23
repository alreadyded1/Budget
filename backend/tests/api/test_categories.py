"""Category groups, categories, keyboard reordering, and delete with reassignment."""

import pytest

from app.services import references

HEADERS = {"X-PB-Request": "1"}
GROUPS = "/api/v1/category-groups"
CATEGORIES = "/api/v1/categories"


@pytest.fixture
def group(auth_client):
    return auth_client.post(GROUPS, json={"name": "Utilities"}, headers=HEADERS).json()


def add_category(client, group_id, name, **overrides):
    payload = {"group_id": group_id, "name": name}
    payload.update(overrides)
    return client.post(CATEGORIES, json=payload, headers=HEADERS)


def test_create_a_group_and_a_category(auth_client, group):
    created = add_category(auth_client, group["id"], "Electric")

    assert created.status_code == 201
    assert created.json()["name"] == "Electric"

    listed = auth_client.get(GROUPS).json()["items"]
    assert listed[0]["categories"][0]["name"] == "Electric"


def test_group_names_are_unique_case_insensitively(auth_client, group):
    clash = auth_client.post(GROUPS, json={"name": "utilities"}, headers=HEADERS)

    assert clash.status_code == 409
    assert clash.json()["code"] == "group_name_taken"


def test_category_names_are_unique_inside_a_group(auth_client, group):
    add_category(auth_client, group["id"], "Electric")
    clash = add_category(auth_client, group["id"], "electric")

    assert clash.status_code == 409
    assert clash.json()["code"] == "category_name_taken"


def test_the_same_category_name_can_exist_in_another_group(auth_client, group):
    other = auth_client.post(GROUPS, json={"name": "Office"}, headers=HEADERS).json()
    add_category(auth_client, group["id"], "Internet")

    assert add_category(auth_client, other["id"], "Internet").status_code == 201


def test_categories_reorder_one_place_at_a_time(auth_client, group):
    names = ["Electric", "Gas", "Water"]
    ids = [add_category(auth_client, group["id"], name).json()["id"] for name in names]

    # Alt+Down on the first one.
    after = auth_client.post(
        f"{CATEGORIES}/{ids[0]}/move", json={"offset": 1}, headers=HEADERS
    ).json()
    assert [c["name"] for c in after["items"][0]["categories"]] == ["Gas", "Electric", "Water"]

    # Alt+Up puts it back.
    back = auth_client.post(
        f"{CATEGORIES}/{ids[0]}/move", json={"offset": -1}, headers=HEADERS
    ).json()
    assert [c["name"] for c in back["items"][0]["categories"]] == names


def test_moving_past_the_end_is_a_no_op(auth_client, group):
    ids = [add_category(auth_client, group["id"], name).json()["id"] for name in ("A", "B")]

    response = auth_client.post(f"{CATEGORIES}/{ids[0]}/move", json={"offset": -1}, headers=HEADERS)

    assert response.status_code == 200
    assert [c["name"] for c in response.json()["items"][0]["categories"]] == ["A", "B"]


def test_reordering_survives_a_reload(auth_client, group):
    ids = [add_category(auth_client, group["id"], name).json()["id"] for name in ("A", "B", "C")]
    auth_client.post(f"{CATEGORIES}/{ids[2]}/move", json={"offset": -2}, headers=HEADERS)

    fresh = auth_client.get(GROUPS).json()["items"][0]["categories"]
    assert [c["name"] for c in fresh] == ["C", "A", "B"]


def test_groups_reorder_too(auth_client, group):
    second = auth_client.post(GROUPS, json={"name": "Food"}, headers=HEADERS).json()

    after = auth_client.post(
        f"{GROUPS}/{second['id']}/move", json={"offset": -1}, headers=HEADERS
    ).json()

    assert [g["name"] for g in after["items"]] == ["Food", "Utilities"]


def test_hiding_a_category(auth_client, group):
    category = add_category(auth_client, group["id"], "Old thing").json()

    hidden = auth_client.patch(
        f"{CATEGORIES}/{category['id']}", json={"is_hidden": True}, headers=HEADERS
    ).json()

    assert hidden["is_hidden"] is True


def test_the_sinking_fund_flag_and_planned_amount(auth_client, group):
    category = add_category(
        auth_client, group["id"], "Christmas", is_sinking_fund=True, default_planned_cents=5000
    ).json()

    assert category["is_sinking_fund"] is True
    assert category["default_planned_cents"] == 5000


def test_an_unused_category_deletes_cleanly(auth_client, group):
    category = add_category(auth_client, group["id"], "Spare").json()

    assert auth_client.delete(f"{CATEGORIES}/{category['id']}", headers=HEADERS).status_code == 204
    assert auth_client.get(GROUPS).json()["items"][0]["categories"] == []


def test_a_category_in_use_needs_a_reassignment_target(auth_client, group):
    keep = add_category(auth_client, group["id"], "Keep").json()
    doomed = add_category(auth_client, group["id"], "Doomed").json()

    moved_rows: list[tuple[int, int]] = []
    references.register_category_counter("fake", lambda db, cid: 3 if cid == doomed["id"] else 0)
    references.register_category_reassigner(
        "fake", lambda db, source, target: moved_rows.append((source, target)) or 3
    )
    try:
        refused = auth_client.delete(f"{CATEGORIES}/{doomed['id']}", headers=HEADERS)
        assert refused.status_code == 409
        assert refused.json()["code"] == "category_in_use"

        accepted = auth_client.delete(
            f"{CATEGORIES}/{doomed['id']}?reassign_to={keep['id']}", headers=HEADERS
        )
        assert accepted.status_code == 204
        assert moved_rows == [(doomed["id"], keep["id"])]
    finally:
        references._category_counters.pop("fake", None)
        references._category_reassigners.pop("fake", None)


def test_a_group_with_categories_cannot_be_deleted(auth_client, group):
    add_category(auth_client, group["id"], "Electric")

    response = auth_client.delete(f"{GROUPS}/{group['id']}", headers=HEADERS)

    assert response.status_code == 409
    assert response.json()["code"] == "group_not_empty"


def test_seeding_the_starter_set(auth_client):
    response = auth_client.post(f"{CATEGORIES}/seed-starter", headers=HEADERS)

    assert response.status_code == 201
    groups = response.json()["items"]
    assert [g["name"] for g in groups][0] == "Income"
    assert any(c["is_sinking_fund"] for g in groups for c in g["categories"])


def test_seeding_twice_adds_nothing_the_second_time(auth_client):
    first = auth_client.post(f"{CATEGORIES}/seed-starter", headers=HEADERS).json()["items"]
    second = auth_client.post(f"{CATEGORIES}/seed-starter", headers=HEADERS).json()["items"]

    def count(groups):
        return sum(len(group["categories"]) for group in groups)

    assert count(first) == count(second)


def test_seeding_leaves_existing_categories_alone(auth_client, group):
    mine = add_category(auth_client, group["id"], "My own").json()

    auth_client.post(f"{CATEGORIES}/seed-starter", headers=HEADERS)

    names = [
        c["name"]
        for g in auth_client.get(GROUPS).json()["items"]
        for c in g["categories"]
        if c["id"] == mine["id"]
    ]
    assert names == ["My own"]
