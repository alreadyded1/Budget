# Payday Budget — Functional Spec

## 1. Overview
A self-hosted budgeting app for one household. Everyone in the household logs in with their own account
and sees and edits the same budget. Budgets run per **pay period** on a single shared pay schedule. Each
period has a **planned** amount per category that **actual** spending is measured against. Unspent planned
money **resets** each period (sinking funds are the one deliberate exception; see §13).

Core modules: pay schedule, accounts, categories, payees, transactions (fast keyboard entry), budget planner,
subscriptions and bill calendar, ntfy reminders, CSV/OFX/QFX import with rules, reconciliation, reports,
goals and sinking funds, net worth and debt payoff, receipt attachments.

## 2. Pay schedule and pay periods
- Frequencies: **weekly**, **biweekly**, **semimonthly** (two days of the month, e.g. 1st and 15th), **monthly**.
- Weekly and biweekly are defined by an anchor pay date. Monthly and semimonthly are defined by day(s) of month.
- A day of month past the end of a month clamps to the last day (31st → Feb 28/29, Apr 30). The next month
  goes back to the configured day. Dates never drift.
- Weekend rule for monthly and semimonthly: no change / previous business day / next business day.
- **A pay period starts on a pay date and ends the day before the next pay date.** Periods are contiguous:
  no gaps, no overlaps, no grace days. Every calendar date belongs to exactly one period.
- A transaction belongs to the period that contains its date. No manual reassignment.
- Periods are generated about 13 months ahead and extended automatically.
- **Schedule changes** are recorded with an effective date. Past periods never change. The period in progress
  ends the day before the first pay date on the new schedule; that period is flagged as a transition period.
  When planning a transition period, the planner offers to prorate planned amounts by day count.
- The pay schedule history and full list of past periods are viewable.
- Changing the schedule shows a preview of the resulting periods before it is saved.

## 3. Accounts
- Types: checking, savings, credit card, cash, loan, mortgage, investment, other asset, other liability.
- **On-budget** accounts (default: checking, savings, credit card, cash) feed the budget.
  **Tracking** accounts (default: loan, mortgage, investment, other) count toward net worth only.
- Fields: name, type, on-budget flag, opening balance and date, institution, last 4 digits (optional),
  sort order, closed flag. Debt accounts also have APR, minimum payment, and payment due day.
  Optional low-balance alert threshold.
- Balances shown: current, cleared, and reconciled. Liabilities display as amounts owed.
- Investment and property accounts can use **manual valuation**: the user enters a dated balance.
- Closing an account hides it from entry lists but keeps its history.

## 4. Categories
- Two levels: **groups** (e.g. Housing) contain **categories** (e.g. Rent, Electric).
- Groups are either expense or income.
- Each category has a default planned amount per period (the budget template) and an optional
  **sinking fund** flag.
- Reorder with drag or keyboard (Alt+Up/Down). Hide categories that are no longer used.
- A category with transactions can't be deleted until its transactions are reassigned. Offer the reassignment
  in the delete dialog.
- A starter category set is offered on first run.

## 5. Payees
- Payees are listed **alphabetically**, case-insensitive, with a search box.
- **Inline rename**: click the name or press Enter → edit → Enter saves, Esc cancels. Transactions,
  subscriptions, and rules reference payees by ID, so a rename shows up everywhere immediately.
- Names are unique (case-insensitive). Renaming to an existing name offers to **merge** the two payees.
- Merge payees: move all transactions, subscriptions, and rules to the target payee, then delete the source.
- Each payee shows its default category, number of transactions, last used date, and total spent.
- Optional pinned default category. Without a pinned default, the last category used with that payee is used.
- Payees can be hidden from typeahead without deleting them.
- Transfers use virtual payees ("Transfer: Savings") that do not appear in the payee list.

## 6. Transactions
- Fields: account, date, payee, category (or split), memo, amount, status (uncleared / cleared / reconciled),
  optional check number, attachments.
