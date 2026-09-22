"""Pay schedule endpoints and the timeline they maintain."""

from datetime import date, timedelta

from sqlalchemy import select

from app.models import PayPeriod, PaySchedule
from app.services import pay_schedule as service

HEADERS = {"X-PB-Request": "1"}
SCHEDULE = "/api/v1/pay-schedule"
PERIODS = "/api/v1/pay-periods"


def semimonthly_payload(effective_from: date, **overrides) -> dict:
    payload = {
        "frequency": "semimonthly",
        "effective_from": effective_from.isoformat(),
        "day_of_month_1": 15,
        "day_of_month_2": 31,
        "weekend_rule": "none",
    }
    payload.update(overrides)
    return payload


def test_no_schedule_yet(auth_client):
    response = auth_client.get(SCHEDULE)

    assert response.status_code == 200
    assert response.json() == {"current": None, "history": []}


def test_current_period_without_a_schedule_is_404(auth_client):
    response = auth_client.get(f"{PERIODS}/current")

    assert response.status_code == 404
    assert response.json()["code"] == "no_pay_schedule"


def test_preview_writes_nothing(auth_client, db):
    effective = date.today() + timedelta(days=3)
    response = auth_client.post(
        f"{SCHEDULE}/preview", json=semimonthly_payload(effective), headers=HEADERS
    )

    assert response.status_code == 200
    body = response.json()
    assert len(body["periods"]) == 6
    assert body["transition"] is None
    assert db.scalars(select(PaySchedule)).first() is None
    assert db.scalars(select(PayPeriod)).first() is None


def test_preview_rejects_an_impossible_schedule(auth_client):
    response = auth_client.post(
        f"{SCHEDULE}/preview",
        json={
            "frequency": "semimonthly",
            "effective_from": date.today().isoformat(),
            "day_of_month_1": 15,
            "day_of_month_2": 15,
        },
        headers=HEADERS,
    )

    assert response.status_code == 422
    assert response.json()["code"] == "invalid_schedule"


def test_commit_creates_a_contiguous_timeline(auth_client, db):
    effective = date.today() - timedelta(days=0)
    response = auth_client.post(SCHEDULE, json=semimonthly_payload(effective), headers=HEADERS)

    assert response.status_code == 201

    periods = list(db.scalars(select(PayPeriod).order_by(PayPeriod.start_date)))
    assert len(periods) > 20
    for previous, following in zip(periods, periods[1:], strict=False):
        assert following.start_date == previous.end_date + timedelta(days=1)


def test_the_timeline_reaches_about_13_months_ahead(auth_client, db):
    auth_client.post(SCHEDULE, json=semimonthly_payload(date.today()), headers=HEADERS)

    last = db.scalars(select(PayPeriod).order_by(PayPeriod.end_date.desc())).first()
    assert last is not None
    assert last.end_date >= date.today() + timedelta(days=380)


def test_current_period_contains_today(auth_client):
    auth_client.post(
        SCHEDULE,
        json=semimonthly_payload(date.today() - timedelta(days=40)),
        headers=HEADERS,
    )

    response = auth_client.get(f"{PERIODS}/current")

    assert response.status_code == 200
    body = response.json()
    assert date.fromisoformat(body["start_date"]) <= date.today()
    assert date.fromisoformat(body["end_date"]) >= date.today()
    assert body["days"] >= 1


def test_listing_periods_by_range(auth_client):
    auth_client.post(
        SCHEDULE, json=semimonthly_payload(date.today() - timedelta(days=60)), headers=HEADERS
    )

    start = date.today()
    end = date.today() + timedelta(days=45)
    response = auth_client.get(f"{PERIODS}?from={start}&to={end}")

    assert response.status_code == 200
    items = response.json()["items"]
    assert items
    for item in items:
        assert date.fromisoformat(item["end_date"]) >= start
        assert date.fromisoformat(item["start_date"]) <= end


def test_a_mid_period_change_flags_a_transition_and_stays_contiguous(auth_client, db):
    # A monthly schedule that started well before today.
    first_effective = date.today().replace(day=1) - timedelta(days=90)
    auth_client.post(
        SCHEDULE,
        json={
            "frequency": "monthly",
            "effective_from": first_effective.isoformat(),
            "day_of_month_1": 1,
        },
        headers=HEADERS,
    )

    open_period = service.period_containing(db, date.today())
    assert open_period is not None
    change_date = open_period.start_date + timedelta(days=5)

    response = auth_client.post(
        SCHEDULE,
        json={
            "frequency": "biweekly",
            "effective_from": change_date.isoformat(),
            "anchor_date": change_date.isoformat(),
        },
        headers=HEADERS,
    )
    assert response.status_code == 201

    db.expire_all()
    periods = list(db.scalars(select(PayPeriod).order_by(PayPeriod.start_date)))

    # Contiguous across the change.
    for previous, following in zip(periods, periods[1:], strict=False):
        assert following.start_date == previous.end_date + timedelta(days=1)

    transitions = [p for p in periods if p.is_transition]
    assert len(transitions) == 1
    assert transitions[0].end_date == change_date - timedelta(days=1)
    assert transitions[0].start_date == open_period.start_date


