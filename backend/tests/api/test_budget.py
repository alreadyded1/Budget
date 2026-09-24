"""The budget planner: actuals, prefill, edits, actions, proration, and the dashboard."""

from datetime import date, timedelta

import pytest
from sqlalchemy import select

from app.models import PayPeriod, PeriodPlan

HEADERS = {"X-PB-Request": "1"}
BUDGET = "/api/v1/budget"
TX = "/api/v1/transactions"

# Biweekly from Friday 2026-01-02: Jan 2–15, Jan 16–29, Jan 30–Feb 12, ...
ANCHOR = date(2026, 1, 2)


def post(client, path, body):
    response = client.post(path, json=body, headers=HEADERS)
    assert response.status_code in (200, 201), response.text
    return response.json()


@pytest.fixture
def periods(auth_client):
    post(
        auth_client,
        "/api/v1/pay-schedule",
        {
            "frequency": "biweekly",
            "effective_from": ANCHOR.isoformat(),
            "anchor_date": ANCHOR.isoformat(),
        },
    )
    rows = auth_client.get("/api/v1/pay-periods?from=2026-01-01&to=2026-03-01").json()["items"]
    return rows


@pytest.fixture
def first(periods):
    return periods[0]


def account(client, name, kind="checking", opening=0):
    return post(
        client,
        "/api/v1/accounts",
        {
            "name": name,
            "type": kind,
            "opening_balance_cents": opening,
            "opening_date": "2025-12-01",
        },
    )


@pytest.fixture
def checking(auth_client):
    return account(auth_client, "Checking", opening=500_000)


@pytest.fixture
def savings(auth_client):
    return account(auth_client, "Savings", "savings")


@pytest.fixture
def loan(auth_client):
    return account(auth_client, "Car Loan", "loan", opening=-1_000_000)


@pytest.fixture
def cats(auth_client):
    """Food: Groceries, Dining · Home: Rent · Income: Paycheck."""
    food = post(auth_client, "/api/v1/category-groups", {"name": "Food"})
    home = post(auth_client, "/api/v1/category-groups", {"name": "Home"})
    income = post(auth_client, "/api/v1/category-groups", {"name": "Income", "kind": "income"})
    made = {}
    for group, name, default in (
        (food, "Groceries", 40_000),
        (food, "Dining", 10_000),
        (home, "Rent", 120_000),
        (income, "Paycheck", 250_000),
    ):
        category = post(auth_client, "/api/v1/categories", {"group_id": group["id"], "name": name})
        auth_client.patch(
            f"/api/v1/categories/{category['id']}",
            json={"default_planned_cents": default},
            headers=HEADERS,
        )
        made[name] = category
    return made


def spend(client, acct, on, cents, category=None, splits=None):
    body = {"account_id": acct["id"], "date": on.isoformat(), "amount_cents": cents}
    if splits is not None:
        body["splits"] = splits
    elif category is not None:
        body["splits"] = [{"amount_cents": cents, "category_id": category["id"]}]
    return post(client, TX, body)


def line(view, name):
    for group in view["income"] + view["expense"]:
        for row in group["lines"]:
            if row["name"] == name:
                return row
    raise AssertionError(f"no line {name}")


def open_budget(client, period):
    response = client.get(f"{BUDGET}/{period['id']}")
    assert response.status_code == 200, response.text
    return response.json()