- **Splits**: one transaction divided across several categories. The split amounts must add up to the total.
  The UI shows the remaining amount live.
- **Transfers** between accounts: one entry creates two linked transactions, one in each account. Editing one
  updates the other; deleting one deletes both. A transfer between two on-budget accounts has no category.
  A transfer from an on-budget account to a tracking account (e.g. a car loan payment) needs a category so
  it counts against the budget.
- Editing the amount, date, or account of a **reconciled** transaction requires a confirmation.
- Bulk actions on selected rows: set category, set status, delete.

## 7. Transaction entry UX (requirements 7 and 8)
This is the most important screen. It should feel like a fast spreadsheet.

**Layout**: ledger columns: Date · Payee · Category · Memo · Outflow · Inflow · Cleared · Balance.
A **new-entry row** stays pinned at the top of the ledger. In the "All accounts" view the entry row adds an
Account field first.

**Tab order**: (Account) → Date → Payee → Category → Memo → Outflow → Inflow. Shift+Tab goes backwards.
- In a typeahead with its dropdown open, Tab or Enter picks the highlighted suggestion.
- Enter with no dropdown open **saves the row** from any field.
- Esc closes an open dropdown. A second Esc clears the row.

**After saving**:
- The transaction appears in the ledger instantly (optimistic update) with an updated running balance.
- The entry row clears, **keeps the date**, and focus goes back to **Payee**. This makes it quick to enter a
  stack of receipts from the same day.
- The page never reloads or scrolls away. If the server rejects the save, the new row is removed, the entry
  row is refilled with what was typed, and a toast explains the error.

**Payee field**: fuzzy typeahead. A new name shows "Create 'X'", and the payee is created when the row is
saved. Choosing a payee fills in its category (pinned default, otherwise last used). An optional setting also
fills in the last amount.

**Category field**: typeahead grouped by category group. A "Split…" option opens inline split lines with the
same tab behavior and a live remaining amount. A transfer is chosen by typing the account name in Payee
("Transfer: Savings").

**Date field**:
- `t` = today; `+` / `-` = next or previous day
- `15` = the 15th of the current month; `3/15` = March 15 this year; full dates are accepted
- Clicking opens a date picker

**Amount fields**:
- Accept `12.5`, `$12.50`, `1,234.56`, and simple math such as `12.50+3.25` or `100/3` (rounded to cents).
- Typing in Outflow clears Inflow and vice versa. A leading `+` in Outflow moves the value to Inflow.

**Editing existing rows**:
- Up/Down arrows (or j/k) move the selected row. Enter opens the row inline with the same tab order.
- In edit mode, Enter saves and Esc cancels.
- `c` toggles cleared.
- Delete removes the row and shows a toast with Undo for 5 seconds.

**Other shortcuts**: `n` focuses the entry row, `/` focuses search, `?` shows a shortcut overlay.

**Performance targets**:
- Save round trip under 150 ms on the LAN.
- Typeahead results under 50 ms (payees, categories, and accounts are cached client-side).
- Ledgers with thousands of rows scroll smoothly (virtualized list).

**Search and filter bar**: text (payee/memo), date range, category, payee, status, amount range.

## 8. Budget planner (planned vs. actual)
- Opens on the current pay period. Previous/next buttons and a "jump to today" button.
- Summary header: expected income, total planned, left to plan (income − planned), actual spent, remaining.
- **Income section**: planned vs. received for each income category.
- **Expense section**: by group, then category. Columns: Planned · Actual · Remaining · progress bar.
  Overspent rows are highlighted. Groups show subtotals.
