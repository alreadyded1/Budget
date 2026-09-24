# Data Model

SQLite through SQLAlchemy 2.x. Migrations with Alembic (`render_as_batch=True` for SQLite ALTERs).

## Conventions
- Every table has `id INTEGER PRIMARY KEY`.
- Money columns end in `_cents` and are `INTEGER`. Transaction amounts are signed from the account's view:
  outflow negative, inflow positive. Liability balances are negative.
- Calendar dates are SQLAlchemy `Date` (stored as `YYYY-MM-DD`). Audit timestamps are UTC.
- `created_at` / `updated_at` exist on every mutable table (not repeated below).
- Case-insensitive unique names use `COLLATE NOCASE`.
- If history points at a row, it is hidden or closed instead of deleted.
- Enums are stored as short lowercase strings with a CHECK constraint.
- An arrow (→) marks a foreign key.

---

## Users and auth
**users**
- `username` — unique, nocase
- `display_name`
- `password_hash` — argon2id
- `is_active`, `last_login_at`

**sessions**
- `token_hash` — sha256 of the random cookie token; unique
- `user_id` → users
- `expires_at`, `last_seen_at`, `user_agent`

## Settings (single row, id = 1)
**settings**
- `household_name`, `currency_symbol` (default `$`), `week_start` (0 = Sunday), `theme_default`
- `ntfy_url`, `ntfy_topic`, `ntfy_token` (nullable), `reminder_hour` (default 7)
- `prefill_last_amount` (bool)

## Pay schedule
**pay_schedules**
- `frequency` — weekly | biweekly | semimonthly | monthly
- `anchor_date` — first pay date, for weekly and biweekly
- `day_of_month_1`, `day_of_month_2` — `day_of_month_2` is for semimonthly only
- `weekend_rule` — none | previous_business_day | next_business_day
- `effective_from` — unique
- `notes`

A schedule change is a **new row** with a later `effective_from`. Rows whose periods are already in the past
are never edited.

**pay_periods**
- `start_date` — unique; equals the actual pay date after the weekend rule
- `end_date` — inclusive
- `schedule_id` → pay_schedules
- `is_transition`

Invariant: for consecutive periods, `next.start_date == prev.end_date + 1 day`. There are no gaps or overlaps.
Indexed on `(start_date, end_date)`.

## Accounts
**accounts**
- `name` — unique, nocase
- `type` — checking | savings | credit_card | cash | loan | mortgage | investment | other_asset |
  other_liability
- `on_budget`
- `opening_balance_cents` (signed), `opening_date`
- `institution`, `last4`, `sort_order`, `is_closed`
- `valuation_mode` — transactions | manual
- Debt fields (nullable): `apr_bps` (24.99% = 2499), `min_payment_cents`, `payment_due_day`
- `low_balance_alert_cents` (nullable)

**account_valuations** — used only by accounts with `valuation_mode = manual`
- `account_id` → accounts
- `date`, `balance_cents`, `note`
- unique `(account_id, date)`

## Categories
**category_groups**
- `name` — unique, nocase
- `kind` — expense | income
- `sort_order`, `is_hidden`

**categories**
- `group_id` → category_groups
- `name`
- `sort_order`, `is_hidden`
- `is_sinking_fund`
- `default_planned_cents` — the budget template amount per period
- unique `(group_id, name)`

## Payees
**payees**
- `name` — unique, nocase
- `default_category_id` → categories, nullable; this is the pinned default
- `notes`, `is_hidden`

The "last used category" fallback is computed by query, not stored.

## Transactions
**transactions**
- `account_id` → accounts
- `date`
- `payee_id` → payees, nullable; null for transfers
- `memo`
- `amount_cents` — signed
- `status` — uncleared | cleared | reconciled
- `check_number`
- `transfer_id` — nullable UUID text shared by both legs of a transfer
- `subscription_occurrence_id` → subscription_occurrences, nullable
- `import_batch_id` → import_batches, nullable
- `import_key` — nullable; OFX FITID or CSV hash
- `imported_description` — raw bank text
- `reconciliation_id` → reconciliations, nullable
- `created_by`, `updated_by` → users

Indexes: `(account_id, date)`, `(date)`, `(transfer_id)`.
Partial unique index on `(account_id, import_key)` where `import_key` is not null.

**transaction_splits**
- `transaction_id` → transactions, `ON DELETE CASCADE`
- `category_id` → categories, nullable; null means uncategorized
- `amount_cents` — signed, same sign as the parent
- `memo`, `sort_order`

