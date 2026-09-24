"""pb run-daily and ntfy: auto-post, reminders, low balance, and sending exactly once."""

import json
import threading
from datetime import date, datetime, timedelta
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest
from sqlalchemy import func, select

from app.jobs import ntfy
from app.jobs.daily import notify_failure, run_daily
from app.models import NotificationLog, SubscriptionOccurrence, Transaction
from app.services import settings as settings_service

HEADERS = {"X-PB-Request": "1"}
TODAY = date.today()
MORNING = datetime.combine(TODAY, datetime.min.time()).replace(hour=9)
EARLY = MORNING.replace(hour=5)


def post(client, path, body=None):
    response = client.post(path, json=body or {}, headers=HEADERS)
    assert response.status_code in (200, 201), response.text
    return response.json()


@pytest.fixture
def ntfy_on(db):
    settings_service.update_settings(
        db, {"ntfy_url": "https://ntfy.example", "ntfy_topic": "payday", "reminder_hour": 7}
    )


@pytest.fixture
def refs(auth_client):
    account = post(
        auth_client,
        "/api/v1/accounts",
        {
            "name": "Checking",
            "type": "checking",
            "opening_date": "2025-01-01",
            "opening_balance_cents": 100_000,
        },
    )
    group = post(auth_client, "/api/v1/category-groups", {"name": "Bills"})
    category = post(
        auth_client, "/api/v1/categories", {"group_id": group["id"], "name": "Streaming"}
    )
    payee = post(auth_client, "/api/v1/payees", {"name": "Netflix"})
    return {"account": account, "category": category, "payee": payee}


def subscription(client, refs, **overrides):
    body = {
        "name": "Netflix",
        "payee_id": refs["payee"]["id"],
        "category_id": refs["category"]["id"],
        "account_id": refs["account"]["id"],
        "amount_cents": 1599,
        "frequency": "monthly",
        "anchor_date": TODAY.isoformat(),
        "auto_post": True,
    }
    body.update(overrides)
    return post(client, "/api/v1/subscriptions", body)


def titles(recorder):
    return [message.title for _, message in recorder.sent]


def count(db, model, *where):
    return db.scalar(select(func.count()).select_from(model).where(*where))


class TestAutoPost:
    def test_it_posts_exactly_one_transaction_and_marks_the_bill_paid(
        self, auth_client, db, refs, ntfy_on
    ):
        sub = subscription(auth_client, refs)
        recorder = ntfy.Recorder()

        first = run_daily(db, now=MORNING, sender=recorder)
        second = run_daily(db, now=MORNING, sender=recorder)

        assert first.posted == ["Netflix $15.99"]
        assert second.posted == []
        rows = db.scalars(select(Transaction)).all()
        assert len(rows) == 1
        tx = rows[0]
        assert (tx.account_id, tx.date, tx.amount_cents, tx.payee_id) == (
            refs["account"]["id"],
            TODAY,
            -1599,
            refs["payee"]["id"],
        )
        assert [split.category_id for split in tx.splits] == [refs["category"]["id"]]
        occurrence = db.scalars(
            select(SubscriptionOccurrence).where(
                SubscriptionOccurrence.subscription_id == sub["id"],
                SubscriptionOccurrence.due_date == TODAY,
            )
        ).one()
        assert occurrence.status == "paid"
        assert occurrence.transaction_id == tx.id
        assert titles(recorder) == ["Posted Netflix"]

    def test_a_payment_entered_by_hand_is_linked_not_duplicated(
        self, auth_client, db, refs, ntfy_on
    ):
        subscription(auth_client, refs)
        manual = post(
            auth_client,
            "/api/v1/transactions",
            {
                "account_id": refs["account"]["id"],
                "date": (TODAY - timedelta(days=1)).isoformat(),
                "amount_cents": -1650,
                "payee_id": refs["payee"]["id"],
            },
        )["transactions"][0]

        report = run_daily(db, now=MORNING, sender=ntfy.Recorder())

        assert report.linked == ["Netflix $15.99"] and report.posted == []
        assert count(db, Transaction) == 1
        occurrence = db.scalars(
            select(SubscriptionOccurrence).where(SubscriptionOccurrence.due_date == TODAY)
        ).one()
        assert occurrence.transaction_id == manual["id"]

    def test_without_an_account_it_asks_you_to_pay_by_hand(self, auth_client, db, refs, ntfy_on):
        subscription(auth_client, refs, account_id=None)
        recorder = ntfy.Recorder()
        run_daily(db, now=MORNING, sender=recorder)
        run_daily(db, now=MORNING, sender=recorder)
        assert count(db, Transaction) == 0
        assert titles(recorder).count("Pay Netflix by hand") == 1

    def test_remind_only_bills_are_never_posted(self, auth_client, db, refs, ntfy_on):
        subscription(auth_client, refs, auto_post=False)
        run_daily(db, now=MORNING, sender=ntfy.Recorder())
        assert count(db, Transaction) == 0

    def test_posting_does_not_wait_for_the_reminder_hour(self, auth_client, db, refs, ntfy_on):
        subscription(auth_client, refs)
        recorder = ntfy.Recorder()
        report = run_daily(db, now=EARLY, sender=recorder)
        assert report.posted == ["Netflix $15.99"]
        assert recorder.sent == []  # the message waits
        run_daily(db, now=MORNING, sender=recorder)
        assert titles(recorder) == ["Posted Netflix"]


