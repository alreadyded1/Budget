"""Goals and sinking funds (SPEC §13) through the API.

A biweekly schedule anchored 20 days ago puts today in the second period:
    P0 = [today-20, today-7]   P1 = [today-6, today+7]   P2, P3, ... after that.
"""

from datetime import date, timedelta

import pytest

HEADERS = {"X-PB-Request": "1"}
TODAY = date.today()
ANCHOR = TODAY - timedelta(days=20)


def post(client, path, body):
    response = client.post(path, json=body, headers=HEADERS)
    assert response.status_code in (200, 201), response.text
    return response.json()


def iso(day: date) -> str:
    return day.isoformat()


@pytest.fixture
def periods(auth_client):
    post(
        auth_client,
        "/api/v1/pay-schedule",
        {"frequency": "biweekly", "effective_from": iso(ANCHOR), "anchor_date": iso(ANCHOR)},
    )
    rows = auth_client.get(
        f"/api/v1/pay-periods?from={iso(ANCHOR)}&to={iso(TODAY + timedelta(days=60))}"
    ).json()["items"]
    assert rows[1]["start_date"] <= iso(TODAY) <= rows[1]["end_date"]
    return rows


@pytest.fixture
def setup(auth_client, periods):
    c = auth_client
    checking = post(
        c,
        "/api/v1/accounts",
        {"name": "Checking", "type": "checking", "opening_date": iso(ANCHOR - timedelta(days=60))},
    )
    living = post(c, "/api/v1/category-groups", {"name": "Living"})
    income = post(c, "/api/v1/category-groups", {"name": "Income", "kind": "income"})
    cats = {
        "Car insurance": post(
            c, "/api/v1/categories", {"group_id": living["id"], "name": "Car insurance"}
        ),
        "Groceries": post(c, "/api/v1/categories", {"group_id": living["id"], "name": "Groceries"}),
        "Salary": post(c, "/api/v1/categories", {"group_id": income["id"], "name": "Salary"}),
    }
    return {"checking": checking, "cats": cats, "periods": periods}


def plan(client, period, category, cents):
    response = client.put(
        f"/api/v1/budget/{period['id']}/categories/{category['id']}",
        json={"planned_cents": cents},
        headers=HEADERS,
    )
    assert response.status_code == 200, response.text
    return response.json()


def spend(client, account, category, cents, on):
    return post(
        client,
        "/api/v1/transactions",
        {
            "account_id": account["id"],
            "date": iso(on),
            "amount_cents": cents,
            "splits": [{"amount_cents": cents, "category_id": category["id"]}],
        },
    )


def line(view, category):
    for group in view["expense"] + view["income"]:
        for row in group["lines"]:
            if row["category_id"] == category["id"]:
                return row
    raise AssertionError("no such line")


def fund(client, category, **extra):
    body = {
        "name": "Car insurance",
        "type": "sinking_fund",
        "target_cents": 60_000,
        "category_id": category["id"],
        "starting_balance_cents": 10_000,
        "start_date": iso(ANCHOR + timedelta(days=3)),  # rounds back to P0's start
        **extra,
    }
    return post(client, "/api/v1/goals", body)


