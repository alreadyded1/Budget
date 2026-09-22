# Build Plan

Each phase is sized for one Claude Code session. Work through them in order.

**Session rhythm**
- Start: "Read CLAUDE.md and docs/PROGRESS.md, then plan Phase N from docs/BUILD_PLAN.md."
- Approve the plan, let it build, and run the app yourself.
- End: "Wrap up the session per CLAUDE.md."
- Start the next phase in a fresh session (or after `/clear`) so context stays clean.
- If a phase runs long, split it (e.g. 5a / 5b) and note the split in PROGRESS.md.

The MVP you can use every day is ready after **Phase 7**.

---

## Phase 0 — Scaffold and tooling
**Goal:** an empty but runnable app with all tooling in place.
- Repo layout per ARCHITECTURE.md. The backend is a uv project with a FastAPI app factory and
  `GET /api/v1/health`, which returns the version and DB status.
- DB engine with the SQLite pragmas. Alembic configured (batch mode) with an initial empty migration.
- `app/config.py` reads `PB_*` settings: `PB_ENV`, `PB_DATA_DIR`, `PB_DATABASE_PATH`, `PB_SECRET_KEY`, and
  `PB_BASE_URL`. Dev defaults go in `backend/var/`.
- Frontend:
  - Vite + React + TS, Tailwind, React Router, TanStack Query.
  - App shell with sidebar: Dashboard, Budget, Transactions, Accounts, Subscriptions, Calendar, Reports,
    Payees, Settings. Placeholder pages.
  - Vite dev proxy sends `/api` to :8000.
- FastAPI serves `frontend/dist` with an SPA fallback when that folder exists.
- Makefile targets: dev, test, lint, fmt, migrate, build.
- One sample test each in pytest and Vitest. ruff, eslint, prettier, and tsc configured.
- `.gitignore` covers `.venv`, `node_modules`, `dist`, `*.db*`, `backend/var/`, and env files.
- Pin dependency versions and record them in DECISIONS.md.

**Done when**
- [ ] `make dev` runs both servers, and the UI shell shows the health status from the API.
- [ ] `make test` and `make lint` pass.
- [ ] After `make build`, uvicorn alone serves the UI on :8000, and deep links like `/reports` load.
- [ ] There are no Docker-related files anywhere in the repo.

## Phase 1 — Auth, users, settings
- Tables: users and sessions. argon2id hashing.
- Endpoints `POST /auth/login`, `POST /auth/logout`, and `GET /auth/me`.
- Auth dependency on every route except login and health.
- `X-PB-Request` header check on mutations. Login rate limiting.
- Settings singleton with `GET` and `PATCH /settings`.
- CLI: `pb create-user`, `pb reset-password`, `pb list-users`.
- Frontend:
  - login page and route guard
  - user menu with logout
  - Settings → Users page: add, disable, reset password
  - Settings → General page

**Done when**
- [ ] Tests cover login success and failure, lockout after 5 failures, 401 on protected routes, CSRF header
      rejection, and session expiry.
- [ ] A user created with the CLI can log in through the UI. Logging out clears the session server-side.

## Phase 2 — Pay schedule engine
- Tables: pay_schedules and pay_periods.
- Pure functions in `app/domain/pay_periods.py`:
  - pay dates for each frequency, month-end clamp, weekend rules
  - building contiguous periods
  - `period_for_date`
- Service:
  - generate periods about 13 months ahead
  - apply a schedule change: keep past periods, close the current one the day before the new first pay
    date, mark the transition, regenerate future periods
- Endpoints:
  - get the schedule and its history
  - preview a change
  - commit a change
  - list periods by range
  - get the current period
- UI: Settings → Pay schedule with a live preview of the next 6 periods, and a Pay period history page.

**Done when**
- [ ] Monthly on the 31st gives Jan 31, Feb 28 (29 in leap years), Mar 31, Apr 30.
- [ ] Semimonthly 15 & 31 clamps correctly. Weekend rules shift the dates correctly.
- [ ] Biweekly across a year boundary produces the correct count (26 or 27 per year).
- [ ] A schedule change mid-period leaves the timeline contiguous and flags the transition period.
- [ ] Property test: every date in a 3-year span maps to exactly one period.