class TestActuals:
    def test_actuals_match_the_ledger(self, auth_client, first, checking, cats):
        start = date.fromisoformat(first["start_date"])
        end = date.fromisoformat(first["end_date"])
        groceries, dining = cats["Groceries"], cats["Dining"]
        spend(auth_client, checking, start, -4520, groceries)
        spend(auth_client, checking, end, -1000, groceries)  # the last day counts
        spend(auth_client, checking, start - timedelta(days=1), -9999, groceries)  # before
        spend(auth_client, checking, end + timedelta(days=1), -8888, groceries)  # after
        spend(auth_client, checking, start + timedelta(days=3), 500, groceries)  # a refund
        spend(
            auth_client,
            checking,
            start + timedelta(days=4),
            -6000,
            splits=[
                {"amount_cents": -4000, "category_id": groceries["id"]},
                {"amount_cents": -2000, "category_id": dining["id"]},
            ],
        )
        spend(auth_client, checking, start + timedelta(days=5), 250_000, cats["Paycheck"])

        view = open_budget(auth_client, first)

        for name, sign in (("Groceries", -1), ("Dining", -1), ("Paycheck", 1)):
            category = cats[name]
            ledger = auth_client.get(
                f"{TX}?from={start}&to={end}&category_id={category['id']}"
            ).json()
            # A split transaction's total spans categories, so sum the splits themselves.
            split_total = sum(
                split["amount_cents"]
                for row in ledger["items"]
                for split in row["transaction"]["splits"]
                if split["category_id"] == category["id"]
            )
            assert line(view, name)["actual_cents"] == sign * split_total

        assert line(view, "Groceries")["actual_cents"] == 4520 + 1000 - 500 + 4000
        assert line(view, "Dining")["actual_cents"] == 2000
        assert line(view, "Paycheck")["actual_cents"] == 250_000
        assert view["summary"]["spent_cents"] == 9020 + 2000
        assert view["summary"]["received_income_cents"] == 250_000

    def test_a_refund_can_leave_spending_negative(self, auth_client, first, checking, cats):
        spend(auth_client, checking, date.fromisoformat(first["start_date"]), 700, cats["Dining"])
        row = line(open_budget(auth_client, first), "Dining")
        assert row["actual_cents"] == -700
        assert row["remaining_cents"] == 10_000 + 700
        assert row["overspent"] is False

    def test_transfers_between_on_budget_accounts_are_excluded(
        self, auth_client, first, checking, savings, cats
    ):
        on = date.fromisoformat(first["start_date"])
        spend(auth_client, checking, on, -1000, cats["Groceries"])
        post(
            auth_client,
            "/api/v1/transfers",
            {
                "from_account_id": checking["id"],
                "to_account_id": savings["id"],
                "date": on.isoformat(),
                "amount_cents": 50_000,
            },
        )

        view = open_budget(auth_client, first)

        assert view["summary"]["spent_cents"] == 1000
        assert view["summary"]["received_income_cents"] == 0
        assert view["uncategorized_count"] == 0

    def test_a_payment_to_a_tracking_account_counts(self, auth_client, first, checking, loan, cats):
        on = date.fromisoformat(first["start_date"])
        post(
            auth_client,
            "/api/v1/transfers",
            {
                "from_account_id": checking["id"],
                "to_account_id": loan["id"],
                "date": on.isoformat(),
                "amount_cents": 30_000,
                "category_id": cats["Rent"]["id"],
            },
        )
        assert line(open_budget(auth_client, first), "Rent")["actual_cents"] == 30_000

    def test_tracking_account_spending_is_ignored(self, auth_client, first, loan, cats):
        spend(auth_client, loan, date.fromisoformat(first["start_date"]), -2500, cats["Groceries"])
        spend(auth_client, loan, date.fromisoformat(first["start_date"]), -700)
        view = open_budget(auth_client, first)
        assert line(view, "Groceries")["actual_cents"] == 0
        assert view["uncategorized_count"] == 0

    def test_uncategorized_transactions_are_counted(self, auth_client, first, checking, cats):
        on = date.fromisoformat(first["start_date"])
        spend(auth_client, checking, on, -100)
        spend(auth_client, checking, on, -200)
        spend(
            auth_client,
            checking,
            on,
            -300,
            splits=[
                {"amount_cents": -100, "category_id": cats["Dining"]["id"]},
                {"amount_cents": -200, "category_id": None},
            ],
        )
        spend(auth_client, checking, on - timedelta(days=1), -400)  # previous period
        assert open_budget(auth_client, first)["uncategorized_count"] == 3

    def test_overspent_is_flagged(self, auth_client, first, checking, cats):
        spend(
            auth_client, checking, date.fromisoformat(first["start_date"]), -10_001, cats["Dining"]
        )
        assert line(open_budget(auth_client, first), "Dining")["overspent"] is True


