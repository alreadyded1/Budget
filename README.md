# Payday Budget

A self-hosted household budget built around your pay schedule.
- Planned vs. actual spending per pay period
- Fast keyboard transaction entry
- Subscriptions and bill calendar with ntfy reminders
- CSV/OFX/QFX import
- Reports, goals and sinking funds, net worth, debt payoff, receipt attachments

It runs natively on a Proxmox LXC (Debian 13 + systemd). No Docker.

## Building it with Claude Code
This repo starts as a spec plus a phased plan. Claude Code builds it one phase per session.

1. Unzip, then `cd payday-budget && git init && git add -A && git commit -m "docs: project framework"`.
2. Open Claude Code in the repo folder. It reads `CLAUDE.md` automatically.
3. Start each session with:
   > Read CLAUDE.md and docs/PROGRESS.md. Plan Phase N from docs/BUILD_PLAN.md and show me the plan before
   > writing code.
4. Review the plan, approve it, and let it build. Run `make dev` and try the feature yourself.
5. End each session with:
   > Wrap up the session per CLAUDE.md.

   This updates PROGRESS.md, ticks the done-criteria, logs decisions, and commits.
6. Start the next phase in a fresh session.

To change a requirement, edit `docs/SPEC.md` (and `DATA_MODEL.md` if it affects the schema) before the phase
that builds it. Add a line to `DECISIONS.md` if it reverses an earlier call.

## Docs
| File | What it's for |
|---|---|
| `CLAUDE.md` | Standing rules for every session: no Docker, money in cents, workflow |
| `docs/SPEC.md` | What the app does, feature by feature |
| `docs/DATA_MODEL.md` | Every table and invariant |
| `docs/ARCHITECTURE.md` | Stack, repo layout, patterns (optimistic updates, auth, jobs) |
| `docs/BUILD_PLAN.md` | Phases 0–16 with "done when" checklists |
| `docs/DEPLOYMENT.md` | LXC layout, systemd units, NPM, backups, update, and restore |
| `docs/PROGRESS.md` | Living status log that Claude Code updates each session |
| `docs/DECISIONS.md` | Why things are the way they are |

## Milestones
- **Phase 7**: daily-usable MVP on your LXC. Includes ledger, fast entry, budget planner, accounts, payees,
  and backups.
- **Phases 8–15**: subscriptions and calendar, ntfy, import, reconciliation, reports, goals, net worth,
  receipts.
- **Phase 16**: polish, mobile/PWA, performance.