Invariant: `SUM(splits.amount_cents) == transactions.amount_cents`, enforced in the service layer and checked in tests.
- A normal transaction has exactly **one** split.
- A transfer between two on-budget accounts has **zero** splits.
- An on-budget → tracking transfer has a split on the on-budget leg only.

**All category reporting reads from splits.**

## Budget
**period_plans**
- `pay_period_id` → pay_periods
- `category_id` → categories; income categories included
- `planned_cents` — ≥ 0
- `note`
- unique `(pay_period_id, category_id)`

Actuals are computed, not stored. Expected income = sum of planned amounts for income categories.

## Subscriptions
**subscriptions**
- `name`
- `payee_id`, `category_id`, `account_id`
- `amount_cents` — positive = cost
- `frequency` — weekly | biweekly | monthly | quarterly | semiannual | annual | custom
- `interval_count`, `interval_unit` — day | week | month; custom frequency only
- `anchor_date` — first due date
- `day_of_month` — month-based frequencies; clamps to month end
- `start_date`, `end_date` (nullable)
- `status` — active | paused | cancelled
- `auto_post`
- `remind_days_before` — default 3
- `url`, `notes`

**subscription_price_history**
- `subscription_id` → subscriptions
- `effective_date`, `amount_cents`

**subscription_occurrences**
- `subscription_id` → subscriptions
- `due_date`, `amount_cents`
- `status` — upcoming | paid | skipped
- `transaction_id` → transactions, nullable
- unique `(subscription_id, due_date)`

Occurrences are materialized about 13 months ahead. When a subscription changes, **future unpaid**
occurrences are regenerated. Paid and skipped rows are never touched.

## Goals
**goals**
- `name`
- `type` — savings | sinking_fund
- `target_cents`, `target_date` (nullable)
- `account_id` → accounts; savings goals
- `category_id` → categories; sinking funds
- `starting_balance_cents`
- `start_date` — the first day of the pay period the goal counts from (D-088)
- `is_archived`, `notes`

Sinking fund balance = `starting_balance_cents` + Σ `planned_cents` for its category in periods from
`start_date` through the period being viewed − Σ actual spending in that category over the same days.

**debt_plan** (single row)
- `strategy` — snowball | avalanche | custom
- `extra_monthly_cents`
- `custom_order` — JSON array of account IDs

## Import and rules
**import_profiles**
- `name`, `account_id` (nullable)
- `delimiter`, `has_header`, `skip_rows`
- `date_column`, `date_format`
- `amount_mode` — single | debit_credit
- `amount_column`, `debit_column`, `credit_column`, `invert_sign`
- `description_column`, `memo_column`

**import_batches**
- `account_id`, `filename`
- `format` — csv | ofx | qfx
- `profile_id`
- `status` — staged | committed | undone
- `row_count`, `imported_count`, `duplicate_count`, `matched_count`
- `created_by`, `committed_at`

**import_staged_rows**
- `batch_id` → import_batches, cascade
- `row_index`, `date`, `amount_cents`, `raw_description`, `raw_memo`, `import_key`
- `payee_id` or `new_payee_name`, `category_id`, `memo`
- `disposition` — import | skip | match
- `matched_transaction_id`, `applied_rule_id`

**rules**
- `name`, `priority`, `is_active`
- `match_field` — description | memo
- `match_type` — contains | starts_with | equals | regex
- `match_value`
- `amount_min_cents`, `amount_max_cents`, `account_id` — all nullable
- `set_payee_id`, `set_category_id`, `set_memo` — all nullable

## Reconciliation
**reconciliations**
- `account_id`
- `statement_date`, `statement_balance_cents`
- `adjustment_transaction_id` (nullable; no foreign key, see D-081)
- `completed_by`, `completed_at`

## Attachments
**attachments**
- `transaction_id` → transactions, cascade; the service also deletes the file
- `original_filename`
- `stored_path` — relative to the receipts directory
- `mime_type`, `size_bytes`, `sha256`
- `thumbnail_path` (nullable)
- `uploaded_by`

## Notifications
**notification_log**
- `kind` — bill_due | bill_overdue | low_balance | auto_post | backup_failed | test
- `ref_key` — e.g. `occ:123:due`, `acct:4:low:2026-10-01`
- `sent_at`, `success`, `error`
- unique `(kind, ref_key)` — this is what guarantees each notification is sent only once