class TestReminders:
    def test_a_bill_inside_its_lead_days_gets_one_reminder(self, auth_client, db, refs, ntfy_on):
        subscription(
            auth_client, refs, auto_post=False, anchor_date=(TODAY + timedelta(days=2)).isoformat()
        )
        subscription(
            auth_client,
            refs,
            name="Later",
            auto_post=False,
            anchor_date=(TODAY + timedelta(days=5)).isoformat(),
        )
        recorder = ntfy.Recorder()
        run_daily(db, now=MORNING, sender=recorder)
        run_daily(db, now=MORNING.replace(hour=15), sender=recorder)
        assert titles(recorder) == ["Netflix due in 2 days"]
        message = recorder.sent[0][1]
        assert "$15.99" in message.body
        assert message.click.startswith("http://localhost:8000/calendar?month=")
        assert "&bill=" in message.click

    def test_auto_post_reminders_say_so(self, auth_client, db, refs, ntfy_on):
        subscription(auth_client, refs, anchor_date=(TODAY + timedelta(days=1)).isoformat())
        recorder = ntfy.Recorder()
        run_daily(db, now=MORNING, sender=recorder)
        assert recorder.sent[0][1].body.endswith("It will be posted automatically.")

    def test_an_overdue_bill_is_announced_once(self, auth_client, db, refs, ntfy_on):
        sub = subscription(
            auth_client, refs, auto_post=False, anchor_date=(TODAY + timedelta(days=20)).isoformat()
        )
        db.add(
            SubscriptionOccurrence(
                subscription_id=sub["id"], due_date=TODAY - timedelta(days=2), amount_cents=1599
            )
        )
        db.commit()
        recorder = ntfy.Recorder()
        run_daily(db, now=MORNING, sender=recorder)
        run_daily(db, now=MORNING + timedelta(days=1), sender=recorder)
        assert titles(recorder) == ["Overdue: Netflix"]
        assert recorder.sent[0][1].priority == 4


class TestExactlyOnce:
    def test_running_twice_in_a_day_sends_nothing_new(self, auth_client, db, refs, ntfy_on):
        subscription(auth_client, refs)
        subscription(
            auth_client,
            refs,
            name="Soon",
            auto_post=False,
            anchor_date=(TODAY + timedelta(days=1)).isoformat(),
        )
        recorder = ntfy.Recorder()

        first = run_daily(db, now=MORNING, sender=recorder)
        sent_after_first = len(recorder.sent)
        second = run_daily(db, now=MORNING.replace(hour=18), sender=recorder)

        assert first.sent == sent_after_first == 2
        assert second.sent == 0 and second.skipped >= 1
        assert len(recorder.sent) == sent_after_first
        keys = db.scalars(select(NotificationLog.ref_key)).all()
        assert len(keys) == len(set(keys))

    def test_a_failed_send_is_retried_and_then_not_repeated(self, auth_client, db, refs, ntfy_on):
        subscription(
            auth_client, refs, auto_post=False, anchor_date=(TODAY + timedelta(days=1)).isoformat()
        )
        broken = ntfy.Recorder(fail_with="server said 503")
        first = run_daily(db, now=MORNING, sender=broken)
        assert first.failed == 1
        row = db.scalars(select(NotificationLog)).one()
        assert (row.success, row.error) == (False, "server said 503")

        working = ntfy.Recorder()
        assert run_daily(db, now=MORNING, sender=working).sent == 1
        assert run_daily(db, now=MORNING, sender=working).sent == 0
        assert count(db, NotificationLog) == 1

    def test_nothing_is_sent_before_the_reminder_hour(self, auth_client, db, refs, ntfy_on):
        subscription(
            auth_client, refs, auto_post=False, anchor_date=(TODAY + timedelta(days=1)).isoformat()
        )
        recorder = ntfy.Recorder()
        report = run_daily(db, now=EARLY, sender=recorder)
        assert report.before_reminder_hour and recorder.sent == []
        assert count(db, NotificationLog) == 0

    def test_without_ntfy_settings_it_still_does_the_housekeeping(self, auth_client, db, refs):
        subscription(auth_client, refs)
        recorder = ntfy.Recorder()
        report = run_daily(db, now=MORNING, sender=recorder)
        assert report.notifications_on is False
        assert report.posted == ["Netflix $15.99"]
        assert recorder.sent == []


