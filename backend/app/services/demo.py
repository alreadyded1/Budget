"""A demo household for performance work and poking around (`pb seed-demo`, D-109).

It is deliberately heavy: about 100k transactions over five years, roughly ten times what a
real household enters, so the ledger, the planner and the reports can be measured at the
size BUILD_PLAN names. The structure (user, categories, pay schedule, accounts,
subscriptions) goes through the normal services; the history is bulk-inserted, because
100k one-at-a-time saves would take minutes.

Everything comes from one seeded random generator, so the same arguments build the same
data. It refuses to touch a database that already has accounts or transactions.
"""

import calendar
import math
import random
import secrets
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time, timedelta

from sqlalchemy import func, insert, select, text
from sqlalchemy.orm import Session as DbSession

from app.errors import AppError
from app.models import (
    Account,
    AccountValuation,
    Category,
    Payee,
    PayPeriod,
    PeriodPlan,
    Reconciliation,
    Transaction,
    TransactionSplit,
    User,
)
from app.services import accounts as accounts_service
from app.services import pay_schedule as schedule_service
from app.services import subscriptions as subscriptions_service
from app.services import users as users_service
from app.services.seed import seed_categories

DEMO_USERNAME = "demo"
#: Transactions older than this are reconciled; newer ones are cleared or not yet.
RECONCILED_AFTER_DAYS = 45
BATCH = 5000

#: Everyday spending: (category, weight, low cents, high cents, payee stems).
SPENDING: list[tuple[str, int, int, int, list[str]]] = [
    ("Groceries", 22, 1200, 18000, ["FreshMart", "Green Basket", "Corner Grocer", "BulkBarn"]),
    ("Dining out", 20, 800, 9000, ["Noodle House", "Taco Stand", "Bistro 21", "Pizza Place"]),
    ("Fuel", 10, 2500, 7500, ["Fuel Stop", "Quick Gas", "Highway Petrol"]),
    ("Parking and tolls", 5, 200, 2500, ["City Parking", "Toll Road Authority"]),
    ("Pharmacy", 4, 500, 6000, ["Health Pharmacy", "Care Drugstore"]),
    ("Clothing", 6, 1500, 15000, ["Threads", "Outfitters", "Shoe Barn"]),
    ("Fun money", 12, 500, 8000, ["Cinema", "Book Nook", "Game Shop", "Hobby Hut"]),
    ("Gifts", 3, 1500, 12000, ["Gift Gallery", "Florist"]),
    ("Repairs", 2, 3000, 40000, ["Hardware Depot", "Handy Services"]),
    ("Maintenance", 2, 4000, 60000, ["Auto Care", "Tire Center"]),
    ("Doctor and dentist", 2, 2500, 25000, ["Family Clinic", "Bright Smile Dental"]),
    ("Subscriptions", 4, 499, 2499, ["Stream Plus", "Tune Box", "Cloud Locker"]),
]
LOCATIONS = [
    "Downtown",
    "Northside",
    "Southgate",
    "Eastview",
    "Westfield",
    "Riverside",
    "Hilltop",
    "Lakeside",
    "Midtown",
    "Old Town",
    "Airport",
    "Harbor",
    "Parkway",
    "Market St",
]
#: Monthly bills paid from checking: (category, payee, day of month, low, high).
BILLS: list[tuple[str, str, int, int, int]] = [
    ("Rent or mortgage", "Maple Property Mgmt", 1, 185000, 185000),
    ("Home insurance", "Shield Insurance", 5, 12500, 12500),
    ("Electric", "City Power", 12, 7000, 19000),
    ("Gas", "Metro Gas", 14, 2500, 11000),
    ("Water", "Water Utility", 18, 3500, 6500),
    ("Internet", "Fiber Net", 20, 7999, 7999),
    ("Phone", "Mobile One", 22, 8500, 9500),
    ("Car insurance", "Road Mutual", 8, 11800, 11800),
    ("Insurance", "Health Plan Co", 3, 29000, 29000),
]
#: The share of everyday spending each account carries.
SPEND_ACCOUNTS = [("Checking", 45), ("Visa", 30), ("Mastercard", 20), ("Cash", 5)]
SPLIT_CATEGORIES = ["Groceries", "Clothing", "Fun money", "Pharmacy", "Gifts"]
MEMOS = ["", "", "", "", "", "", "", "", "birthday", "weekend", "work trip", "reimbursable"]


@dataclass
class DemoResult:
    username: str
    password: str | None
    accounts: int
    payees: int
    transactions: int
    splits: int
    periods: int
    first_date: date
    last_date: date


@dataclass
class _Row:
    account: str
    on: date
    amount: int
    payee: int | None = None
    splits: list[tuple[int | None, int]] = field(default_factory=list)
    memo: str | None = None
    transfer: str | None = None
    check: str | None = None


