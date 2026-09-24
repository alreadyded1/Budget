"""Reports (SPEC §16): totals tie to the ledger, transfers drop out, filters and drill-down.

September 2026 on the on-budget accounts:
    payroll                   +2,500.00  Salary (income)
    Kroger                       -45.20  Groceries
    Kroger refund                 +5.00  Groceries
    Target (split)              -100.00  Groceries -60.00 / Fuel -40.00
    unknown charge               -12.34  uncategorized
    unknown deposit               +7.00  uncategorized
    checking → savings           200.00  both on-budget: no category, drops out
    checking → car loan          300.00  tracking account: the checking leg is Car payment
Spending 452.54, income 2,507.00, net 2,054.46.
"""

from datetime import date

import pytest

HEADERS = {"X-PB-Request": "1"}
R = "/api/v1/reports"
SEPT = "from=2026-09-01&to=2026-09-30"


def post(client, path, body):
    response = client.post(path, json=body, headers=HEADERS)
    assert response.status_code in (200, 201), response.text
    return response.json()


def get(client, path):
    response = client.get(path)
    assert response.status_code == 200, response.text
    return response.json()


@pytest.fixture
def book(auth_client):
    c = auth_client
    checking = post(
        c,
        "/api/v1/accounts",
        {"name": "Checking", "type": "checking", "opening_date": "2026-01-01"},
    )
    savings = post(
        c, "/api/v1/accounts", {"name": "Savings", "type": "savings", "opening_date": "2026-01-01"}
    )
    loan = post(
        c,
        "/api/v1/accounts",
        {"name": "Car loan", "type": "loan", "opening_date": "2026-01-01", "on_budget": False},
    )
    income = post(c, "/api/v1/category-groups", {"name": "Income", "kind": "income"})
    living = post(c, "/api/v1/category-groups", {"name": "Living", "kind": "expense"})
    cat = {
        name: post(c, "/api/v1/categories", {"group_id": group["id"], "name": name})
        for name, group in (
            ("Salary", income),
            ("Groceries", living),
            ("Fuel", living),
            ("Car payment", living),
        )
    }
    payee = {
        name: post(c, "/api/v1/payees", {"name": name}) for name in ("ACME", "Kroger", "Target")
    }

    def tx(on, cents, category=None, who=None, splits=None, account=checking):
        body = {"account_id": account["id"], "date": on, "amount_cents": cents}
        if who:
            body["payee_id"] = payee[who]["id"]
        if splits:
            body["splits"] = [
                {"amount_cents": amount, "category_id": cat[name]["id"]} for name, amount in splits
            ]
        elif category:
            body["splits"] = [{"amount_cents": cents, "category_id": cat[category]["id"]}]
        return post(c, "/api/v1/transactions", body)["transactions"][0]

    tx("2026-09-01", 250_000, "Salary", "ACME")
    tx("2026-09-02", -4_520, "Groceries", "Kroger")
    tx("2026-09-03", 500, "Groceries", "Kroger")
    tx("2026-09-04", -10_000, who="Target", splits=[("Groceries", -6_000), ("Fuel", -4_000)])
    tx("2026-09-05", -1_234)
    tx("2026-09-06", 700)
    post(
        c,
        "/api/v1/transfers",
        {
            "from_account_id": checking["id"],
            "to_account_id": savings["id"],
            "date": "2026-09-07",
            "amount_cents": 20_000,
        },
    )
    post(
        c,
        "/api/v1/transfers",
        {
            "from_account_id": checking["id"],
            "to_account_id": loan["id"],
            "date": "2026-09-08",
            "amount_cents": 30_000,
            "category_id": cat["Car payment"]["id"],
        },
    )
    # Outside the range.
    tx("2026-08-20", -1_000, "Groceries", "Kroger")
    tx("2026-10-02", -2_000, "Groceries", "Kroger")
    return {"checking": checking, "savings": savings, "loan": loan, "cat": cat, "payee": payee}


def ledger_net(client, accounts, start="2026-09-01", end="2026-09-30"):
    """The on-budget ledger total, read the way the Transactions page reads it."""
    total = 0
    for account in accounts:
        rows = get(client, f"/api/v1/transactions?account_id={account['id']}&from={start}&to={end}")
        total += sum(row["transaction"]["amount_cents"] for row in rows["items"])
    return total