## Phase 3 — Accounts, categories, payees
- CRUD for accounts, including close/reopen, debt fields, and valuation mode.
- CRUD for category groups and categories: keyboard reorder, hide, sinking fund flag, default planned amount,
  delete with reassignment.
- Payees:
  - alphabetical (nocase) list with search
  - inline rename (Enter/Esc)
  - merge
  - pinned default category
  - hide
  - usage stats
- `pb seed-categories` and a first-run offer of the starter category set.
- UI: Accounts list (balances come later), Categories manager, Payees page.

**Done when**
- [ ] Renaming a payee to a name that exists in any casing triggers the merge offer. The DB enforces
      nocase uniqueness.
- [ ] Merging moves transactions, subscriptions, and rules. Tests prove it.
- [ ] Categories can be reordered using only the keyboard.

## Phase 4 — Transactions backend
- Services for transactions, splits, and transfers:
  - split-sum validation
  - paired transfer create, update, and delete
  - category rules for on-budget ↔ tracking transfers
- Balances service: current, cleared, reconciled, and as-of a date. Respects liability signs.
- Ledger query:
  - running balance
  - cursor pagination
  - filters: account, date range, payee, category, status, amount range, text
- Bulk operations: set category, set status, delete.
- Mutation responses include updated balances.
- Editing a reconciled transaction returns 409 unless `confirm=true`.

**Done when**
- [ ] Tests cover split sums, transfer integrity (editing or deleting one leg affects both), running balances,
      liability signs, and reconciled-edit protection.
- [ ] Uncategorized splits are queryable (used later for alerts).

## Phase 5 — Ledger UI and fast entry (core screen)
Build SPEC §7 completely. Split into 5a/5b if needed.
- **5a:**
  - `DateInput`, `AmountInput` (with math), `Combobox`
  - the entry row with its tab order
  - payee create-on-save and category autofill
  - optimistic save with rollback
  - focus returns to Payee with the date kept
  - account ledger and All accounts ledger
- **5b:**
  - inline edit of existing rows
  - row navigation (arrows / j,k)
  - cleared toggle
  - delete with undo
  - split editor
  - transfer entry
  - search/filter bar
  - virtualized list
  - `?` shortcut overlay
- Add Playwright with one E2E test of the full keyboard flow.

**Done when**
- [ ] 10 transactions (3 payees, one of them new, 1 split, 1 transfer) can be entered without touching the
      mouse.
- [ ] The E2E test asserts there is no document navigation. Network activity is fetch/XHR only.
- [ ] Balances update instantly. A forced server error rolls back and restores the entry row.
- [ ] Unit tests pass for the date shortcut and amount parsers, including edge cases.

## Phase 6 — Budget planner and dashboard
- period_plans.
- Planner:
  - income and expense sections
  - Planned / Actual / Remaining with progress bars
  - inline tab-through editing of planned amounts
  - summary header
  - Copy last period / Apply template / Clear
  - Prorate for transition periods
  - uncategorized alert
  - overspent highlighting
  - period navigation
- Dashboard: current period summary, most overspent categories, account balances, recent transactions,
  and an upcoming-bills placeholder.

**Done when**
- [ ] Actuals match ledger totals in tests, and transfers are excluded correctly.
- [ ] Editing a planned amount updates Remaining and the summary instantly.
- [ ] New periods prefill from the template.

## Phase 7 — Deploy the MVP to the Proxmox LXC
Implement DEPLOYMENT.md.
- `deploy/install.sh` (idempotent), `update.sh`, `backup.sh`, `restore.sh`
- systemd units and timers
- env example file
- NPM notes
- `pb` on the PATH for admin tasks

**Done when**
- [ ] One script takes a fresh Debian 13 LXC to a running app, reachable over HTTPS through NPM.
- [ ] The app comes back after an LXC reboot.
- [ ] The nightly backup produces a DB copy and a receipts archive, and restoring onto a scratch copy works.
- [ ] `update.sh` backs up, migrates, rebuilds, restarts, and runs a health check.

## Phase 8 — Subscriptions and bill calendar
- Subscriptions CRUD and price history.
- Occurrence generator: a pure function plus 13-month materialization. Future unpaid occurrences are
  regenerated on edit.