class TestSinkingFund:
    def test_the_balance_accumulates_and_survives_overspending(self, auth_client, setup):
        c, (p0, p1) = auth_client, setup["periods"][:2]
        insurance = setup["cats"]["Car insurance"]
        goal = fund(c, insurance)
        assert goal["start_date"] == p0["start_date"]
        plan(c, p0, insurance, 5_000)
        plan(c, p1, insurance, 5_000)

        # Period by period: 10,000 + 5,000, then + 5,000 − 12,000.
        spend(c, setup["checking"], insurance, -12_000, TODAY)
        first = line(c.get(f"/api/v1/budget/{p0['id']}").json(), insurance)
        second = line(c.get(f"/api/v1/budget/{p1['id']}").json(), insurance)
        assert first["fund_balance_cents"] == 15_000
        assert second["fund_balance_cents"] == 8_000
        # Spending more than this period's plan is what a fund is for.
        assert second["actual_cents"] == 12_000
        assert second["overspent"] is False

        # A second bill takes the fund below zero: now it is overspent.
        spend(c, setup["checking"], insurance, -20_000, TODAY)
        second = line(c.get(f"/api/v1/budget/{p1['id']}").json(), insurance)
        assert second["fund_balance_cents"] == -12_000
        assert second["overspent"] is True

        # A refund adds back, and later plans refill it.
        spend(c, setup["checking"], insurance, 2_000, TODAY)
        p2 = setup["periods"][2]
        plan(c, p2, insurance, 15_000)
        third = line(c.get(f"/api/v1/budget/{p2['id']}").json(), insurance)
        assert third["fund_balance_cents"] == -12_000 + 2_000 + 15_000

        listed = c.get("/api/v1/goals").json()["items"][0]
        assert listed["progress_cents"] == -10_000
        assert listed["remaining_cents"] == 70_000
        assert listed["current_planned_cents"] == 5_000

    def test_spending_before_the_start_does_not_count(self, auth_client, setup):
        c = auth_client
        insurance = setup["cats"]["Car insurance"]
        spend(c, setup["checking"], insurance, -9_999, ANCHOR - timedelta(days=5))
        goal = fund(c, insurance, starting_balance_cents=0)
        assert goal["progress_cents"] == 0

    def test_regular_categories_still_reset_every_period(self, auth_client, setup):
        c, (p0, p1) = auth_client, setup["periods"][:2]
        groceries = setup["cats"]["Groceries"]
        fund(c, setup["cats"]["Car insurance"])
        plan(c, p0, groceries, 5_000)
        plan(c, p1, groceries, 5_000)
        spend(c, setup["checking"], groceries, -1_000, date.fromisoformat(p0["start_date"]))

        row = line(c.get(f"/api/v1/budget/{p1['id']}").json(), groceries)

        # P0's unspent 4,000 does not carry over.
        assert row["remaining_cents"] == 5_000
        assert row["fund_balance_cents"] is None
        spend(c, setup["checking"], groceries, -6_000, TODAY)
        assert line(c.get(f"/api/v1/budget/{p1['id']}").json(), groceries)["overspent"] is True

    def test_suggested_contribution_fills_this_periods_plan(self, auth_client, setup):
        c, periods = auth_client, setup["periods"]
        insurance = setup["cats"]["Car insurance"]
        # Due at the end of P3: P1, P2, P3 are left (3 periods).
        goal = fund(c, insurance, target_date=periods[3]["end_date"])
        plan(c, periods[0], insurance, 5_000)
        plan(c, periods[1], insurance, 1_000)

        before = c.get(f"/api/v1/goals/{goal['id']}").json()
        # Base without this period's own plan: 10,000 + 5,000 = 15,000; 45,000 over 3.
        assert before["periods_left"] == 3
        assert before["needed_cents"] == 15_000
        assert before["status"] == "behind"

        after = post(c, f"/api/v1/goals/{goal['id']}/use-suggested", {})

        assert after["current_planned_cents"] == 15_000
        assert after["needed_cents"] == 15_000  # the same suggestion, now in the plan
        assert after["progress_cents"] == 30_000
        assert after["projected_date"] == periods[3]["end_date"]
        assert after["status"] == "on_track"
        view = c.get(f"/api/v1/budget/{periods[1]['id']}").json()
        assert line(view, insurance)["planned_cents"] == 15_000

    def test_one_fund_per_expense_category(self, auth_client, setup):
        c = auth_client
        insurance = setup["cats"]["Car insurance"]
        fund(c, insurance)
        categories = c.get("/api/v1/category-groups").json()["items"]
        flagged = {
            cat["name"]: cat["is_sinking_fund"] for g in categories for cat in g["categories"]
        }
        assert flagged["Car insurance"] is True

        again = c.post(
            "/api/v1/goals",
            json={
                "name": "Again",
                "type": "sinking_fund",
                "target_cents": 1,
                "category_id": insurance["id"],
            },
            headers=HEADERS,
        )
        assert again.status_code == 409
        assert again.json()["code"] == "sinking_fund_taken"
        income = c.post(
            "/api/v1/goals",
            json={
                "name": "Pay",
                "type": "sinking_fund",
                "target_cents": 1,
                "category_id": setup["cats"]["Salary"]["id"],
            },
            headers=HEADERS,
        )
        assert income.json()["code"] == "goal_category_income"