def _uuid(rng: random.Random) -> str:
    return str(uuid.UUID(int=rng.getrandbits(128), version=4))


def _month_starts(start: date, end: date) -> list[date]:
    months = []
    day = start.replace(day=1)
    while day <= end:
        months.append(day)
        day = (day + timedelta(days=32)).replace(day=1)
    return months


def _on_day(month: date, day: int) -> date:
    return month.replace(day=min(day, calendar.monthrange(month.year, month.month)[1]))


def seed_demo(
    db: DbSession,
    *,
    transactions: int = 100_000,
    years: int = 5,
    today: date | None = None,
    seed: int = 16,
    password: str | None = None,
) -> DemoResult:
    """Build the demo household. Returns what it made, including the demo login's password."""
    if db.scalar(select(func.count()).select_from(Account)) or db.scalar(
        select(func.count()).select_from(Transaction)
    ):
        raise AppError(
            409,
            "The demo only goes into an empty database; this one already has accounts.",
            "demo_needs_empty_database",
        )
    if transactions < 1000 or years < 1:
        raise AppError(422, "Ask for at least 1,000 transactions and one year.", "demo_too_small")

    rng = random.Random(seed)
    today = today or date.today()
    start = today - timedelta(days=365 * years)

    # --- login, categories, schedule --------------------------------------------------------
    user = db.scalars(select(User).where(User.username == DEMO_USERNAME)).first()
    made_password = None
    if user is None:
        made_password = password or secrets.token_urlsafe(12)
        user = users_service.create_user(db, DEMO_USERNAME, "Demo", made_password)
    seed_categories(db)
    db.commit()
    by_name = {c.name: c.id for c in db.scalars(select(Category))}
    if "Car payment" not in by_name:
        transport = db.scalar(select(Category.group_id).where(Category.name == "Fuel"))
        car = Category(group_id=transport, name="Car payment", sort_order=99)
        db.add(car)
        db.flush()
        by_name["Car payment"] = car.id

    anchor = start + timedelta(days=(4 - start.weekday()) % 7)  # the first Friday
    spec = schedule_service.spec_from_input("biweekly", anchor, anchor, None, None, "none")
    schedule_service.commit_change(db, spec, today)
    schedule_service.ensure_horizon(db, today)
    db.commit()

    # --- accounts --------------------------------------------------------------------------
    def account(name: str, kind: str, opening: int, **extra) -> Account:
        return accounts_service.create_account(
            db, name=name, type=kind, opening_balance_cents=opening, opening_date=start, **extra
        )

    accounts = {
        a.name: a
        for a in (
            account("Checking", "checking", 250_000, institution="Demo Bank", last4="1234"),
            account("Savings", "savings", 1_000_000, institution="Demo Bank"),
            account(
                "Visa", "credit_card", 0, apr_bps=2299, min_payment_cents=3500, payment_due_day=21
            ),
            account(
                "Mastercard",
                "credit_card",
                0,
                apr_bps=1999,
                min_payment_cents=2500,
                payment_due_day=9,
            ),
            account("Cash", "cash", 20_000),
            account(
                "Car loan",
                "loan",
                -1_800_000,
                apr_bps=649,
                min_payment_cents=40_000,
                payment_due_day=15,
            ),
            account("House", "other_asset", 32_000_000, valuation_mode="manual"),
        )
    }
    house = accounts["House"]
    value = house.opening_balance_cents
    for year in range(1, years + 1):
        value = value * 104 // 100
        db.add(
            AccountValuation(
                account_id=house.id,
                date=start + timedelta(days=365 * year),
                balance_cents=value,
                note="Yearly estimate",
            )
        )

    # --- payees ----------------------------------------------------------------------------
    stems: list[tuple[str, int]] = []
    for category, *_rest, names in SPENDING:
        stems += [(name, by_name[category]) for name in names]
    payee_rows: list[dict] = []
    for name, _category_id in stems:
        for location in LOCATIONS:
            payee_rows.append({"name": f"{name} {location}", "default_category_id": None})
    fixed_names = [p for _c, p, *_ in BILLS] + ["Acme Corp Payroll", "Tax Refund"]
    payee_rows += [{"name": name, "default_category_id": None} for name in fixed_names]
    db.execute(insert(Payee), payee_rows)
    payees = {p.name: p.id for p in db.scalars(select(Payee))}
    by_category: dict[int, list[int]] = defaultdict(list)
    for name, category_id in stems:
        by_category[category_id] += [payees[f"{name} {loc}"] for loc in LOCATIONS]

    # --- the history -----------------------------------------------------------------------
    rows: list[_Row] = []
    months = _month_starts(start, today)
    for month in months:
        for category, payee, day, low, high in BILLS:
            on = _on_day(month, day)
            if start < on <= today:
                amount = -rng.randint(low, high)
                rows.append(
                    _Row("Checking", on, amount, payees[payee], [(by_name[category], amount)])
                )
        on = _on_day(month, 25)
        if start < on <= today:
            rows.append(_Row("Checking", on, -50_000, transfer=_uuid(rng), memo="Monthly saving"))
            rows.append(
                _Row("Savings", on, 50_000, transfer=rows[-1].transfer, memo="Monthly saving")
            )

    loan_owed = -accounts["Car loan"].opening_balance_cents
    for month in months:
        on = _on_day(month, 15)
        if not (start < on <= today) or loan_owed <= 0:
            continue
        payment = min(40_000, loan_owed)
        loan_owed -= payment
        transfer = _uuid(rng)
        rows.append(
            _Row(
                "Checking",
                on,
                -payment,
                splits=[(by_name["Car payment"], -payment)],
                transfer=transfer,
            )
        )
        rows.append(_Row("Car loan", on, payment, transfer=transfer))

    fixed = len(rows)
    paydays = [p.start_date for p in db.scalars(select(PayPeriod)) if start < p.start_date <= today]
    card_months = len(months) * 2
    everyday = max(0, transactions - fixed - len(paydays) - card_months * 2 - len(months) * 2)
    weights = [w for _c, w, *_ in SPENDING]
    span = (today - start).days
    account_names = [name for name, _ in SPEND_ACCOUNTS]
    account_weights = [w for _, w in SPEND_ACCOUNTS]
    for _ in range(everyday):
        category, _w, low, high, _names = rng.choices(SPENDING, weights)[0]
        category_id = by_name[category]
        on = start + timedelta(days=rng.randint(1, span))
        # Most purchases are small; a few are large.
        amount = -int(low + (high - low) * rng.random() ** 2.2)
        splits = [(category_id, amount)]
        if rng.random() < 0.05:
            other = by_name[rng.choice([c for c in SPLIT_CATEGORIES if c != category])]
            part = -rng.randint(1, max(1, -amount // 2))
            splits = [(category_id, amount - part), (other, part)]
        where = rng.choices(account_names, account_weights)[0]
        row = _Row(
            where,
            on,
            amount,
            rng.choice(by_category[category_id]),
            splits,
            memo=rng.choice(MEMOS) or None,
        )
        if where == "Checking" and rng.random() < 0.01:
            row.check = str(1000 + rng.randint(0, 8999))
        rows.append(row)

    # Pay each card's month in full on the 15th of the next month.
    card_spend: dict[tuple[str, date], int] = defaultdict(int)
    for row in rows:
        if row.account in ("Visa", "Mastercard"):
            card_spend[(row.account, row.on.replace(day=1))] += row.amount
    for (card, month), spent in sorted(card_spend.items()):
        on = _on_day((month + timedelta(days=32)).replace(day=1), 15)
        if on <= today and spent < 0:
            transfer = _uuid(rng)
            rows.append(_Row("Checking", on, spent, transfer=transfer, memo="Card payment"))
            rows.append(_Row(card, on, -spent, transfer=transfer, memo="Card payment"))

    # A cash withdrawal on the 1st covers each month's cash spending, in $20 notes.
    cash_spend: dict[date, int] = defaultdict(int)
    for row in rows:
        if row.account == "Cash":
            cash_spend[row.on.replace(day=1)] += row.amount
    for month, spent in sorted(cash_spend.items()):
        on = max(month, start + timedelta(days=1))
        amount = math.ceil(-spent / 2000) * 2000
        transfer = _uuid(rng)
        rows.append(_Row("Checking", on, -amount, transfer=transfer, memo="ATM"))
        rows.append(_Row("Cash", on, amount, transfer=transfer, memo="ATM"))

    # Paychecks sized so checking keeps a small cushion over the years.
    outflow = -sum(row.amount for row in rows if row.account == "Checking")
    pay = math.ceil(outflow / max(1, len(paydays)) / 10_000) * 10_000 + 10_000
    for day in paydays:
        amount = pay + rng.choice([0, 0, 0, 2_500, -2_500])
        rows.append(
            _Row(
                "Checking",
                day,
                amount,
                payees["Acme Corp Payroll"],
                [(by_name["Paycheck"], amount)],
                memo=None,
            )
        )

    rows.sort(key=lambda row: (row.on, row.account, row.amount))

    # --- statuses and monthly reconciliations ----------------------------------------------
    cutoff = today - timedelta(days=RECONCILED_AFTER_DAYS)
    running = {name: a.opening_balance_cents for name, a in accounts.items()}
    month_totals: dict[tuple[str, date], int] = {}
    for row in rows:
        running[row.account] += row.amount
        month_totals[(row.account, row.on.replace(day=1))] = running[row.account]
    reconciliations: dict[tuple[str, date], int] = {}
    next_id = (db.scalar(select(func.max(Reconciliation.id))) or 0) + 1
    recon_rows = []
    for (name, month), balance in sorted(month_totals.items()):
        statement = _on_day(month, 31)
        if statement > cutoff or name == "Cash":
            continue
        reconciliations[(name, month)] = next_id
        recon_rows.append(
            {
                "id": next_id,
                "account_id": accounts[name].id,
                "statement_date": statement,
                "statement_balance_cents": balance,
                "completed_by": user.id,
                "completed_at": datetime.combine(statement + timedelta(days=3), time(19), UTC),
            }
        )
        next_id += 1
    if recon_rows:
        db.execute(insert(Reconciliation), recon_rows)

    # --- write -----------------------------------------------------------------------------
    first_id = (db.scalar(select(func.max(Transaction.id))) or 0) + 1
    tx_batch: list[dict] = []
    split_batch: list[dict] = []
    written = splits_written = 0

    def flush() -> None:
        nonlocal tx_batch, split_batch
        if tx_batch:
            db.execute(insert(Transaction), tx_batch)
        if split_batch:
            db.execute(insert(TransactionSplit), split_batch)
        tx_batch, split_batch = [], []

    for offset, row in enumerate(rows):
        tx_id = first_id + offset
        recon = reconciliations.get((row.account, row.on.replace(day=1)))
        if recon is not None and row.on <= cutoff:
            status = "reconciled"
        elif row.account == "Cash" or row.on <= cutoff or rng.random() < 0.7:
            status, recon = "cleared", None
        else:
            status, recon = "uncleared", None
        tx_batch.append(
            {
                "id": tx_id,
                "account_id": accounts[row.account].id,
                "date": row.on,
                "payee_id": row.payee,
                "memo": row.memo,
                "amount_cents": row.amount,
                "status": status,
                "check_number": row.check,
                "transfer_id": row.transfer,
                "reconciliation_id": recon,
                "created_by": user.id,
                "updated_by": user.id,
            }
        )
        for order, (category_id, amount) in enumerate(row.splits):
            split_batch.append(
                {
                    "transaction_id": tx_id,
                    "category_id": category_id,
                    "amount_cents": amount,
                    "sort_order": order,
                }
            )
            splits_written += 1
        written += 1
        if len(tx_batch) >= BATCH:
            flush()
    flush()

    # --- a plan for every past period: each category's typical spend ------------------------
    per_period = max(1, len(paydays))
    totals: dict[int, int] = defaultdict(int)
    for row in rows:
        for category_id, amount in row.splits:
            if category_id is not None:
                totals[category_id] += abs(amount)
    for category in db.scalars(select(Category)):
        typical = totals.get(category.id, 0) // per_period
        category.default_planned_cents = math.ceil(typical / 1000) * 1000
    past = [p.id for p in db.scalars(select(PayPeriod).where(PayPeriod.start_date <= today))]
    plan_rows = [
        {
            "pay_period_id": period_id,
            "category_id": category_id,
            "planned_cents": math.ceil(total // per_period / 1000) * 1000,
        }
        for period_id in past
        for category_id, total in totals.items()
    ]
    for chunk in range(0, len(plan_rows), BATCH):
        db.execute(insert(PeriodPlan), plan_rows[chunk : chunk + BATCH])

    # --- a few bills that recur from here on ------------------------------------------------
    for name, amount, day in (
        ("Stream Plus", 1599, 7),
        ("Tune Box", 1099, 17),
        ("Cloud Locker", 299, 27),
    ):
        payee_id = payees[f"{name} Downtown"]
        anchor_day = _on_day(today + timedelta(days=1), day)
        if anchor_day <= today:
            anchor_day = _on_day((today.replace(day=1) + timedelta(days=32)).replace(day=1), day)
        subscriptions_service.create_subscription(
            db,
            {
                "name": name,
                "payee_id": payee_id,
                "category_id": by_name["Subscriptions"],
                "account_id": accounts["Visa"].id,
                "amount_cents": amount,
                "frequency": "monthly",
                "anchor_date": anchor_day,
                "day_of_month": day,
            },
            today=today,
        )

    db.commit()
    # Fresh statistics so SQLite's planner knows the tables are big.
    db.execute(text("ANALYZE"))
    db.commit()

    return DemoResult(
        username=DEMO_USERNAME,
        password=made_password,
        accounts=len(accounts),
        payees=len(payees),
        transactions=written,
        splits=splits_written,
        periods=db.scalar(select(func.count()).select_from(PayPeriod)) or 0,
        first_date=rows[0].on,
        last_date=rows[-1].on,
    )
