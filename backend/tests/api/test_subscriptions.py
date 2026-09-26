"""Subscriptions and bills through the API: occurrences, edits, payments and the planner."""

from datetime import date, timedelta

import pytest

HEADERS = {"X-PB-Request": "1"}
SUBS = "/api/v1/subscriptions"
BILLS = "/api/v1/bills"
TX = "/api/v1/transactions"
TODAY = date.today()


def post(client, path, body=None):
    response = client.post(path, json=body or {}, headers=HEADERS)
    assert response.status_code in (200, 201), response.text
    return response.json()


def patch(client, path, body):
    response = client.patch(path, json=body, headers=HEADERS)
    assert response.status_code == 200, response.text
    return response.json()


@pytest.fixture
def refs(auth_client):
    account = post(
        auth_client,
        "/api/v1/accounts",
        {"name": "Checking", "type": "checking", "opening_date": "2025-01-01"},
    )
    group = post(auth_client, "/api/v1/category-groups", {"name": "Bills"})
    streaming = post(
        auth_client, "/api/v1/categories", {"group_id": group["id"], "name": "Streaming"}
    )
    phone = post(auth_client, "/api/v1/categories", {"group_id": group["id"], "name": "Phone"})
    netflix = post(auth_client, "/api/v1/payees", {"name": "Netflix"})
    return {"account": account, "streaming": streaming, "phone": phone, "netflix": netflix}


def netflix(client, refs, **overrides):
    body = {
        "name": "Netflix",
        "payee_id": refs["netflix"]["id"],
        "category_id": refs["streaming"]["id"],
        "account_id": refs["account"]["id"],
        "amount_cents": 1599,
        "frequency": "monthly",
        "anchor_date": TODAY.isoformat(),
    }
    body.update(overrides)
    return post(client, SUBS, body)


def bills_for(client, subscription_id, days=400):
    start = (TODAY - timedelta(days=60)).isoformat()
    end = (TODAY + timedelta(days=days)).isoformat()
    items = client.get(f"{BILLS}?from={start}&to={end}").json()["items"]
    return [bill for bill in items if bill["subscription_id"] == subscription_id]


class TestCreate:
    def test_it_materializes_about_13_months(self, auth_client, refs):
        sub = netflix(auth_client, refs)
        bills = bills_for(auth_client, sub["id"])
        assert 13 <= len(bills) <= 14
        assert bills[0]["due_date"] == TODAY.isoformat()
        assert all(bill["status"] == "upcoming" and bill["amount_cents"] == 1599 for bill in bills)
        assert sub["next_due_date"] == TODAY.isoformat()

    def test_equivalents_and_price_history(self, auth_client, refs):
        sub = netflix(auth_client, refs, frequency="annual", amount_cents=12_000)
        assert sub["annual_cents"] == 12_000
        assert sub["monthly_cents"] == 1_000
        assert sub["price_history"] == [
            {"effective_date": TODAY.isoformat(), "amount_cents": 12_000}
        ]
        assert sub["price_increased"] is False

    def test_a_custom_schedule_needs_a_unit(self, auth_client, refs):
        response = auth_client.post(
            SUBS,
            json={
                "name": "Odd",
                "amount_cents": 100,
                "frequency": "custom",
                "anchor_date": "2026-01-01",
            },
            headers=HEADERS,
        )
        assert response.status_code == 422
        assert response.json()["code"] == "invalid_schedule"

    def test_unknown_references_are_refused(self, auth_client, refs):
        response = auth_client.post(
            SUBS,
            json={"name": "X", "amount_cents": 100, "anchor_date": "2026-01-01", "payee_id": 9999},
            headers=HEADERS,
        )
        assert response.status_code == 404

    def test_the_list_totals_active_ones_by_category(self, auth_client, refs):
        netflix(auth_client, refs)  # 15.99 a month
        post(
            auth_client,
            SUBS,
            {
                "name": "Phone",
                "category_id": refs["phone"]["id"],
                "amount_cents": 6000,
                "frequency": "quarterly",
                "anchor_date": TODAY.isoformat(),
            },
        )
        post(
            auth_client,
            SUBS,
            {
                "name": "Old gym",
                "amount_cents": 5000,
                "anchor_date": TODAY.isoformat(),
                "status": "cancelled",
            },
        )
        body = auth_client.get(SUBS).json()
        assert [item["name"] for item in body["items"]] == ["Netflix", "Old gym", "Phone"]
        assert body["monthly_cents"] == 1599 + 2000
        assert body["annual_cents"] == 19_188 + 24_000
        assert {row["category_id"]: row["annual_cents"] for row in body["by_category"]} == {
            refs["phone"]["id"]: 24_000,
            refs["streaming"]["id"]: 19_188,
        }


