# Progress

**Current phase:** Phase 9 — Daily job and ntfy (not started)
**Next step:** Plan Phase 9 per docs/BUILD_PLAN.md and SPEC §10 — `pb run-daily` (auto-post, reminders,
horizons, session sweep) and the ntfy client, including the backup-failure alert.

## Phase status
| # | Phase | Status | Finished |
|---|---|---|---|
| 0 | Scaffold and tooling | ✅ done | 2026-09-22 |
| 1 | Auth, users, settings | ✅ done * | 2026-09-22 |
| 2 | Pay schedule engine | ✅ done | 2026-09-22 |
| 3 | Accounts, categories, payees | ✅ done † | 2026-09-23 |
| 4 | Transactions backend | ✅ done | 2026-09-23 |
| 5 | Ledger UI and fast entry | ✅ done | 2026-09-24 |
| 6 | Budget planner and dashboard | ✅ done | 2026-09-24 |
| 7 | Deploy MVP to LXC | ✅ done | 2026-09-24 |
| 8 | Subscriptions and bill calendar | ✅ done | 2026-09-24 |
| 9 | Daily job and ntfy | ⬜ | |
| 10 | Import and rules | ⬜ | |
| 11 | Reconciliation | ⬜ | |
| 12 | Reports | ⬜ | |
| 13 | Goals and sinking funds | ⬜ | |
| 14 | Net worth and debt payoff | ⬜ | |
| 15 | Receipt attachments | ⬜ | |
| 16 | Polish and hardening | ⬜ | |

Status key: ⬜ not started · 🟨 in progress · ✅ done

\* Phase 1 is built and its automated tests pass, but one "Done when" box is still open: the
browser click-through of CLI user → login form → signed in. The browser tooling disconnected before that
check could run. The server side of it is verified (see the session log below).

† Phase 3 is built, but one "Done when" box cannot be closed from inside Phase 3: "merging moves
transactions, subscriptions, and rules" needs tables that Phases 4, 8 and 10 add. Phases 4 and 8 have
since registered transactions and subscriptions and proved those parts; the box closes when rules
(Phase 10) register theirs.

## Session log
<!-- Newest first. Copy this block for each session.
### YYYY-MM-DD — Phase N (short title)
- **Done:**
- **Deviations from plan:**
- **Known issues:**
- **Next step:**
-->

### 2026-09-24 — Phase 8 (Subscriptions and bill calendar)
- **Done:**
  - Migration `0007`: `subscriptions`, `subscription_price_history`, `subscription_occurrences`
    (unique per subscription and due date; payment link set to null if the transaction goes).
  - `app/domain/subscriptions.py` (pure): due dates for every frequency by index with the month-end
    clamp, next due, exact annual and monthly equivalents (D-063), and payment matching (D-064).
  - `app/services/subscriptions.py`: CRUD, price history, ~13-month materialization with lazy
    extension, rebuild of future unpaid occurrences on edit (D-066), pay / skip / reopen, the best
    match for a new transaction, committed bills per category, and registrations so a payee merge
    or category delete moves subscriptions and a deleted payment reopens its bill (D-067).
  - Endpoints: `/subscriptions` CRUD, `GET /bills?from=&to=`, `GET /bills/{id}`,
    `POST /bills/{id}/{pay|skip|reopen}`; `POST /transactions` takes `subscription_occurrence_id` and
    answers with `paid_occurrence_id` or a `bill_match`; budget lines carry `committed_cents`; the
    dashboard carries `upcoming_bills`.
  - Planner: new periods prefill with template + bills (D-065), and every line shows "$X in bills".
  - UI: the Subscriptions page (sortable list, next due, price-rise badge, monthly/annual totals and
    by category, keyboard add/edit form, pause / resume / cancel / delete, manage link); the bill
    calendar (month grid by the household's week start, paid / upcoming / overdue / skipped colours,
    paydays marked, `[` `]` `t`, a list on phones, a detail panel with Mark paid / Skip / Unskip);
    Mark paid opens the paying account's ledger with the entry row prefilled and links on Enter; a
    ledger save that looks like a bill payment offers a Link toast; the dashboard's Upcoming bills card.
  - Tests: 356 backend (+28 API, +34 domain), 130 frontend (+14), 3 E2E (+1: add a subscription from
    the keyboard, see it on the calendar with the payday marked, Mark paid through the ledger, and find
    the committed amount in the planner, with no document load).
