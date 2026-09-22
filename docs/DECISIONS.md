# Decisions

Short, dated entries. Newest last. Format: context → decision → consequence.

## D-001 No Docker
Deployment is a Proxmox LXC with systemd, native from day one. Containers add a layer this app doesn't need.
→ No Dockerfiles, compose files, or devcontainers. Deploy scripts target Debian 13 directly.

## D-002 SQLite instead of PostgreSQL
One household, a couple of concurrent users, and writes are small and infrequent.
→ SQLite in WAL mode with a single uvicorn worker. Backup is one file. Everything goes through SQLAlchemy,
so moving to Postgres later means changing settings and migrating the data, not rewriting code.

## D-003 Integer cents
Floats can't represent money exactly.
→ Every amount is an integer number of cents end to end. Parsing and formatting happen only at the UI edge.

## D-004 All categorization lives in splits
Keeps reporting to a single query path.
→ A normal transaction has one split and a split transaction has many. Transfers between on-budget accounts
have none. Reports read only from `transaction_splits`.

## D-005 Planned vs. actual, reset each period
The household chose planned-vs-actual budgeting per pay period, and unspent planned money does not
roll over.
→ Actuals are computed and never stored. **Exception:** categories flagged as sinking funds accumulate a
balance across periods, because that is what a sinking fund is.

## D-006 One shared pay schedule; periods by date only
The household has one pay schedule. A transaction belongs to the period containing its date, with no
manual reassignment. Periods are contiguous with no gaps.
→ Schedule changes create a new schedule row with an effective date. Past periods are never rewritten.

## D-007 FastAPI serves the SPA
→ One process, one systemd unit, one port. NPM handles TLS.

## D-008 Scheduled work via systemd timers
In-process schedulers misbehave with reloads and multiple workers, and hide failures.
→ Idempotent `pb` CLI commands run from systemd timers. Output goes to journald. Notifications are
deduplicated through `notification_log`.

## D-009 Sync SQLAlchemy sessions
Async buys nothing with SQLite and complicates tests.
→ `def` endpoints with sync sessions; FastAPI runs them in its threadpool.

## D-010 Bank data: manual entry plus file import
Auto-sync services are out of scope for v1.
→ CSV, OFX, and QFX import with rules, duplicate detection, and matching to manual entries.

<!-- Phase 0 adds: D-011 pinned dependency versions -->