class TestEdits:
    def test_edits_never_touch_paid_or_skipped_occurrences(self, auth_client, refs):
        sub = netflix(auth_client, refs)
        first, second, third = bills_for(auth_client, sub["id"])[:3]
        post(auth_client, f"{BILLS}/{first['occurrence_id']}/pay")
        post(auth_client, f"{BILLS}/{second['occurrence_id']}/skip")

        updated = patch(auth_client, f"{SUBS}/{sub['id']}", {"amount_cents": 1799})

        bills = {bill["due_date"]: bill for bill in bills_for(auth_client, sub["id"])}
        assert bills[first["due_date"]]["status"] == "paid"
        assert bills[first["due_date"]]["amount_cents"] == 1599
        assert bills[first["due_date"]]["occurrence_id"] == first["occurrence_id"]
        assert bills[second["due_date"]]["status"] == "skipped"
        assert bills[second["due_date"]]["amount_cents"] == 1599
        assert bills[third["due_date"]]["amount_cents"] == 1799
        # A price rise is recorded and flagged.
        assert updated["previous_amount_cents"] == 1599
        assert updated["price_increased"] is True

    def test_moving_the_due_day_rebuilds_only_the_future(self, auth_client, refs):
        sub = netflix(auth_client, refs)
        first = bills_for(auth_client, sub["id"])[0]
        post(auth_client, f"{BILLS}/{first['occurrence_id']}/pay")
        new_anchor = TODAY + timedelta(days=5)

        patch(auth_client, f"{SUBS}/{sub['id']}", {"anchor_date": new_anchor.isoformat()})

        bills = bills_for(auth_client, sub["id"])
        assert bills[0]["due_date"] == TODAY.isoformat() and bills[0]["status"] == "paid"
        assert bills[1]["due_date"] == new_anchor.isoformat()

    def test_an_overdue_bill_survives_an_edit(self, auth_client, refs):
        sub = netflix(auth_client, refs, anchor_date=(TODAY + timedelta(days=1)).isoformat())
        # Pretend it was created earlier: an unpaid bill from last week.
        from app.db import SessionLocal
        from app.models import SubscriptionOccurrence

        with SessionLocal() as db:
            db.add(
                SubscriptionOccurrence(
                    subscription_id=sub["id"],
                    due_date=TODAY - timedelta(days=7),
                    amount_cents=1599,
                )
            )
            db.commit()
        patch(auth_client, f"{SUBS}/{sub['id']}", {"amount_cents": 2000})
        bills = bills_for(auth_client, sub["id"])
        assert bills[0]["due_date"] == (TODAY - timedelta(days=7)).isoformat()
        assert bills[0]["overdue"] is True
        assert bills[0]["amount_cents"] == 1599

    def test_pausing_removes_future_bills_and_resuming_brings_them_back(self, auth_client, refs):
        sub = netflix(auth_client, refs)
        first = bills_for(auth_client, sub["id"])[0]
        post(auth_client, f"{BILLS}/{first['occurrence_id']}/pay")

        patch(auth_client, f"{SUBS}/{sub['id']}", {"status": "paused"})
        left = bills_for(auth_client, sub["id"])
        assert [bill["status"] for bill in left] == ["paid"]

        patch(auth_client, f"{SUBS}/{sub['id']}", {"status": "active"})
        assert len(bills_for(auth_client, sub["id"])) >= 13

    def test_an_end_date_stops_the_bills(self, auth_client, refs):
        end = TODAY + timedelta(days=70)
        sub = netflix(auth_client, refs, end_date=end.isoformat())
        bills = bills_for(auth_client, sub["id"])
        assert 2 <= len(bills) <= 3
        assert all(bill["due_date"] <= end.isoformat() for bill in bills)

    def test_deleting_keeps_the_payments(self, auth_client, refs):
        sub = netflix(auth_client, refs)
        tx = post(
            auth_client,
            TX,
            {"account_id": refs["account"]["id"], "date": TODAY.isoformat(), "amount_cents": -1599},
        )["transactions"][0]
        post(
            auth_client,
            f"{BILLS}/{bills_for(auth_client, sub['id'])[0]['occurrence_id']}/pay",
            {"transaction_id": tx["id"]},
        )
        assert auth_client.delete(f"{SUBS}/{sub['id']}", headers=HEADERS).status_code == 204
        assert auth_client.get(f"{TX}/{tx['id']}").status_code == 200