class TestSavingsGoal:
    @pytest.fixture
    def savings(self, auth_client, setup):
        c, periods = auth_client, setup["periods"]
        account = post(
            c,
            "/api/v1/accounts",
            {
                "name": "Vacation savings",
                "type": "savings",
                "opening_balance_cents": 50_000,
                "opening_date": iso(ANCHOR - timedelta(days=60)),
            },
        )
        # 10,000 moved in during each of the three periods before P1.
        before = periods[0]["start_date"]
        for days in (-14, -1, 13):
            post(
                c,
                "/api/v1/transfers",
                {
                    "from_account_id": setup["checking"]["id"],
                    "to_account_id": account["id"],
                    "date": iso(date.fromisoformat(before) + timedelta(days=days)),
                    "amount_cents": 10_000,
                },
            )
        return account

    def test_progress_is_the_balance_minus_the_starting_amount(self, auth_client, setup, savings):
        periods = setup["periods"]
        goal = post(
            auth_client,
            "/api/v1/goals",
            {
                "name": "Vacation",
                "type": "savings",
                "target_cents": 200_000,
                "target_date": periods[4]["end_date"],
                "account_id": savings["id"],
                "starting_balance_cents": 50_000,
            },
        )
        assert goal["progress_cents"] == 30_000
        assert goal["remaining_cents"] == 170_000
        assert goal["periods_left"] == 4
        assert goal["needed_cents"] == 42_500
        # The schedule starts at P0, so only P0 is a completed period: it added 10,000.
        assert goal["rate_cents"] == 10_000
        assert goal["status"] == "behind"
        assert goal["current_planned_cents"] is None

    def test_a_suggestion_needs_a_plan_category(self, auth_client, setup, savings):
        c = auth_client
        periods = setup["periods"]
        body = {
            "name": "Vacation",
            "type": "savings",
            "target_cents": 200_000,
            "target_date": periods[4]["end_date"],
            "account_id": savings["id"],
            "starting_balance_cents": 50_000,
        }
        goal = post(c, "/api/v1/goals", body)
        refused = c.post(f"/api/v1/goals/{goal['id']}/use-suggested", headers=HEADERS)
        assert refused.json()["code"] == "goal_category_required"

        category = setup["cats"]["Groceries"]
        patched = c.patch(
            f"/api/v1/goals/{goal['id']}", json={"category_id": category["id"]}, headers=HEADERS
        ).json()
        assert patched["category_id"] == category["id"]
        done = post(c, f"/api/v1/goals/{goal['id']}/use-suggested", {})
        assert done["current_planned_cents"] == 42_500
        # A savings goal's category is not a fund.
        view = c.get(f"/api/v1/budget/{periods[1]['id']}").json()
        assert line(view, category)["fund_balance_cents"] is None

    def test_liability_accounts_are_refused(self, auth_client, setup):
        card = post(auth_client, "/api/v1/accounts", {"name": "Visa", "type": "credit_card"})
        response = auth_client.post(
            "/api/v1/goals",
            json={
                "name": "Pay off",
                "type": "savings",
                "target_cents": 1,
                "account_id": card["id"],
            },
            headers=HEADERS,
        )
        assert response.json()["code"] == "goal_account_liability"

    def test_reached_and_archived(self, auth_client, setup, savings):
        c = auth_client
        goal = post(
            c,
            "/api/v1/goals",
            {
                "name": "Small",
                "type": "savings",
                "target_cents": 20_000,
                "account_id": savings["id"],
            },
        )
        assert goal["status"] == "done"
        assert goal["remaining_cents"] == 0
        assert goal["needed_cents"] is None  # no target date
        c.patch(f"/api/v1/goals/{goal['id']}", json={"is_archived": True}, headers=HEADERS)
        assert c.get("/api/v1/goals").json()["items"] == []
        assert len(c.get("/api/v1/goals?archived=true").json()["items"]) == 1
        assert c.delete(f"/api/v1/goals/{goal['id']}", headers=HEADERS).status_code == 204