- **Deviations from plan:**
  - `transactions.subscription_occurrence_id` (deferred by D-044) was not added; the occurrence's own
    `transaction_id` is the single link (D-067).
  - Added `POST /bills/{id}/reopen` (undo a skip, or mark a payment unpaid) and `GET /bills/{id}` for the
    Mark paid prefill.
  - Found by the tests: a same-day price change overwrote the history row instead of recording it, and
    creating a subscription dropped the schema defaults (frequency, status) — both fixed.
- **Known issues:**
  - Auto-post and reminders are stored but not acted on until the Phase 9 daily job.
  - Bills are only materialized from today forward: a subscription added mid-cycle has no row for a
    due date already past.
  - Another household member's change shows after the 30-second query staleness or a reload of that
    view, not instantly.
- **Next step:** Plan Phase 9 (daily job and ntfy).

### 2026-09-24 — Phase 7 (Deploy the MVP to the Proxmox LXC)
- **Done:**
  - `pb backup` and `pb list-backups` (D-059): online-API database copy with an integrity check, a
    receipts tarball with the same timestamp, atomic writes, pruning by `PB_BACKUP_KEEP_DAYS` that
    always keeps the newest pair. `backup_keep_days` is in the config.
  - `deploy/backup.sh` (a backup now) and `deploy/restore.sh` (D-061): check first, confirm, stop,
    keep the current data as `.pre-restore`, swap in, migrate forward, start, health check, and put
    everything back on any failure.
  - `install.sh` warns when the CT is still on UTC; the nightly backup timer is now enabled on install
    because its command exists. The daily timer still waits for Phase 9.
  - `deploy/README.md`: NPM proxy host settings, the Proxmox firewall rules (D-060), backups, restore,
    reboot, and every script option. `deploy/GO-LIVE.md`: the first deployment for
    `payday.h-dungeon.com` behind NPM at `10.10.20.98`, one section per "Done when" box.
  - `docs/DEPLOYMENT.md` brought in line: backup file names, the integrity check, restore's check-first
    and put-back steps, and the firewall choice.
  - Tests: 294 backend (+15: 10 backup, 5 that run `restore.sh` for real — a round trip onto a changed
    install, a bare file name, an older schema migrated forward, a corrupt backup refused, and a failed
    migration rolled back), 108 frontend, 2 E2E.
  - Checked off the box: `shellcheck` clean on every script, `systemd-analyze verify` finds nothing but
    the missing `/opt` binaries, and the GO-LIVE §6 scratch restore ran as a real non-root `payday`
    user via `runuser`.
- **Deviations from plan:**
  - None of the four boxes is ticked: each needs the real CT, NPM or systemd (D-062).
  - Found by the tests: `restore.sh` exited silently (status 2) when the systemd unit was missing,
    because of `pipefail` in the port lookup, and its roll-back trap did not fire inside functions
    without `set -E`. Both are fixed.
- **Known issues:**
  - A failed nightly backup only shows in `journalctl -u payday-budget-backup` until Phase 9 adds the
    ntfy alert.
  - `install.sh` and `update.sh` have not been run end to end yet; the go-live run is their first.
  - Backups sit on the same disk as the database; vzdump of the CT is the off-box copy.
- **Go-live (reported by the user, 2026-09-24):** live at `https://payday.h-dungeon.com` behind NPM
  (`10.10.20.98`), Proxmox firewall rules in place, back after a reboot, nightly backup and the
  scratch restore both worked, and `update.sh` ran clean. All four boxes ticked. The firewall steps
  now say that the net0 dialog shows `eth0` and that a CT rule leaves Interface and Destination
  empty — both came up during setup.