class TestPayments:
    def test_mark_paid_from_the_entry_row(self, auth_client, refs):
        sub = netflix(auth_client, refs)
        bill = bills_for(auth_client, sub["id"])[0]
        body = post(
            auth_client,
            TX,
            {
                "account_id": refs["account"]["id"],
                "date": TODAY.isoformat(),
                "amount_cents": -1599,
                "payee_id": refs["netflix"]["id"],
                "subscription_occurrence_id": bill["occurrence_id"],
            },
        )
        assert body["paid_occurrence_id"] == bill["occurrence_id"]
        assert body["bill_match"] is None
        paid = bills_for(auth_client, sub["id"])[0]
        assert paid["status"] == "paid"
        assert paid["transaction_id"] == body["transactions"][0]["id"]

    def test_an_unknown_bill_writes_nothing(self, auth_client, refs):
        response = auth_client.post(
            TX,
            json={
                "account_id": refs["account"]["id"],
                "date": TODAY.isoformat(),
                "amount_cents": -1599,
                "subscription_occurrence_id": 99999,
            },
            headers=HEADERS,
        )
        assert response.status_code == 404
        assert auth_client.get(TX).json()["items"] == []

    def test_a_similar_payment_is_suggested(self, auth_client, refs):
        sub = netflix(auth_client, refs)
        bill = bills_for(auth_client, sub["id"])[0]
        body = post(
            auth_client,
            TX,
            {
                "account_id": refs["account"]["id"],
                "date": (TODAY + timedelta(days=2)).isoformat(),
                "amount_cents": -1649,
                "payee_id": refs["netflix"]["id"],
            },
        )
        assert body["bill_match"] == {
            "occurrence_id": bill["occurrence_id"],
            "name": "Netflix",
            "due_date": TODAY.isoformat(),
            "amount_cents": 1599,
        }
        # A suggestion only: nothing is linked until asked.
        assert bills_for(auth_client, sub["id"])[0]["status"] == "upcoming"

    def test_a_payment_well_ahead_of_the_due_date_is_suggested(self, auth_client, refs):
        # D-117: up to 14 days early. Due in 10 days, paid today.
        due = TODAY + timedelta(days=10)
        sub = netflix(auth_client, refs, anchor_date=due.isoformat())
        body = post(
            auth_client,
            TX,
            {
                "account_id": refs["account"]["id"],
                "date": TODAY.isoformat(),
                "amount_cents": -1599,
                "payee_id": refs["netflix"]["id"],
            },
        )
        assert (
            body["bill_match"]["occurrence_id"]
            == bills_for(auth_client, sub["id"])[0]["occurrence_id"]
        )
        assert body["bill_match"]["due_date"] == due.isoformat()

    def test_the_oldest_unpaid_bill_comes_first(self, auth_client, refs):
        # A weekly bill: a payment three days after one due date is also four days before
        # the next. It settles the older one.
        sub = netflix(auth_client, refs, frequency="weekly")
        bills = bills_for(auth_client, sub["id"])
        body = post(
            auth_client,
            TX,
            {
                "account_id": refs["account"]["id"],
                "date": (TODAY + timedelta(days=3)).isoformat(),
                "amount_cents": -1599,
                "payee_id": refs["netflix"]["id"],
            },
        )
        assert body["bill_match"]["occurrence_id"] == bills[0]["occurrence_id"]

    def test_a_weekly_bill_never_takes_last_weeks_payment_early(self, auth_client, refs):
        sub = netflix(auth_client, refs, frequency="weekly")
        bills = bills_for(auth_client, sub["id"])
        post(auth_client, f"{BILLS}/{bills[0]['occurrence_id']}/skip")
        # Paid on the first due date: too early for next week's bill, whose window starts
        # the day after.
        body = post(
            auth_client,
            TX,
            {
                "account_id": refs["account"]["id"],
                "date": TODAY.isoformat(),
                "amount_cents": -1599,
                "payee_id": refs["netflix"]["id"],
            },
        )
        assert body["bill_match"] is None

    @pytest.mark.parametrize(
        ("days", "cents", "same_payee"),
        [
            (6, -1599, True),
            (-15, -1599, True),
            (0, -2000, True),
            (0, -1599, False),
            (0, 1599, True),
        ],
    )
    def test_no_suggestion_when_it_does_not_fit(self, auth_client, refs, days, cents, same_payee):
        netflix(auth_client, refs)
        other = post(auth_client, "/api/v1/payees", {"name": "Hulu"})
        body = post(
            auth_client,
            TX,
            {
                "account_id": refs["account"]["id"],
                "date": (TODAY + timedelta(days=days)).isoformat(),
                "amount_cents": cents,
                "payee_id": refs["netflix"]["id"] if same_payee else other["id"],
            },
        )
        assert body["bill_match"] is None

    def test_deleting_the_payment_reopens_the_bill(self, auth_client, refs):
        sub = netflix(auth_client, refs)
        bill = bills_for(auth_client, sub["id"])[0]
        tx = post(
            auth_client,
            TX,
            {
                "account_id": refs["account"]["id"],
                "date": TODAY.isoformat(),
                "amount_cents": -1599,
                "subscription_occurrence_id": bill["occurrence_id"],
            },
        )["transactions"][0]
        auth_client.delete(f"{TX}/{tx['id']}", headers=HEADERS)
        reopened = bills_for(auth_client, sub["id"])[0]
        assert reopened["status"] == "upcoming"
        assert reopened["transaction_id"] is None

    def test_one_payment_pays_one_bill(self, auth_client, refs):
        sub = netflix(auth_client, refs)
        first, second = bills_for(auth_client, sub["id"])[:2]
        tx = post(
            auth_client,
            TX,
            {"account_id": refs["account"]["id"], "date": TODAY.isoformat(), "amount_cents": -1599},
        )["transactions"][0]
        post(auth_client, f"{BILLS}/{first['occurrence_id']}/pay", {"transaction_id": tx["id"]})
        response = auth_client.post(
            f"{BILLS}/{second['occurrence_id']}/pay",
            json={"transaction_id": tx["id"]},
            headers=HEADERS,
        )
        assert response.status_code == 409

    def test_skip_and_reopen(self, auth_client, refs):
        sub = netflix(auth_client, refs)
        bill = bills_for(auth_client, sub["id"])[0]
        assert post(auth_client, f"{BILLS}/{bill['occurrence_id']}/skip")["status"] == "skipped"
        assert post(auth_client, f"{BILLS}/{bill['occurrence_id']}/reopen")["status"] == "upcoming"


