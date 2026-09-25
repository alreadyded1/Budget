"""`pb seed-demo` (D-109) and the grouped queries it was built to measure (D-111)."""

import re
from collections import defaultdict
from datetime import date, timedelta

import pytest
from sqlalchemy import func, select
from typer.testing import CliRunner

from app.cli import app as cli
from app.db import SessionLocal
from app.models import Account, Base, Payee, Reconciliation, Transaction, TransactionSplit
from app.services import balances, payees, reports
from app.services.demo import seed_demo

TODAY = date(2026, 9, 25)
PASSWORD = "demo-password-123"


@pytest.fixture
def demo(db):
    return seed_demo(db, transactions=3000, years=1, today=TODAY, seed=7, password=PASSWORD)


def fingerprint(db) -> list[tuple]:
    return list(
        db.execute(
            select(
                Account.name,
                Transaction.date,
                Transaction.amount_cents,
                Payee.name,
                Transaction.status,
                Transaction.memo,
            )
            .join(Account, Account.id == Transaction.account_id)
            .outerjoin(Payee, Payee.id == Transaction.payee_id)
            .order_by(Transaction.date, Transaction.id)
        )
    )


class TestSeedDemo:
    def test_it_builds_a_consistent_household(self, db, demo):
        assert 2900 <= demo.transactions <= 3100
        assert demo.accounts == 7 and demo.payees > 400
        assert demo.first_date >= TODAY - timedelta(days=365) and demo.last_date <= TODAY

        splits = defaultdict(list)
        for tx_id, category_id, amount in db.execute(
            select(
                TransactionSplit.transaction_id,
                TransactionSplit.category_id,
                TransactionSplit.amount_cents,
            )
        ):
            splits[tx_id].append((category_id, amount))
        on_budget = {a.id: a.on_budget for a in db.scalars(select(Account))}
        legs = defaultdict(list)
        for tx in db.scalars(select(Transaction)):
            if tx.transfer_id:
                legs[tx.transfer_id].append(tx)
            else:
                # Every ordinary transaction is fully categorised, with splits that add up.
                assert sum(amount for _, amount in splits[tx.id]) == tx.amount_cents
                assert all(category is not None for category, _ in splits[tx.id])
            if tx.status == "reconciled":
                assert tx.reconciliation_id is not None
            else:
                assert tx.reconciliation_id is None
        for pair in legs.values():
            assert len(pair) == 2 and sum(t.amount_cents for t in pair) == 0
            out_leg = min(pair, key=lambda t: t.amount_cents)
            in_leg = max(pair, key=lambda t: t.amount_cents)
            # SPEC §6: only money leaving the budget carries a category.
            needs_split = on_budget[out_leg.account_id] and not on_budget[in_leg.account_id]
            assert bool(splits[out_leg.id]) == needs_split
            assert not splits[in_leg.id]

        # Every statement matches the ledger on its date.
        for record in db.scalars(select(Reconciliation)):
            account = db.get(Account, record.account_id)
            on = record.statement_date
            assert balances.balance_as_of(db, account, on) == record.statement_balance_cents

    def test_the_demo_login_works(self, client, demo):
        response = client.post(
            "/api/v1/auth/login",
            json={"username": "demo", "password": PASSWORD},
            headers={"X-PB-Request": "1"},
        )
        assert response.status_code == 200, response.text
        assert client.get("/api/v1/balances").status_code == 200

    def test_the_same_seed_builds_the_same_data(self, db, demo):
        first = fingerprint(db)
        db.close()
        with SessionLocal() as session:
            for table in reversed(Base.metadata.sorted_tables):
                session.execute(table.delete())
            session.commit()
        seed_demo(db, transactions=3000, years=1, today=TODAY, seed=7, password=PASSWORD)
        assert fingerprint(db) == first

    def test_it_refuses_a_database_with_accounts(self, db, demo):
        with pytest.raises(Exception, match="empty database"):
            seed_demo(db, transactions=3000, years=1, today=TODAY)

    def test_the_cli(self, db):
        result = CliRunner().invoke(cli, ["seed-demo", "--transactions", "2000", "--years", "1"])
        assert result.exit_code == 0, result.output
        assert re.search(r"Made [\d,]+ transactions", result.output), result.output
        assert "Sign in as demo / " in result.output
        again = CliRunner().invoke(cli, ["seed-demo", "--transactions", "2000", "--years", "1"])
        assert again.exit_code == 1
        assert "empty database" in again.output


class TestGroupedQueries:
    """The grouped queries give exactly what the one-at-a-time ones did."""

    def test_balances_for_many_matches_single_sums(self, db, demo):
        accounts = list(db.scalars(select(Account)))
        many = balances.balances_for_many(db, accounts)
        for account in accounts:
            if account.valuation_mode == "manual":
                latest = balances.latest_valuation(db, account.id)
                assert many[account.id].current_cents == latest.balance_cents
                continue

            def total(*statuses, account=account):
                query = select(func.coalesce(func.sum(Transaction.amount_cents), 0)).where(
                    Transaction.account_id == account.id
                )
                if statuses:
                    query = query.where(Transaction.status.in_(statuses))
                return account.opening_balance_cents + db.scalar(query)

            assert many[account.id].current_cents == total()
            assert many[account.id].cleared_cents == total("cleared", "reconciled")
            assert many[account.id].reconciled_cents == total("reconciled")

    def test_balances_as_of_many_matches_balance_as_of(self, db, demo):
        accounts = list(db.scalars(select(Account)))
        # Before opening, month-ends, a valuation day and today.
        dates = [demo.first_date - timedelta(days=10), TODAY]
        dates += [date(2026, month, 1) - timedelta(days=1) for month in range(1, 10)]
        dates += [date(2025, 11, 30), TODAY - timedelta(days=365) + timedelta(days=365)]
        dates = sorted(set(dates))
        many = balances.balances_as_of_many(db, accounts, dates)
        for account in accounts:
            expected = [balances.balance_as_of(db, account, on) for on in dates]
            assert many[account.id] == expected, account.name

    def test_payee_usage_for_many_matches_one_at_a_time(self, db, demo):
        ids = list(db.scalars(select(Payee.id)))
        assert len(ids) > 50  # the whole-table path
        many = payees.usage_for_many(db, ids)
        one_by_one = {payee_id: payees.usage_for(db, payee_id) for payee_id in ids}
        assert many == one_by_one
        used = [usage for usage in many.values() if usage.transaction_count]
        assert used and all(u.last_used and u.last_amount_cents is not None for u in used)

    def test_report_counts_are_split_counts(self, db, demo):
        filters = reports.Filters(
            start=TODAY - timedelta(days=400),
            end=TODAY,
            account_ids=(),
            category_ids=(),
            payee_ids=(),
            uncategorized=False,
        )
        rows, grand = reports.spending_by_category(db, filters)
        expense_splits = db.scalar(
            select(func.count())
            .select_from(TransactionSplit)
            .join(Transaction, Transaction.id == TransactionSplit.transaction_id)
            .join(Account, Account.id == Transaction.account_id)
            .where(Account.on_budget.is_(True), TransactionSplit.amount_cents < 0)
        )
        assert sum(row.count for row in rows) == expense_splits
        assert grand == sum(row.total_cents for row in rows)