- **Next step:** Plan Phase 8 (subscriptions and bill calendar).

### 2026-09-24 — Phase 6 (Budget planner and dashboard)
- **Done:**
  - Migration `0006` adds `period_plans` (unique per period and category, `planned_cents ≥ 0`, cascade
    from both the period and the category).
  - `app/domain/budget.py` is pure: the Actual sign rules, remaining, overspent, integer proration, and
    the summary header.
  - `app/services/budget.py`: lazy prefill from the template, actuals from one grouped query over
    on-budget splits, single and bulk edits, copy last period, apply template, clear, prorate, and the
    uncategorized count. Plan rows follow a category through delete-with-reassignment.
  - Endpoints: `GET /budget/current`, `GET /budget/{period}`,
    `PUT /budget/{period}/categories/{category}`, `PUT /budget/{period}/plan`,
    `POST /budget/{period}/{copy-previous|apply-template|clear|prorate}`, `GET /dashboard`, and an
    `on_budget` filter on `GET /transactions`.
  - Planner at `/budget` and `/budget/:periodId`: the summary header (expected income, planned, left to
    plan, spent, remaining), the income and expense sections by group with subtotals, Planned / Actual /
    Remaining with progress bars, overspent rows in red, inline planned amounts (Tab/Enter down, Esc
    reverts, amount math works), the four actions with Undo, the uncategorized alert linking to a
    filtered ledger, and period navigation by button or `[` `]` `t`.
  - Dashboard: the current period's numbers, the five most overspent categories, account balances,
    the ten most recent transactions, and an upcoming-bills placeholder.
  - Ledger mutations now mark the budget and dashboard stale, so actuals are right when you switch over.
  - Tests: 279 backend (+41: 15 domain, 26 API), 108 frontend (+10), 2 E2E (+1: plan an amount from
    the keyboard with the server held back, check the totals moved before it answered, walk the periods,
    and follow the uncategorized link — all without a document load).
- **Deviations from plan:**
  - The five open money questions were answered with the user before building (D-054 to D-057).
  - Added `PUT /budget/{period}/plan` (bulk set) as the Undo path for the whole-plan actions; the plan
    listed only the single-category edit.
  - The dashboard's recent transactions show a dash for a transaction with no payee.
- **Known issues:**
  - Sinking-fund categories reset each period like the rest; their carryover arrives in Phase 13.
  - Subscription bills are not in the prefill yet, and the "committed bills" hint is missing — Phase 8.
  - Dashboard and planner render every visible category; with the starter set that is a long page.
    Collapsing groups can wait for Phase 16 polish.
  - `GET /budget/*` walks the category tree once per request; fine at household scale.
- **Next step:** Plan Phase 7 (deploy the MVP to the LXC).