class TestPlanner:
    @pytest.fixture
    def period(self, auth_client):
        start = TODAY - timedelta(days=2)
        post(
            auth_client,
            "/api/v1/pay-schedule",
            {
                "frequency": "biweekly",
                "effective_from": start.isoformat(),
                "anchor_date": start.isoformat(),
            },
        )
        return auth_client.get("/api/v1/pay-periods/current").json()

    def line(self, view, name):
        return next(row for g in view["expense"] for row in g["lines"] if row["name"] == name)

    def test_the_planner_shows_committed_bills_and_prefills_with_them(
        self, auth_client, refs, period
    ):
        auth_client.patch(
            f"/api/v1/categories/{refs['streaming']['id']}",
            json={"default_planned_cents": 5000},
            headers=HEADERS,
        )
        netflix(auth_client, refs)  # due today, inside the period
        post(
            auth_client,
            SUBS,
            {
                "name": "Spotify",
                "category_id": refs["streaming"]["id"],
                "amount_cents": 1199,
                "frequency": "monthly",
                "anchor_date": (TODAY + timedelta(days=3)).isoformat(),
            },
        )

        view = auth_client.get(f"/api/v1/budget/{period['id']}").json()

        streaming = self.line(view, "Streaming")
        assert streaming["committed_cents"] == 1599 + 1199
        # D-065: template plus bills.
        assert streaming["planned_cents"] == 5000 + 1599 + 1199

    def test_a_skipped_bill_is_not_committed(self, auth_client, refs, period):
        sub = netflix(auth_client, refs)
        post(auth_client, f"{BILLS}/{bills_for(auth_client, sub['id'])[0]['occurrence_id']}/skip")
        view = auth_client.get(f"/api/v1/budget/{period['id']}").json()
        assert self.line(view, "Streaming")["committed_cents"] == 0

    def test_an_opened_period_keeps_its_plan_but_the_hint_updates(self, auth_client, refs, period):
        first = auth_client.get(f"/api/v1/budget/{period['id']}").json()
        assert self.line(first, "Streaming")["planned_cents"] == 0
        netflix(auth_client, refs)
        again = auth_client.get(f"/api/v1/budget/{period['id']}").json()
        assert self.line(again, "Streaming")["planned_cents"] == 0
        assert self.line(again, "Streaming")["committed_cents"] == 1599
        # Apply template brings the bills in.
        applied = post(auth_client, f"/api/v1/budget/{period['id']}/apply-template")
        assert self.line(applied, "Streaming")["planned_cents"] == 1599

    def test_the_dashboard_lists_upcoming_bills(self, auth_client, refs, period):
        sub = netflix(auth_client, refs)
        board = auth_client.get("/api/v1/dashboard").json()
        assert [bill["name"] for bill in board["upcoming_bills"]] == ["Netflix"]
        post(auth_client, f"{BILLS}/{bills_for(auth_client, sub['id'])[0]['occurrence_id']}/pay")
        assert auth_client.get("/api/v1/dashboard").json()["upcoming_bills"] == []