class TestTiesToTheLedger:
    def test_income_minus_spending_is_the_ledger_net(self, auth_client, book):
        body = get(auth_client, f"{R}/income-vs-expense?{SEPT}")
        total = body["total"]
        assert total == {
            "income_cents": 250_700,
            "spending_cents": 45_254,
            "net_cents": 205_446,
            "savings_rate_bp": 8_195,
        }
        assert total["net_cents"] == ledger_net(auth_client, [book["checking"], book["savings"]])

    def test_spending_by_category_adds_up_and_excludes_transfers(self, auth_client, book):
        body = get(auth_client, f"{R}/spending-by-category?{SEPT}")
        rows = {row["name"]: row for row in body["items"]}
        assert {name: row["total_cents"] for name, row in rows.items()} == {
            "Car payment": 30_000,
            "Groceries": 10_020,
            "Fuel": 4_000,
            "Uncategorized": 1_234,
        }
        assert body["total_cents"] == 45_254
        assert rows["Groceries"]["share_bp"] == 2_214  # 10,020 / 45,254
        assert abs(sum(row["share_bp"] for row in body["items"]) - 10_000) <= 2
        assert list(rows) == ["Car payment", "Groceries", "Fuel", "Uncategorized"]

    def test_a_category_drills_down_to_exactly_its_total(self, auth_client, book):
        groceries = book["cat"]["Groceries"]["id"]
        body = get(auth_client, f"{R}/transactions?{SEPT}&category_id={groceries}&on_budget=true")
        assert body["total_cents"] == -10_020
        # The Target split counts only its grocery part.
        assert [row["amount_cents"] for row in body["items"]] == [-4_520, 500, -6_000]
        assert body["items"][-1]["transaction"]["amount_cents"] == -10_000
        assert [row["running_cents"] for row in body["items"]] == [-4_520, -4_020, -10_020]

    def test_uncategorized_spending_drills_down_to_the_outflows(self, auth_client, book):
        body = get(
            auth_client, f"{R}/transactions?{SEPT}&uncategorized=true&on_budget=true&flow=out"
        )
        assert body["total_cents"] == -1_234

    def test_spending_by_payee(self, auth_client, book):
        body = get(auth_client, f"{R}/spending-by-payee?{SEPT}")
        rows = {row["name"]: (row["total_cents"], row["count"]) for row in body["items"]}
        assert rows == {"(no payee)": (31_234, 2), "Target": (10_000, 1), "Kroger": (4_020, 2)}
        assert body["total_cents"] == 45_254


class TestFilters:
    def test_account_and_payee_filters(self, auth_client, book):
        savings = get(
            auth_client, f"{R}/income-vs-expense?{SEPT}&account_id={book['savings']['id']}"
        )
        assert savings["total"]["net_cents"] == 0
        kroger = book["payee"]["Kroger"]["id"]
        body = get(auth_client, f"{R}/spending-by-category?{SEPT}&payee_id={kroger}")
        assert body["total_cents"] == 4_020

    def test_category_filter_takes_several(self, auth_client, book):
        ids = [book["cat"]["Fuel"]["id"], book["cat"]["Car payment"]["id"]]
        body = get(
            auth_client,
            f"{R}/spending-by-category?{SEPT}&category_id={ids[0]}&category_id={ids[1]}",
        )
        assert body["total_cents"] == 34_000

    def test_the_transaction_list_covers_every_account_by_default(self, auth_client, book):
        everything = get(auth_client, f"{R}/transactions?{SEPT}")
        on_budget = get(auth_client, f"{R}/transactions?{SEPT}&on_budget=true")
        # The loan's leg of the payment is the only off-budget row.
        assert len(everything["items"]) == len(on_budget["items"]) + 1
        assert everything["total_cents"] == on_budget["total_cents"] + 30_000