class TestPrefill:
    def test_a_new_period_prefills_from_the_template(self, auth_client, first, cats):
        view = open_budget(auth_client, first)
        assert line(view, "Groceries")["planned_cents"] == 40_000
        assert line(view, "Paycheck")["planned_cents"] == 250_000
        summary = view["summary"]
        assert summary["expected_income_cents"] == 250_000
        assert summary["planned_expense_cents"] == 170_000
        assert summary["left_to_plan_cents"] == 80_000

    def test_hidden_categories_are_left_out(self, auth_client, first, cats):
        auth_client.patch(
            f"/api/v1/categories/{cats['Dining']['id']}", json={"is_hidden": True}, headers=HEADERS
        )
        view = open_budget(auth_client, first)
        names = [row["name"] for group in view["expense"] for row in group["lines"]]
        assert "Dining" not in names

    def test_an_opened_period_keeps_its_plan_when_the_template_changes(
        self, auth_client, first, cats
    ):
        open_budget(auth_client, first)
        auth_client.patch(
            f"/api/v1/categories/{cats['Groceries']['id']}",
            json={"default_planned_cents": 1},
            headers=HEADERS,
        )
        assert line(open_budget(auth_client, first), "Groceries")["planned_cents"] == 40_000

    def test_clearing_does_not_bring_the_template_back(self, auth_client, first, cats):
        open_budget(auth_client, first)
        cleared = post(auth_client, f"{BUDGET}/{first['id']}/clear", {})
        assert cleared["summary"]["planned_expense_cents"] == 0
        assert open_budget(auth_client, first)["summary"]["planned_expense_cents"] == 0


class TestEditing:
    def test_setting_a_planned_amount_returns_the_new_totals(
        self, auth_client, first, checking, cats
    ):
        spend(auth_client, checking, date.fromisoformat(first["start_date"]), -5000, cats["Dining"])
        response = auth_client.put(
            f"{BUDGET}/{first['id']}/categories/{cats['Dining']['id']}",
            json={"planned_cents": 4000},
            headers=HEADERS,
        )
        assert response.status_code == 200
        view = response.json()
        row = line(view, "Dining")
        assert row["planned_cents"] == 4000
        assert row["remaining_cents"] == -1000
        assert row["overspent"] is True
        assert view["summary"]["planned_expense_cents"] == 40_000 + 4000 + 120_000
        food = next(group for group in view["expense"] if group["name"] == "Food")
        assert food["planned_cents"] == 44_000
        assert food["actual_cents"] == 5000

    def test_a_negative_plan_is_refused(self, auth_client, first, cats):
        response = auth_client.put(
            f"{BUDGET}/{first['id']}/categories/{cats['Dining']['id']}",
            json={"planned_cents": -1},
            headers=HEADERS,
        )
        assert response.status_code == 422

    def test_a_note_is_kept(self, auth_client, first, cats):
        auth_client.put(
            f"{BUDGET}/{first['id']}/categories/{cats['Dining']['id']}",
            json={"planned_cents": 100, "note": "birthday dinner"},
            headers=HEADERS,
        )
        assert line(open_budget(auth_client, first), "Dining")["note"] == "birthday dinner"

    def test_bulk_set_is_the_undo_path(self, auth_client, first, cats):
        response = auth_client.put(
            f"{BUDGET}/{first['id']}/plan",
            json={
                "items": [
                    {"category_id": cats["Dining"]["id"], "planned_cents": 1},
                    {"category_id": cats["Rent"]["id"], "planned_cents": 2},
                ]
            },
            headers=HEADERS,
        )
        view = response.json()
        assert line(view, "Dining")["planned_cents"] == 1
        assert line(view, "Rent")["planned_cents"] == 2
        assert line(view, "Groceries")["planned_cents"] == 40_000

    def test_an_unknown_period_is_404(self, auth_client):
        response = auth_client.get(f"{BUDGET}/99999")
        assert response.status_code == 404
        assert response.json()["code"] == "pay_period_not_found"