- Planned amounts are edited inline with the same tab-through behavior as the ledger. Totals update instantly.
- A new period is prefilled from the template (each category's default planned amount) plus subscription
  bills due in that period (see §9). A hint shows how much of a category's plan is committed bills.
- Actions: Copy last period · Apply template · Clear plan. In a transition period, also Prorate.
- **Reset each period**: every period starts fresh. No carryover, except sinking fund categories (§13).
- Actual = sum of split amounts in the category for transactions dated inside the period.
  Transfers between on-budget accounts are excluded.
- An alert shows the count of uncategorized transactions in the period and links to them.

## 9. Subscriptions and bill calendar
- Fields:
  - name, payee, category, account it's paid from, amount
  - frequency: weekly, biweekly, monthly, quarterly, semiannual, annual, or custom (every N days/weeks/months)
  - next due date / due day of month (clamps like pay dates), start date, optional end date
  - status (active / paused / cancelled)
  - auto-post (on) or remind only (off)
  - reminder lead days (default 3)
  - URL of the manage/cancel page, notes
- List view shows each item's next due date, payee, amount, and frequency. It can be sorted by any column.
  Totals show the monthly equivalent and annual cost, with a breakdown by category.
- **Price history**: changing the amount records the old amount and date. Items with increases get a badge.
- **Occurrences**: each due date is tracked as upcoming, paid, or skipped. Saving a transaction with the same
  payee, a similar amount, and a date from 14 days before to 5 days after the due date (never back past
  the previous due date) suggests linking it as payment; the oldest unpaid bill wins.
- "Mark paid" opens the entry row prefilled with the bill's details.
- **Bill calendar**: a month grid showing bills on their due dates, colored paid / upcoming / overdue, with
  **pay dates marked**. Phones get a list view. Clicking a bill shows details and the Mark paid action.
- Bills due inside a pay period appear in the budget planner as committed amounts (§8).
- The dashboard has an "Upcoming bills" widget covering the rest of this pay period and the next.

## 10. Reminders via ntfy
- Settings: ntfy server URL, topic, optional access token, and a "Send test" button.
- A daily job (systemd timer, default 07:00 local time) does the following:
  - extends pay periods and bill occurrences ahead
  - auto-posts due auto-post subscriptions
  - sends reminders for bills due within each bill's lead days
  - sends a one-time overdue notice
  - sends low-balance alerts for accounts with a threshold
  - reports backup failures
- Every notification is sent once. A log records what was sent. Messages include a link to the bill in the app.
- The notification log can be viewed in Settings.

## 11. Import (CSV / OFX / QFX) and rules
- Flow: choose account → upload file → **review screen** → confirm. Nothing is saved before confirm.
- **CSV profiles** store a column mapping per bank and are reused. A profile covers:
  - delimiter, header row, and rows to skip
  - date column and date format
  - amount as one signed column or as separate debit/credit columns, plus an invert-sign option
  - description and memo columns
- **OFX/QFX**: parsed directly. The bank's FITID is used as the duplicate key.
- **Duplicate detection**: FITID for OFX/QFX. For CSV, a hash of account, date, amount, raw description,
  and position within same-day duplicates. Rows already imported are flagged and skipped by default.
- **Matching**: if a manually entered transaction has the same amount within ±3 days, the imported row is
  offered as a match. A match marks the existing entry cleared and keeps your payee and category.
- **Rules**: an ordered list.
  - Conditions: raw description or memo contains / starts with / equals / regex; optional amount range;
    optional account.
  - Actions: set payee, set category, set memo.
  - Renaming a payee on the review screen offers "Create rule from this".
- The raw bank description is stored on the transaction for reference.
- Import history per account with **undo import**.

## 12. Reconciliation
- Start from an account: enter the statement date and ending balance.
- The screen lists uncleared and cleared transactions up to the statement date, with checkboxes.
  The difference from the statement updates live.
- When the difference is zero, Finish marks the checked transactions reconciled and saves a reconciliation
  record.
- If it can't be balanced, the user can create an adjustment transaction and finish.
- Reconciliation history is kept per account.

## 13. Goals and sinking funds
- **Savings goal**: target amount, optional target date, and a linked account. Progress is the account
  balance, optionally minus a starting amount.
- **Sinking fund**: linked to a category flagged as a sinking fund. Its balance **accumulates** across periods
  (starting balance + planned each period − spent). This is the one exception to "reset each period";
  building up money for irregular expenses is the point of a sinking fund.
- Each goal shows: progress bar, amount remaining, the per-period contribution needed to hit the target date,
  an on-track or behind status, and the projected completion date at the current rate.
- "Use suggested contribution" pushes the needed amount into the current period's plan.

## 14. Net worth and debt payoff
- **Net worth** = assets − liabilities across all open accounts (on-budget and tracking).
- Shows current total, a month-end history chart, and a breakdown by account type.
- Manual-valuation accounts use their latest balance entry on or before each date.
- **Debt payoff planner**: uses debt accounts with balance, APR, and minimum payment.
  - Enter an extra monthly payment and choose a strategy: snowball (smallest balance first), avalanche
    (highest APR first), or a custom order.
  - Output: payoff date per debt, total interest, months until debt-free, and a month-by-month schedule.
  - Strategies can be compared side by side.
  - Calculations use monthly compounding (APR ÷ 12) and are labeled as estimates.

## 15. Receipt attachments
- One or more files per transaction: JPG, PNG, WEBP, HEIC, PDF. Maximum 10 MB each (configurable).
- Upload by drag and drop on desktop, or with the camera/photo picker on a phone.
- Files are stored on disk outside the web root and served only through an authenticated endpoint.
- The ledger shows a paperclip on rows with attachments. Clicking it opens a preview with thumbnails.
  Attachments can be deleted.
- Receipts are included in backups.

## 16. Reports
- **Date presets**: This pay period, Last pay period, Month to date, Last month, Year to date, Last year,
  Custom range.
- **Filters**: accounts, categories, payees.
- Reports:
  1. **Spending by category**: grouped totals with % of total and a chart. Drill down to the transactions.
  2. **Planned vs. actual**: per pay period over a range, variance per category, trend chart.
  3. **Income vs. expense**: by month or by pay period, with net and savings rate.
  4. **Spending by payee**: top payees with drill-down.
  5. **Category trend**: monthly line chart for selected categories.
  6. **Net worth over time**.
  7. **Subscriptions summary**: monthly and annual cost by category.
  8. **Transaction list**: every filter, running totals.
- All tables export to CSV. Pages have print-friendly styles.
- Transfers between on-budget accounts are excluded from income and spending totals.

## 17. Settings, users, data
- Household members: add, disable, reset password (in the UI and the CLI). Every user has full access to
  the shared budget. Transactions record who created and last edited them.
- Settings pages: pay schedule, currency symbol, first day of week, theme (light / dark / system), ntfy,
  import profiles, rules, categories, users.
- Data export: all transactions as CSV, and a full JSON export of the whole database.
- First-run onboarding: create first user (CLI), then a wizard for pay schedule → accounts → categories.

## 18. Non-functional requirements
- Runs comfortably on a 1–2 vCPU, 1–2 GB RAM LXC.
- No full page reloads anywhere. Interactions feel instant.
- Desktop-first ledger, usable on a phone: card-style rows and large touch targets. Installable as a PWA.
  Offline writes are out of scope.
- Accessibility: visible focus rings, labeled inputs, full keyboard navigation.
- Security:
  - HTTPS through NGINX Proxy Manager
  - HttpOnly / Secure / SameSite=Lax session cookies
  - argon2id password hashes
  - login rate limiting
  - a required custom header on mutations (CSRF defense)
  - app port reachable only from the proxy
- Data integrity: SQLite foreign keys enforced, split totals validated, constraints in the database as well
  as in code.
- Nightly backups with 14-day retention. Restore is tested and documented.

## 19. Out of scope for v1
Bank auto-sync (SimpleFIN/Plaid), multiple currencies, investment holdings and lot tracking, multiple pay
schedules / multiple earners' schedules, multiple households, native mobile apps, offline mode, and
tax reporting.