### 2026-09-24 — Phase 5 (Ledger UI and fast entry)
- **Done:** (built in one go rather than as 5a/5b, at the user's request)
  - Pure helpers with tests: `lib/dates.ts` (`t`, `+`/`-`, `15`, `3/15`, full dates, impossible dates
    refused), `lib/amountExpr.ts` (exact BigInt fractions, `+ - * /` and brackets, rounded half away
    from zero once at the end), `lib/fuzzy.ts`, `features/ledger/draft.ts` (entry row → API call, with
    the field to focus on any error) and `features/ledger/ledgerCache.ts` (optimistic insert, replace,
    remove, running balances, balances).
  - Keyboard primitives in `src/components/`: `DateInput`, `AmountInput`, `Combobox` (Tab/Enter pick,
    two-step Esc, "Create 'X'", grouped categories, pinned "Split…"), and `useRowNavigation`.
  - The ledger at `/transactions` (All accounts, with an Account field first) and
    `/transactions/:accountId`: account tabs with balances, the pinned entry row with the SPEC §7 tab
    order, payee create-on-save, category autofill (pinned default, else last used), optional
    last-amount prefill, Outflow/Inflow exclusivity and the leading `+`, the split editor with a live
    remaining amount that carries the leftover into a new line, transfers by typing
    "Transfer: Savings", inline edit (Enter/Esc), `j`/`k`/arrows, `c`, Delete with a 5-second Undo
    (and `u`), `n`, `/`, the `?` overlay, the filter bar (text, dates, category, payee, status, amount
    range) with a filtered total, and a virtualized list that loads older pages as it scrolls.
  - Every mutation is optimistic: the row and balances change at once, the server's rows and balances
    replace them, and an error restores the snapshot, refills the row as typed, and shows a toast.
    Reconciled edits and deletes ask for confirmation and retry with `confirm=true`.
  - Backend: payees carry `last_category_id` / `last_amount_cents` (D-049) and every transaction carries
    `transfer_account_id` (D-050). No migration.
  - The Accounts page shows real balances and links each account to its ledger.
  - Playwright: `make e2e` builds the SPA and runs it against a throwaway database (`e2e/serve.sh`).
    The one test enters 10 transactions from the keyboard (3 payees, one new; a split; a transfer; a
    refund), checks balances on screen and on the server, forces a 500 and checks the rollback and
    refill, then edits, clears, deletes and undoes — and asserts there was no document request, only
    fetch/XHR, and that the page never reloaded.
  - Tests: 238 backend (+4), 98 frontend (+68, including 13 Testing Library tests of tab order and the
    entry row's keys), 1 E2E.
- **Deviations from plan:**
  - Built as one phase instead of 5a/5b, as asked.
  - The keyboard details the spec left open are recorded in D-053, among them `t` always meaning today,
    Esc on an empty row stepping out of it, and `u` for undo.
  - Found by the E2E test: the always-visible "Split…" option became the only, highlighted choice after
    a category typo, so Tab quietly split the row. Pinned options now filter like the rest.
  - Found by the E2E test: moving focus to Inflow on a leading `+` a tick late let the next keystroke land
    in Outflow. Existing fields are now focused synchronously.
- **Known issues:**
  - Undoing the delete of a transfer that crosses the budget boundary needs the category, which only the
    on-budget leg carries. Undo from that leg's ledger works; from the tracking account's ledger (for
    example the car loan) the server refuses the re-create and a toast says why.
  - The payee list now runs three small queries per payee (usage, newest transaction, its splits). Fine
    for a household; worth one grouped query alongside `GET /balances` in Phase 16.
  - Changing a transaction into a transfer (or back), or a transfer's partner account, means delete and
    re-enter (D-053).
  - Combobox dropdowns in an inline-edit row near the bottom of the list scroll with the list rather than
    floating above it.
  - The E2E test needs a Chromium: `npx playwright install chromium` on the dev machine, or
    `PB_CHROMIUM_PATH`. It is not part of `make test`.
- **Next step:** Plan Phase 6 (budget planner and dashboard).

### 2026-09-23 — Phase 4 (Transactions backend)
- **Done:**
  - Migration `0005` adds `transactions` and `transaction_splits`, with the status CHECK, the
    `(account_id, date)`, `(date)` and `(transfer_id)` indexes, and cascade delete from a transaction to
    its splits.
  - `app/domain/money.py` mirrors `frontend/src/lib/money.ts`: same round-half-away-from-zero rule, same
    test cases, plus accounting parentheses for the CSV import in Phase 10.
  - Transactions and splits: one split for a plain transaction, several for a split one, and
    `SUM(splits) == amount_cents` enforced on every write. A zero split is refused. Changing the amount of
    a single-split transaction carries its split with it.
  - Transfers: one call writes both legs with a shared `transfer_id` (D-041). Editing either leg moves
    both; deleting either deletes both. The on-budget rule decides which leg carries a split (D-042).
  - Balances: current, cleared, reconciled and as-of a date, straight from the sign convention, so
    liability balances come out negative without a special case. Manual-valuation accounts use their
    typed balance instead (D-040).
  - Ledger: cursor pagination on `(date, id)`, filters for account, date range, payee, category, status,
    amount range, free text and uncategorized, a running balance for single-account views (D-038), and a
    filtered total.
  - Bulk set-status, set-category (collapsing splits) and delete, the last handling a selection that
    contains both legs of a transfer without double-counting.
  - Every mutation response carries the balances it changed, so the UI will not need a refetch.
  - The Phase 3 registries have real implementations now: payee merge moves transactions, category delete
    moves splits, and payee usage stats are a real query (D-043).
  - Endpoints: `GET|POST /transactions`, `GET|PATCH|DELETE /transactions/{id}`, `POST /transfers`,
    `POST /transactions/bulk/{status,category,delete}`, `GET /balances`,
    `GET /accounts/{id}/balance?as_of=`.
  - Tests: 234 backend (25 transactions, 19 ledger, 7 reassignment, 25 money), 30 frontend.
- **Deviations from plan:**
  - Reconciled protection covers amount, date, account and delete, not every field — SPEC §6's narrow
    list, confirmed with the user (D-039). A memo or category fix needs no confirmation.
  - Five columns DATA_MODEL lists on `transactions` are deferred to the phases that create the tables
    they point at (D-044).
  - `net_worth()` was written into the balances service and then removed: it belongs to Phase 14.
  - Found while running the full suite: `tests/api/test_payees.py` registered stub handlers under the
    real names "transactions", "subscriptions" and "rules", then popped them on the way out — removing
    the genuine transactions handler for every test that ran afterwards. Two tests passed alone and
    failed together. The conftest now snapshots and restores the registries around every test (D-043).
  - Pydantic would not accept `date: date` inside a model whose field is also called `date`; the
    schemas use `datetime.date` explicitly.
- **Known issues:**
  - The Phase 3 box "merging moves transactions, subscriptions, and rules" is now two-thirds open:
    transactions are proven, subscriptions and rules wait for Phases 8 and 10.
  - No UI this phase — the ledger screen is Phase 5. The Accounts page still shows opening balances
    rather than the real ones, which Phase 5 wires up.
  - `GET /balances` walks every account one at a time. Fine for a household; worth a single grouped
    query if an account list ever gets long.
  - An automated security review flagged the transaction endpoints as IDOR (missing per-user ownership
    scoping). It does not apply: SPEC §1 and §17 give every household member full access to one shared
    budget, no model carries an owner, and SPEC §19 puts multiple households out of scope. Every flagged
    endpoint returns 401 to an anonymous caller through the router-level dependency (D-021), verified by
    test and by request. Expect the same finding on every future phase that adds an endpoint. If a
    read-only household member is ever wanted, that is a feature with a schema change behind it, not a
    fix.
- **Next step:** Plan Phase 5 (ledger UI and fast entry) — the core screen.

### 2026-09-23 — Phase 3 (Accounts, categories, payees)
- **Done:**
  - Migration `0004` adds `accounts`, `account_valuations`, `category_groups`, `categories` and `payees`,
    with nocase-unique names, the nine-type and valuation-mode CHECKs, and `(group_id, name)` unique per
    group.
  - Accounts: CRUD, close and reopen (history is kept, the account just leaves the entry lists), reorder,
    debt fields with APR in basis points (D-034), and dated manual valuations, one per account per day.
    `on_budget` defaults from the type per SPEC §3 and can be overridden.
  - Categories: groups and categories, hide, sinking-fund flag, default planned amount, and keyboard
    reorder through `app/domain/ordering.py` (pure). Delete refuses while a category is in use and takes
    a reassignment target.
  - Payees: alphabetical nocase list with search, rename, merge, pinned default category, hide, and
    usage-stat plumbing that Phase 4 fills in (D-032). A rename onto an existing name returns 409 with
    both names so the UI can offer the merge (D-033).
  - `app/services/references.py` is the registry that later phases plug into for merge and
    delete-with-reassignment (D-031).
  - CLI: `pb seed-categories` and `pb list-categories`. The same starter set is offered in the UI on an
    empty Categories page — 8 groups, 26 categories, with Repairs, Maintenance, Gifts and the three
    Savings categories pre-flagged as sinking funds.
  - UI: Accounts page (opening balances only; real balances are Phase 4), Categories manager under
    Settings with Alt+↑/↓ reorder, and the Payees page with search, inline rename on Enter/Esc, and the
    merge offer.
  - `frontend/src/lib/money.ts` formats and parses integer cents at the UI edge.
  - Tests: 158 backend (13 accounts, 16 categories, 17 payees, 10 ordering), 30 frontend.
- **Deviations from plan:**
  - Categories sit under Settings rather than in the sidebar, matching SPEC §17 and leaving the nine
    sidebar items from Phase 0 alone (D-036).
  - Found while writing the money tests: parsing `1.005` through `Math.round(value * 100)` returns 100
    cents, not 101, because the product is 100.49999999999999. Parsing now reads the digit string
    directly (D-037). This is the bug the integer-cents rule exists to prevent, and it would have been
    invisible until a real amount landed on the edge.
  - Added `pb list-categories`, which the phase did not list, to check a seed without opening the UI.
- **Known issues:**
  - "Merging moves transactions, subscriptions, and rules" stays unticked until Phases 4, 8 and 10
    register their handlers. The merge itself, and the registry it iterates, are tested with stubs.
  - Payee usage columns show zero and "never" for every payee until Phase 4.
  - Account balances are not shown; the page lists opening balances only, as the phase intends.
  - The browser click-through is still unverified across all three phases: the Chrome extension has
    stayed disconnected since Phase 0. Verified over HTTP instead — seeding produced 8 groups and 26
    categories, four Alt+Up presses walked Phone to the top of Utilities and a fifth correctly did
    nothing, and renaming "Kroger Fuel Center" to "KROGER" returned the merge offer, which then collapsed
    the two payees into one.
- **Next step:** Plan Phase 4 (transactions backend).

### 2026-09-22 — Phase 2 (Pay schedule engine)
- **Done:**
  - Migration `0003` adds `pay_schedules` and `pay_periods`, with CHECK constraints on the frequency and
    weekend-rule enums, a unique `effective_from`, a unique `start_date`, and the `(start_date, end_date)`
    index.
  - `app/domain/pay_periods.py` is pure: no database, no clock. Pay dates per frequency, the month-end
    clamp, the weekend rules, contiguous period building, `period_for_date`, and `pay_dates_through`.
    Dates are computed from the configuration rather than from the previous date, so nothing drifts
    (D-028).
  - Service: generates ~13 months ahead, extends lazily once the timeline comes within 120 days of its
    end (D-030), and applies a change by keeping past periods, ending the period in progress the day
    before the new first pay date, flagging it as a transition, and rebuilding everything after it.
  - Endpoints: `GET /pay-schedule` (current + history), `POST /pay-schedule/preview` (writes nothing),
    `POST /pay-schedule`, `GET /pay-periods?from=&to=`, `GET /pay-periods/current`.
  - UI: Settings gains Pay schedule (form with a live six-period preview, transition warning, and
    schedule history) and Pay periods (the full timeline with transition and current markers).
  - Tests: 38 domain, 15 API, 10 frontend. All five "Done when" cases are covered, including the property
    test that walks three years a day at a time for seven different schedules.
- **Deviations from plan:**
  - Two rules the spec left open were decided with the user: skip a weekend shift that would reorder pay
    dates (D-026), and allow a change to reach back into the period in progress but no further (D-029).
  - Found while testing: semimonthly on the 30th and 31st produces two identical dates every February.
    The duplicate is now dropped so the month has one pay date (D-027). Nothing in the spec covers it.
  - "Business day" is Monday to Friday with no holiday calendar (D-025).
  - The Pay period history lives as a Settings tab rather than a sidebar entry, so the nine sidebar items
    from Phase 0 stay as specified.
- **Known issues:**
  - The browser click-through is still unverified — the Chrome extension stayed disconnected for this
    session too. Verified over HTTP instead against the built SPA: preview, commit, current period, and a
    mid-period change from biweekly to monthly-on-the-1st, which produced a 6-day transition period and a
    contiguous timeline, with 2026-11-01 (a Sunday) correctly paid on 2026-10-30.
  - `ensure_horizon()` only runs when periods are listed. Until the Phase 9 daily job calls it, a household
    that never opens the pay-periods screen could let the timeline age.
- **Next step:** Plan Phase 3 (accounts, categories, payees).

### 2026-09-22 — Phase 1 (Auth, users, settings)
- **Done:**
  - Migration `0002` adds `users`, `sessions`, and `settings`, and seeds the settings singleton (id = 1).
  - argon2id hashing via argon2-cffi, with transparent rehash when parameters change (D-018).
  - Sessions: random token in an HttpOnly / SameSite=Lax cookie (Secure in production only), sha256 of the
    token stored, 30-day sliding expiry refreshed on each request, expired rows deleted on use.
  - `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`; `GET|POST /users`, `PATCH /users/{id}`,
    `POST /users/{id}/password`; `GET|PATCH /settings`.
  - Everything except health and auth sits behind one router-level dependency that checks the session and
    the `X-PB-Request` header together, so new routers are protected by default (D-021).
  - Login rate limiting: 5 failures per 15 minutes per username and per IP, in-memory with an injected
    clock (D-023). A successful login clears the count.
  - Guard rails: no disabling yourself, no disabling the last active user (D-020). Disabling someone or
    resetting their password ends their sessions (D-022).
  - CLI: `pb create-user`, `pb reset-password`, `pb list-users`, plus `pb enable-user` for recovering from
    a disable without the UI. Passwords are prompted, never passed as arguments.
  - Frontend: login page (no native submit), route guard remembering the attempted path, user menu with
    sign-out, Settings split into General and Users tabs, toast component, and a query client that never
    retries a 401.
  - Tests: 49 backend (login success/failure, lockout, 401, CSRF rejection, session expiry and sliding,
    logout, user guards, session revocation, settings validation, password policy, rate limiter) and
    9 frontend.
- **Deviations from plan:**
  - Password policy and the disable guard rails were confirmed with the user mid-plan: 12-character
    minimum, no composition rules; both guard rails on (D-019, D-020).
  - Added `pb enable-user`, which the phase did not list, because the CLI was otherwise a one-way door
    out of a disabled account.
  - `starlette.status.HTTP_422_UNPROCESSABLE_ENTITY` is deprecated in starlette 1.6; `errors.py` now uses
    `HTTP_422_UNPROCESSABLE_CONTENT`.
- **Known issues:**
  - The browser click-through of the login form has not been run: the Chrome extension disconnected
    partway through the session. Verified instead with curl against the built SPA on :8000 — a
    CLI-created user logs in, the cookie comes back HttpOnly/SameSite=Lax with no Secure flag in
    development, an authenticated `GET /settings` succeeds, a mutation without `X-PB-Request` is refused
    with 403, logout returns 204, and the session row is gone afterwards.
  - Sessions are only cleaned up when a caller presents an expired cookie. A sweep belongs with the daily
    job in Phase 9; `purge_expired_sessions()` already exists for it.
  - The theme setting is stored but not yet applied to the UI; wiring it up belongs with polish (Phase 16).
- **Next step:** Plan Phase 2 (pay schedule engine).

### 2026-09-22 — Phase 0 (Scaffold and tooling)
- **Done:**
  - Repo initialised and pushed to https://github.com/alreadyded1/Budget (`main`).
  - Dev machine prepared: Python 3.13.13 via uv, Node 24.21.0 LTS unpacked to `~/.local/node` (D-012).
  - Backend: uv project with pinned deps; app factory in `app/main.py`; `GET /api/v1/health` returning
    version, env and DB status; `app/config.py` reading `PB_*` with dev defaults under `backend/var/`;
    `app/db.py` applying the four SQLite pragmas on every connection; shared JSON error shape in
    `app/errors.py`; empty `models/schemas/services/domain/jobs` packages; Typer `pb` CLI with
    `version` and `info`.
  - Alembic configured in batch mode with the empty `0001_initial_empty` revision; `make migrate` works.
  - Frontend: Vite + React 19 + TS, Tailwind v4, React Router, TanStack Query; app shell with the nine
    sidebar routes and placeholder pages; live health badge in the sidebar footer; `/api` proxied to :8000.
  - FastAPI serves `frontend/dist` with an SPA fallback; verified in a browser that `/reports` deep-links
    on :8000 with the badge reading "API online".
  - Makefile: dev, test, lint, fmt, migrate, build, plus install/clean and per-side variants.
  - Sample tests both sides: 3 pytest (health, JSON 404 shape, pragmas), 5 vitest (health state helpers).
- **Deviations from plan:**
  - The Vite template now ships oxlint; replaced with ESLint + Prettier to match ARCHITECTURE.md (D-013).
  - `httpx2` instead of `httpx` as the test-client dependency, required by starlette 1.6 (D-014).
  - Error handlers bind Starlette's `HTTPException` so unmatched routes also return `{"detail","code"}`
    (D-015).
  - `strict: true` added to both tsconfigs; the template omitted it.
- **Known issues:**
  - `make` targets need Node on PATH. New shells get it from `~/.zshrc`; an existing shell needs a reload.
  - Vite binds to `localhost` (IPv6 `::1`), so `http://127.0.0.1:5173` is refused while
    `http://localhost:5173` works. The backend on :8000 listens on IPv4.
  - `pytest` ignores one upstream DeprecationWarning from starlette's use of `anyio.abc.BlockingPortal`;
    remove the filter in `backend/pyproject.toml` once starlette fixes it.
- **Next step:** Plan Phase 1 (auth, users, settings).

## Parking lot
<!-- Ideas or work found mid-phase that belongs to a later phase. -->
- Expired-session sweep inside `pb run-daily` — Phase 9.
- ntfy alert when the nightly backup fails (`OnFailure=` on the backup unit) — Phase 9.
- Auto-post of due bills and bill reminders (`remind_days_before`) in `pb run-daily` — Phase 9.
- Extend subscription occurrences from the daily job too, not only on read — Phase 9.
- `ensure_horizon()` should also run from the daily job so the timeline never ages — Phase 9.
- Register rules with `app/services/references.py` — Phase 10 (transactions and subscriptions done).
- Group `GET /balances` into one query if the account list ever grows — Phase 16.
- Group the payee usage and autofill queries into one query for the payee list — Phase 16.
- Extend the E2E suite beyond the ledger and planner flows — Phase 16 (ARCHITECTURE §Testing).
- Sinking-fund carryover in the planner — Phase 13.
- Collapsible groups on the planner — Phase 16.
- Transaction columns deferred to their own phases: import_batch_id and import_key (10),
  reconciliation_id (11). subscription_occurrence_id is not needed (D-067).
- ntfy settings UI and the runtime HTTP client choice — Phase 9.
- Apply `theme_default` (and a per-browser override) to the UI — Phase 16.
- First-run onboarding wizard (pay schedule → accounts → categories) — SPEC §17, after Phase 3.
- A "session list / sign out everywhere" screen was not asked for; note it if it ever comes up.

## Known issues
<!-- Open bugs and limitations that aren't tied to the current phase. -->
- None outside the per-phase notes above.