class TestBuckets:
    def test_by_month_clips_to_the_range(self, auth_client, book):
        body = get(auth_client, f"{R}/income-vs-expense?from=2026-08-15&to=2026-10-31")
        assert [(b["label"], b["start"], b["spending_cents"]) for b in body["buckets"]] == [
            ("Aug 2026", "2026-08-15", 1_000),
            ("Sep 2026", "2026-09-01", 45_254),
            ("Oct 2026", "2026-10-01", 2_000),
        ]
        assert body["buckets"][2]["savings_rate_bp"] is None

    def test_by_period_adds_up_to_the_total(self, auth_client, book):
        post(
            auth_client,
            "/api/v1/pay-schedule",
            {"frequency": "biweekly", "effective_from": "2026-08-28", "anchor_date": "2026-08-28"},
        )
        body = get(auth_client, f"{R}/income-vs-expense?{SEPT}&by=period")
        assert [b["start"] for b in body["buckets"]] == ["2026-08-28", "2026-09-11", "2026-09-25"]
        assert sum(b["net_cents"] for b in body["buckets"]) == body["total"]["net_cents"]

    def test_category_trend_by_month(self, auth_client, book):
        groceries = book["cat"]["Groceries"]["id"]
        salary = book["cat"]["Salary"]["id"]
        body = get(
            auth_client,
            f"{R}/category-trend?from=2026-08-01&to=2026-10-31&category_id={groceries}&category_id={salary}",
        )
        series = {s["name"]: s["values"] for s in body["series"]}
        assert series == {"Groceries": [1_000, 10_020, 2_000], "Salary": [0, 250_000, 0]}

    def test_category_trend_needs_a_category(self, auth_client, book):
        response = auth_client.get(f"{R}/category-trend?{SEPT}")
        assert response.status_code == 422
        assert response.json()["code"] == "categories_required"


class TestPlannedVsActual:
    def test_whole_periods_with_the_planners_numbers(self, auth_client, book):
        post(
            auth_client,
            "/api/v1/pay-schedule",
            {"frequency": "biweekly", "effective_from": "2026-08-28", "anchor_date": "2026-08-28"},
        )
        periods = get(auth_client, "/api/v1/pay-periods?from=2026-09-01&to=2026-09-30")["items"]
        groceries = book["cat"]["Groceries"]["id"]
        response = auth_client.put(
            f"/api/v1/budget/{periods[0]['id']}/categories/{groceries}",
            json={"planned_cents": 12_000},
            headers=HEADERS,
        )
        assert response.status_code == 200

        body = get(auth_client, f"{R}/planned-vs-actual?from=2026-09-10&to=2026-09-12")

        # Sep 10 and Sep 12 touch two periods; both are taken whole.
        assert [(p["start"], p["end"]) for p in body["periods"]] == [
            ("2026-08-28", "2026-09-10"),
            ("2026-09-11", "2026-09-24"),
        ]
        first = body["periods"][0]
        assert first["planned_expense_cents"] == 12_000
        assert first["actual_expense_cents"] == 44_020  # every September expense so far
        rows = {row["name"]: row for row in body["categories"]}
        assert rows["Groceries"]["variance_cents"] == 12_000 - 10_020
        assert rows["Salary"]["kind"] == "income"


class TestRangesAndSubscriptions:
    def test_presets(self, auth_client):
        this_year = date.today().year
        assert get(auth_client, f"{R}/range?preset=last_year") == {
            "start": f"{this_year - 1}-01-01",
            "end": f"{this_year - 1}-12-31",
        }
        missing = auth_client.get(f"{R}/range?preset=this_period")
        assert missing.status_code == 422
        assert auth_client.get(f"{R}/range").json()["code"] == "range_required"
        bad = auth_client.get(f"{R}/range?from=2026-09-30&to=2026-09-01")
        assert bad.json()["code"] == "range_invalid"

    def test_subscription_costs_by_category(self, auth_client, book):
        fuel = book["cat"]["Fuel"]["id"]
        for name, cents, frequency in (("Stream", 1_599, "monthly"), ("Club", 12_000, "annual")):
            post(
                auth_client,
                "/api/v1/subscriptions",
                {
                    "name": name,
                    "amount_cents": cents,
                    "frequency": frequency,
                    "anchor_date": "2026-09-15",
                    "category_id": fuel,
                },
            )
        body = get(auth_client, f"{R}/subscriptions")
        assert body["items"] == [
            {
                "category_id": fuel,
                "name": "Fuel",
                "monthly_cents": 2_599,
                "annual_cents": 31_188,
                "count": 2,
            }
        ]
        assert body["monthly_cents"] == 2_599