class TestReferences:
    def test_merging_payees_moves_subscriptions(self, auth_client, refs):
        sub = netflix(auth_client, refs)
        target = post(auth_client, "/api/v1/payees", {"name": "Netflix Inc"})
        result = post(
            auth_client,
            f"/api/v1/payees/{target['id']}/merge",
            {"source_id": refs["netflix"]["id"]},
        )
        assert result["moved"]["subscriptions"] == 1
        assert auth_client.get(f"{SUBS}/{sub['id']}").json()["payee_id"] == target["id"]

    def test_deleting_a_category_with_reassignment_moves_them(self, auth_client, refs):
        sub = netflix(auth_client, refs)
        response = auth_client.delete(
            f"/api/v1/categories/{refs['streaming']['id']}?reassign_to={refs['phone']['id']}",
            headers=HEADERS,
        )
        assert response.status_code == 204
        assert auth_client.get(f"{SUBS}/{sub['id']}").json()["category_id"] == refs["phone"]["id"]

    def test_deleting_a_category_outright_leaves_them_uncategorized(self, auth_client, refs):
        sub = netflix(auth_client, refs)
        assert (
            auth_client.delete(
                f"/api/v1/categories/{refs['streaming']['id']}", headers=HEADERS
            ).status_code
            == 204
        )
        assert auth_client.get(f"{SUBS}/{sub['id']}").json()["category_id"] is None
