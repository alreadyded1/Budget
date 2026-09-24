"""Net worth history and the debt payoff planner (SPEC §14) through the API."""

from datetime import date, timedelta

from app.domain.net_worth import month_ends
from app.models import Account

HEADERS = {"X-PB-Request": "1"}
TODAY = date.today()
P = month_ends(TODAY, 6)  # P[0] … P[4] are month-ends, P[5] is today


def post(client, path, body):
    response = client.post(path, json=body, headers=HEADERS)
    assert response.status_code in (200, 201), response.text
    return response.json()


def account(client, name, kind, opened, opening=0, **extra):
    return post(
        client,
        "/api/v1/accounts",
        {
            "name": name,
            "type": kind,
            "opening_date": opened.isoformat(),
            "opening_balance_cents": opening,
            **extra,
        },
    )


def spend(client, acct, cents, on):
    post(
        client,
        "/api/v1/transactions",
        {"account_id": acct["id"], "date": on.isoformat(), "amount_cents": cents},
    )


class TestNetWorthHistory:
    def test_accounts_opened_and_closed_mid_range(self, auth_client, db):
        c = auth_client
        checking = account(c, "Checking", "checking", P[1], 100_000)
        spend(c, checking, -5_000, P[3])
        savings = account(c, "Old savings", "savings", P[0] - timedelta(days=10), 50_000)
        card = account(c, "Visa", "credit_card", P[2])
        spend(c, card, -20_000, P[4])
        house = account(
            c, "Brokerage", "investment", P[0] - timedelta(days=30), valuation_mode="manual"
        )
        for on, cents in ((P[1], 300_000), (P[4], 320_000)):
            post(
                c,
                f"/api/v1/accounts/{house['id']}/valuations",
                {"date": on.isoformat(), "balance_cents": cents},
            )
        # Closed the day after P[2]: it counts through P[2], not after.
        post(c, f"/api/v1/accounts/{savings['id']}/close", {})
        row = db.get(Account, savings["id"])
        row.closed_on = P[2] + timedelta(days=1)
        db.commit()

        body = c.get("/api/v1/net-worth?months=6").json()

        assert [p["date"] for p in body["history"]] == [p.isoformat() for p in P]
        assert [p["net_cents"] for p in body["history"]] == [
            50_000,  # savings only (checking opens at P1, the valuation at P1)
            450_000,  # checking 100,000 + savings 50,000 + brokerage 300,000
            450_000,  # the card is open but owes nothing yet
            395_000,  # savings closed; checking 95,000 + brokerage 300,000
            395_000,  # brokerage 320,000, card owes 20,000
            395_000,
        ]
        assert body["history"][4]["liabilities_cents"] == -20_000
        assert body["today"] == {
            "date": TODAY.isoformat(),
            "assets_cents": 415_000,
            "liabilities_cents": -20_000,
            "net_cents": 395_000,
        }
        assert [(r["label"], r["balance_cents"]) for r in body["breakdown"]] == [
            ("Checking", 95_000),
            ("Investments", 320_000),
            ("Credit cards", -20_000),
        ]

    def test_closing_records_the_day_and_reopening_clears_it(self, auth_client):
        c = auth_client
        acct = account(c, "Spare", "checking", TODAY - timedelta(days=40))
        closed = post(c, f"/api/v1/accounts/{acct['id']}/close", {})
        assert closed["closed_on"] == TODAY.isoformat()
        reopened = post(c, f"/api/v1/accounts/{acct['id']}/reopen", {})
        assert reopened["closed_on"] is None

    def test_all_time_reaches_back_to_the_first_account(self, auth_client):
        account(auth_client, "Old", "checking", TODAY.replace(day=1) - timedelta(days=100), 1_000)
        body = auth_client.get("/api/v1/net-worth?all=true").json()
        assert len(body["history"]) in (4, 5)
        assert body["history"][-1]["net_cents"] == 1_000

    def test_valuations_can_be_deleted(self, auth_client):
        c = auth_client
        house = account(
            c, "House", "other_asset", TODAY - timedelta(days=90), valuation_mode="manual"
        )
        value = post(
            c,
            f"/api/v1/accounts/{house['id']}/valuations",
            {"date": TODAY.isoformat(), "balance_cents": 25_000_000},
        )
        assert c.get("/api/v1/net-worth?months=1").json()["today"]["net_cents"] == 25_000_000
        gone = c.delete(f"/api/v1/accounts/{house['id']}/valuations/{value['id']}", headers=HEADERS)
        assert gone.status_code == 204
        assert c.get("/api/v1/net-worth?months=1").json()["today"]["net_cents"] == 0