class TestActions:
    def test_copy_last_period_overwrites_everything(self, auth_client, periods, cats):
        first, second = periods[0], periods[1]
        open_budget(auth_client, first)
        auth_client.put(
            f"{BUDGET}/{first['id']}/categories/{cats['Dining']['id']}",
            json={"planned_cents": 777},
            headers=HEADERS,
        )
        open_budget(auth_client, second)
        auth_client.put(
            f"{BUDGET}/{second['id']}/categories/{cats['Rent']['id']}",
            json={"planned_cents": 5},
            headers=HEADERS,
        )

        view = post(auth_client, f"{BUDGET}/{second['id']}/copy-previous", {})

        assert line(view, "Dining")["planned_cents"] == 777
        assert line(view, "Rent")["planned_cents"] == 120_000

    def test_copying_the_first_period_is_refused(self, auth_client, first, cats):
        response = auth_client.post(f"{BUDGET}/{first['id']}/copy-previous", headers=HEADERS)
        assert response.status_code == 422
        assert response.json()["code"] == "no_previous_period"

    def test_apply_template(self, auth_client, first, cats):
        post(auth_client, f"{BUDGET}/{first['id']}/clear", {})
        view = post(auth_client, f"{BUDGET}/{first['id']}/apply-template", {})
        assert line(view, "Groceries")["planned_cents"] == 40_000

    def test_prorate_needs_a_transition_period(self, auth_client, periods, cats):
        response = auth_client.post(f"{BUDGET}/{periods[1]['id']}/prorate", headers=HEADERS)
        assert response.status_code == 422
        assert response.json()["code"] == "not_a_transition_period"

    def test_prorate_scales_the_template_by_day_count(self, auth_client, db, periods, cats):
        # Make the second period a 6-day transition: Jan 16–21, the next starting Jan 22.
        second = db.get(PayPeriod, periods[1]["id"])
        third = db.get(PayPeriod, periods[2]["id"])
        second.end_date = date(2026, 1, 21)
        second.is_transition = True
        third.start_date = date(2026, 1, 22)
        db.commit()

        view = post(auth_client, f"{BUDGET}/{periods[1]['id']}/prorate", {})

        # Against the 14-day period before it, rounded half away from zero.
        assert line(view, "Groceries")["planned_cents"] == 17_143  # 400 × 6/14 = 171.428…
        assert line(view, "Dining")["planned_cents"] == 4_286  # 100 × 6/14 = 42.857…
        assert line(view, "Rent")["planned_cents"] == 51_429  # 1200 × 6/14 = 514.285…
        assert line(view, "Paycheck")["planned_cents"] == 107_143
        assert view["period"]["is_transition"] is True


class TestCategoryDelete:
    def test_plans_go_with_a_deleted_category(self, auth_client, db, first, cats):
        open_budget(auth_client, first)
        response = auth_client.delete(f"/api/v1/categories/{cats['Dining']['id']}", headers=HEADERS)
        assert response.status_code == 204
        left = db.scalars(
            select(PeriodPlan).where(PeriodPlan.category_id == cats["Dining"]["id"])
        ).all()
        assert left == []

    def test_reassigning_folds_the_plan_into_the_target(self, auth_client, first, checking, cats):
        open_budget(auth_client, first)
        spend(auth_client, checking, date.fromisoformat(first["start_date"]), -100, cats["Dining"])
        response = auth_client.delete(
            f"/api/v1/categories/{cats['Dining']['id']}?reassign_to={cats['Groceries']['id']}",
            headers=HEADERS,
        )
        assert response.status_code == 204
        view = open_budget(auth_client, first)
        assert line(view, "Groceries")["planned_cents"] == 50_000
        assert line(view, "Groceries")["actual_cents"] == 100


class TestDashboard:
    def test_without_a_schedule(self, auth_client, checking):
        board = auth_client.get("/api/v1/dashboard").json()
        assert board["budget"] is None
        assert board["overspent"] == []
        assert [row["account_id"] for row in board["balances"]] == [checking["id"]]

    def test_the_current_period_at_a_glance(self, auth_client, checking, cats):
        today = date.today()
        post(
            auth_client,
            "/api/v1/pay-schedule",
            {
                "frequency": "biweekly",
                "effective_from": (today - timedelta(days=3)).isoformat(),
                "anchor_date": (today - timedelta(days=3)).isoformat(),
            },
        )
        spend(auth_client, checking, today, -15_000, cats["Dining"])  # 50.00 over
        spend(auth_client, checking, today, -45_000, cats["Groceries"])  # 50.00 over
        spend(auth_client, checking, today, -120_100, cats["Rent"])  # 1.00 over

        board = auth_client.get("/api/v1/dashboard").json()

        assert board["budget"]["period"]["start_date"] == (today - timedelta(days=3)).isoformat()
        assert [row["name"] for row in board["overspent"]] == ["Dining", "Groceries", "Rent"]
        assert board["overspent"][0]["over_cents"] == 5000
        assert len(board["recent"]) == 3
        assert board["balances"][0]["current_cents"] == 500_000 - 180_100


class TestLedgerOnBudgetFilter:
    def test_it_narrows_to_budget_accounts(self, auth_client, checking, loan):
        spend(auth_client, checking, ANCHOR, -100)
        spend(auth_client, loan, ANCHOR, -200)
        on = auth_client.get(f"{TX}?on_budget=true").json()["items"]
        off = auth_client.get(f"{TX}?on_budget=false").json()["items"]
        assert [row["transaction"]["amount_cents"] for row in on] == [-100]
        assert [row["transaction"]["amount_cents"] for row in off] == [-200]