- Payment matching suggestion when a transaction is saved. Mark paid (opens the prefilled entry row). Skip.
- List view with monthly-equivalent and annual totals.
- Bill calendar month view with pay dates marked, plus a phone list view.
- Planner integration: committed amounts appear in the plan and in prefill.
- Dashboard upcoming-bills widget.

**Done when**
- [ ] Tests pass for monthly on the 31st, annual, and custom every-6-weeks schedules. Edits never touch paid
      occurrences.
- [ ] The planner shows committed bill amounts per category for the period.

## Phase 9 — Daily job and ntfy
- `pb run-daily`:
  - extend periods and occurrences
  - auto-post due subscriptions
  - send due reminders, overdue notices, and low-balance alerts
- All sends are deduplicated through `notification_log`.
- ntfy client with priority, tags, and a click URL into the app.
- Settings → Notifications: configuration, Send test, and a log viewer.
- Add the `payday-budget-daily` service and timer to `deploy/systemd/`.

**Done when**
- [ ] Running the job twice in one day sends nothing new (test with a mocked ntfy).
- [ ] An auto-posted subscription creates exactly one transaction and marks its occurrence paid.

## Phase 10 — Import and rules
- CSV profiles with a mapping UI.
- OFX/QFX parsing.
- Staged review screen:
  - inline payee and category edits
  - duplicate flags
  - match suggestions
  - "Create rule from this"
- Commit and undo import. Import history.
- Rules manager: ordered list, test a rule against past imports.

**Done when**
- [ ] Fixture files import correctly: 1 OFX, 1 QFX, 2 CSV layouts (single signed amount; debit/credit).
- [ ] Re-importing the same file flags every row as a duplicate.
- [ ] A manual entry is matched and cleared instead of duplicated.
- [ ] Undo removes exactly that batch.

## Phase 11 — Reconciliation
- The reconcile flow per SPEC §12, adjustment transactions, and reconciliation history.
- The ledger shows the reconciled status with a lock icon.

**Done when**
- [ ] Finishing is blocked until the difference is zero (or an adjustment is made).
- [ ] Reconciled transactions are protected per Phase 4.

## Phase 12 — Reports
- Backend date-range resolver: a pure function covering the presets, including pay-period presets.
- Report endpoints for SPEC §16.
- Reports section: filters, Recharts charts, drill-down to transactions, CSV export, print CSS.

**Done when**
- [ ] Report totals tie to ledger totals in tests.
- [ ] Presets resolve correctly on Jan 1, month-end, and inside a transition period.

## Phase 13 — Goals and sinking funds
- Savings goals and sinking funds per SPEC §13: required per-period contribution, on-track status,
  projected completion date, and "Use suggested contribution".
- The sinking fund balance appears on its category row in the planner.

**Done when**
- [ ] Sinking fund balance math is tested across several periods, including overspending.
- [ ] Regular categories still reset every period.

## Phase 14 — Net worth and debt payoff
- Net worth: current total, month-end history, breakdown by type. Manual valuation entries.
- Debt payoff simulator: pure function; snowball, avalanche, custom; side-by-side comparison;
  month-by-month schedule.

**Done when**
- [ ] The simulator matches a hand-checked amortization schedule to the cent for a single loan.
- [ ] The net worth history is correct when accounts are opened or closed mid-range.

## Phase 15 — Receipt attachments
- Upload endpoint: type and size checks, sha256, storage path, thumbnails (including HEIC).
- Authenticated download. Delete (removes the file too).
- UI: paperclip in the ledger, drag and drop, phone camera picker, preview lightbox.
- Backups include receipts.

**Done when**
- [ ] Unauthenticated requests can't fetch a receipt.
- [ ] Deleting a transaction removes its files.
- [ ] Uploads over the size limit are rejected cleanly (a 413 behind NPM is documented).

## Phase 16 — Polish and hardening
- First-run onboarding wizard (pay schedule → accounts → categories).
- Dark mode, mobile layouts, PWA manifest and icons.
- Accessibility pass: focus rings, labels, contrast.
- Empty states and error pages.
- Full JSON export.
- Performance: seed 100k transactions, then profile the ledger and reports and add indexes as needed.
- Extend the E2E suite: planner edit, import review, reconcile.

**Done when**
- [ ] The ledger scrolls smoothly and saves stay under 150 ms with 100k transactions.
- [ ] Lighthouse accessibility score ≥ 90 on the main screens.