class TestLowBalance:
    def set_threshold(self, client, refs, cents):
        response = client.patch(
            f"/api/v1/accounts/{refs['account']['id']}",
            json={"low_balance_alert_cents": cents},
            headers=HEADERS,
        )
        assert response.status_code == 200, response.text

    def spend(self, client, refs, cents):
        post(
            client,
            "/api/v1/transactions",
            {"account_id": refs["account"]["id"], "date": TODAY.isoformat(), "amount_cents": cents},
        )

    def test_one_alert_per_dip(self, auth_client, db, refs, ntfy_on):
        self.set_threshold(auth_client, refs, 50_000)
        recorder = ntfy.Recorder()

        run_daily(db, now=MORNING, sender=recorder)  # 1000.00, above the 500.00 threshold
        assert recorder.sent == []

        self.spend(auth_client, refs, -60_000)  # 400.00
        run_daily(db, now=MORNING, sender=recorder)
        run_daily(db, now=MORNING + timedelta(days=1), sender=recorder)  # still low: quiet
        assert titles(recorder) == ["Checking is low"]
        assert "$400.00" in recorder.sent[0][1].body

        self.spend(auth_client, refs, 30_000)  # 700.00: recovered
        run_daily(db, now=MORNING + timedelta(days=2), sender=recorder)
        self.spend(auth_client, refs, -30_000)  # 400.00 again: a new dip
        run_daily(db, now=MORNING + timedelta(days=3), sender=recorder)
        assert titles(recorder) == ["Checking is low", "Checking is low"]

    def test_closed_accounts_and_accounts_without_a_threshold_are_quiet(
        self, auth_client, db, refs, ntfy_on
    ):
        self.spend(auth_client, refs, -200_000)
        recorder = ntfy.Recorder()
        run_daily(db, now=MORNING, sender=recorder)
        assert recorder.sent == []


class TestFailureAlert:
    def test_once_a_day_per_unit(self, db, ntfy_on):
        recorder = ntfy.Recorder()
        notify_failure(db, "payday-budget-backup.service", now=MORNING, sender=recorder)
        notify_failure(
            db, "payday-budget-backup.service", now=MORNING.replace(hour=11), sender=recorder
        )
        notify_failure(
            db, "payday-budget-backup.service", now=MORNING + timedelta(days=1), sender=recorder
        )
        assert titles(recorder) == ["payday-budget-backup failed", "payday-budget-backup failed"]
        assert recorder.sent[0][1].priority == 5


class TestApi:
    def test_the_token_is_write_only(self, auth_client):
        auth_client.patch("/api/v1/settings", json={"ntfy_token": "tk_secret"}, headers=HEADERS)
        body = auth_client.get("/api/v1/settings").json()
        assert body["ntfy_token_set"] is True
        assert "tk_secret" not in json.dumps(body)
        auth_client.patch("/api/v1/settings", json={"ntfy_token": ""}, headers=HEADERS)
        assert auth_client.get("/api/v1/settings").json()["ntfy_token_set"] is False

    def test_send_test_needs_settings(self, auth_client):
        response = auth_client.post("/api/v1/notifications/test", headers=HEADERS)
        assert response.status_code == 422
        assert response.json()["code"] == "ntfy_not_configured"

    def test_send_test_and_the_log(self, auth_client, monkeypatch, ntfy_on):
        recorder = ntfy.Recorder()
        monkeypatch.setattr(ntfy, "send", recorder)
        response = auth_client.post("/api/v1/notifications/test", headers=HEADERS)
        assert response.json() == {"success": True, "error": None}
        assert titles(recorder) == ["Payday Budget test"]
        log = auth_client.get("/api/v1/notifications").json()["items"]
        assert [(row["kind"], row["success"]) for row in log] == [("test", True)]

    def test_a_failed_test_says_why(self, auth_client, monkeypatch, ntfy_on):
        monkeypatch.setattr(
            ntfy, "send", ntfy.Recorder(fail_with="ntfy answered 401: unauthorized")
        )
        response = auth_client.post("/api/v1/notifications/test", headers=HEADERS)
        assert response.json() == {"success": False, "error": "ntfy answered 401: unauthorized"}


class TestClient:
    def test_it_publishes_json_with_a_bearer_token(self):
        received = {}

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):  # noqa: N802 - the http.server API
                length = int(self.headers["Content-Length"])
                received["body"] = json.loads(self.rfile.read(length))
                received["auth"] = self.headers.get("Authorization")
                self.send_response(200)
                self.end_headers()

            def log_message(self, *args):
                pass

        server = HTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.handle_request, daemon=True)
        thread.start()
        target = ntfy.Target(
            url=f"http://127.0.0.1:{server.server_port}/", topic="payday", token="tk"
        )
        ntfy.send(
            target,
            ntfy.Message(
                title="Netflix due today ✓",
                body="$15.99",
                priority=4,
                tags=("calendar",),
                click="http://x/y",
            ),
        )
        thread.join(timeout=5)
        server.server_close()

        assert received["auth"] == "Bearer tk"
        assert received["body"] == {
            "topic": "payday",
            "title": "Netflix due today ✓",
            "message": "$15.99",
            "priority": 4,
            "tags": ["calendar"],
            "click": "http://x/y",
        }

    def test_an_unreachable_server_is_a_send_error(self):
        with pytest.raises(ntfy.SendError, match="could not reach"):
            ntfy.send(ntfy.Target(url="http://127.0.0.1:9/", topic="t"), ntfy.Message("a", "b"))