class TestDebtPlan:
    def setup_debts(self, c):
        opened = TODAY - timedelta(days=60)
        visa = account(
            c, "Visa", "credit_card", opened, -250_000, apr_bps=2_499, min_payment_cents=7_500
        )
        store = account(
            c, "Store card", "credit_card", opened, -60_000, apr_bps=1_999, min_payment_cents=2_500
        )
        car = account(c, "Car", "loan", opened, -900_000, min_payment_cents=30_000)
        account(c, "Paid card", "credit_card", opened, 0, apr_bps=1_500, min_payment_cents=2_500)
        return visa, store, car

    def test_debts_and_what_is_missing(self, auth_client):
        visa, store, car = self.setup_debts(auth_client)
        body = auth_client.get("/api/v1/debt-plan").json()
        assert body["strategy"] == "avalanche"
        assert body["extra_monthly_cents"] == 0
        assert [d["account_id"] for d in body["debts"]] == [visa["id"], store["id"]]
        assert body["debts"][0]["owed_cents"] == 250_000
        assert body["skipped"] == [
            {
                "account_id": car["id"],
                "name": "Car",
                "owed_cents": 900_000,
                "apr_bps": None,
                "min_payment_cents": 30_000,
                "reason": "needs its APR",
            }
        ]

    def test_strategies_side_by_side(self, auth_client):
        c = auth_client
        visa, store, _ = self.setup_debts(c)
        saved = c.put(
            "/api/v1/debt-plan",
            json={
                "strategy": "snowball",
                "extra_monthly_cents": 20_000,
                "custom_order": [visa["id"]],
            },
            headers=HEADERS,
        ).json()
        assert saved["strategy"] == "snowball"

        body = c.get("/api/v1/debt-plan/simulation").json()

        strategies = {s["strategy"]: s for s in body["strategies"]}
        assert set(strategies) == {"snowball", "avalanche", "custom"}
        assert strategies["snowball"]["order"] == [store["id"], visa["id"]]
        assert strategies["avalanche"]["order"] == [visa["id"], store["id"]]
        # Custom lists Visa first, the same order as avalanche here.
        assert (
            strategies["custom"]["total_interest_cents"]
            == strategies["avalanche"]["total_interest_cents"]
        )
        assert (
            strategies["avalanche"]["total_interest_cents"]
            <= strategies["snowball"]["total_interest_cents"]
        )
        for s in strategies.values():
            assert s["finished"]
            assert s["total_paid_cents"] == 310_000 + s["total_interest_cents"]
            assert s["debt_free"] == body["schedule"][-1]["month"] or s["strategy"] != "snowball"
        assert body["schedule_strategy"] == "snowball"
        first = body["schedule"][0]
        next_month = (TODAY.replace(day=28) + timedelta(days=4)).strftime("%Y-%m")
        assert first["month"] == next_month
        # Snowball: minimums 7,500 + 2,500, the 20,000 extra to the store card.
        payments = {line["account_id"]: line["payment_cents"] for line in first["lines"]}
        assert payments == {store["id"]: 22_500, visa["id"]: 7_500}

    def test_trying_an_extra_does_not_save_it(self, auth_client):
        c = auth_client
        self.setup_debts(c)
        more = c.get("/api/v1/debt-plan/simulation?extra_cents=50000&strategy=avalanche").json()
        less = c.get("/api/v1/debt-plan/simulation").json()
        assert more["extra_monthly_cents"] == 50_000
        assert less["extra_monthly_cents"] == 0
        assert len(more["schedule"]) < len(less["schedule"])
        assert c.get("/api/v1/debt-plan").json()["extra_monthly_cents"] == 0

    def test_no_debts(self, auth_client):
        body = auth_client.get("/api/v1/debt-plan/simulation").json()
        assert body["schedule"] == []
        assert all(s["months"] == 0 and s["finished"] for s in body["strategies"])

    def test_bad_input(self, auth_client):
        bad = auth_client.put(
            "/api/v1/debt-plan", json={"extra_monthly_cents": -1}, headers=HEADERS
        )
        assert bad.status_code == 422

    def test_trying_a_custom_order_does_not_save_it(self, auth_client):
        c = auth_client
        visa, store, _ = self.setup_debts(c)
        body = c.get(
            f"/api/v1/debt-plan/simulation?strategy=custom&order={store['id']}&order={visa['id']}"
        ).json()
        custom = next(s for s in body["strategies"] if s["strategy"] == "custom")
        assert custom["order"] == [store["id"], visa["id"]]
        assert body["schedule_strategy"] == "custom"
        assert c.get("/api/v1/debt-plan").json()["custom_order"] == []