def test_past_periods_survive_a_change(auth_client, db):
    first_effective = date.today().replace(day=1) - timedelta(days=120)
    auth_client.post(
        SCHEDULE,
        json={
            "frequency": "monthly",
            "effective_from": first_effective.isoformat(),
            "day_of_month_1": 1,
        },
        headers=HEADERS,
    )
    before = [
        (p.start_date, p.end_date)
        for p in db.scalars(
            select(PayPeriod)
            .where(PayPeriod.end_date < date.today())
            .order_by(PayPeriod.start_date)
        )
    ]
    assert before

    open_period = service.period_containing(db, date.today())
    assert open_period is not None
    change_date = open_period.start_date + timedelta(days=3)
    auth_client.post(
        SCHEDULE,
        json={
            "frequency": "weekly",
            "effective_from": change_date.isoformat(),
            "anchor_date": change_date.isoformat(),
        },
        headers=HEADERS,
    )

    db.expire_all()
    after = [
        (p.start_date, p.end_date)
        for p in db.scalars(
            select(PayPeriod)
            .where(PayPeriod.end_date < open_period.start_date)
            .order_by(PayPeriod.start_date)
        )
    ]
    assert after == [row for row in before if row[1] < open_period.start_date]


def test_a_change_cannot_rewrite_the_current_period_start(auth_client, db):
    auth_client.post(
        SCHEDULE, json=semimonthly_payload(date.today() - timedelta(days=45)), headers=HEADERS
    )
    open_period = service.period_containing(db, date.today())
    assert open_period is not None

    response = auth_client.post(
        SCHEDULE,
        json={
            "frequency": "monthly",
            "effective_from": open_period.start_date.isoformat(),
            "day_of_month_1": 1,
        },
        headers=HEADERS,
    )

    assert response.status_code == 409
    assert response.json()["code"] == "effective_from_too_early"


def test_two_changes_cannot_share_an_effective_date(auth_client):
    effective = date.today() + timedelta(days=10)
    assert (
        auth_client.post(SCHEDULE, json=semimonthly_payload(effective), headers=HEADERS).status_code
        == 201
    )

    second = auth_client.post(
        SCHEDULE,
        json={
            "frequency": "monthly",
            "effective_from": effective.isoformat(),
            "day_of_month_1": 15,
        },
        headers=HEADERS,
    )
    assert second.status_code == 409
    assert second.json()["code"] == "effective_from_taken"


def test_history_lists_newest_first(auth_client, db):
    auth_client.post(
        SCHEDULE, json=semimonthly_payload(date.today() - timedelta(days=60)), headers=HEADERS
    )
    open_period = service.period_containing(db, date.today())
    assert open_period is not None
    change_date = open_period.start_date + timedelta(days=2)
    auth_client.post(
        SCHEDULE,
        json={
            "frequency": "monthly",
            "effective_from": change_date.isoformat(),
            "day_of_month_1": change_date.day,
        },
        headers=HEADERS,
    )

    body = auth_client.get(SCHEDULE).json()

    assert len(body["history"]) == 2
    assert body["current"]["frequency"] == "monthly"
    assert body["history"][0]["effective_from"] > body["history"][1]["effective_from"]


def test_preview_reports_the_transition_it_would_create(auth_client, db):
    auth_client.post(
        SCHEDULE, json=semimonthly_payload(date.today() - timedelta(days=45)), headers=HEADERS
    )
    open_period = service.period_containing(db, date.today())
    assert open_period is not None
    change_date = open_period.start_date + timedelta(days=4)

    body = auth_client.post(
        f"{SCHEDULE}/preview",
        json={
            "frequency": "weekly",
            "effective_from": change_date.isoformat(),
            "anchor_date": change_date.isoformat(),
        },
        headers=HEADERS,
    ).json()

    assert body["transition"] is not None
    assert body["transition"]["end_date"] == (change_date - timedelta(days=1)).isoformat()
    assert body["first_pay_date"] == change_date.isoformat()


def test_pay_schedule_routes_need_a_session(client):
    assert client.get(SCHEDULE).status_code == 401
    assert client.get(f"{PERIODS}/current").status_code == 401
