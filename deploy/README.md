# Deploy

Native install on a Debian 13 LXC under systemd. No containers, per D-001.

## First install

Create an unprivileged Debian 13 CT in Proxmox (2 vCPU, 2 GB RAM, 16 GB disk, start at boot),
set its timezone so "today" matches real life, then inside the CT:

```sh
timedatectl set-timezone America/Detroit

curl -fsSLO https://raw.githubusercontent.com/alreadyded1/Budget/main/deploy/install.sh
bash install.sh --base-url https://budget.example.com --trusted-proxy 10.0.0.5
```

`--trusted-proxy` is your NGINX Proxy Manager LXC's IP: uvicorn only trusts forwarded
headers from there. Both flags can be changed later in `/etc/payday-budget/payday-budget.env`.

Then create the first household member:

```sh
pb create-user you
```

`/usr/local/bin/pb` is a wrapper that loads the env file and runs as the `payday` user.
Calling `backend/.venv/bin/pb` directly skips the env file, so it would point at a
development database under `backend/var/` instead of the real one.

Point NPM at `http://<ct-ip>:8000` (scheme http, Block Common Exploits on, Force SSL), and
allow port 8000 only from the proxy's IP.

## Updating

```sh
bash /opt/payday-budget/deploy/update.sh
```

It backs the database up, builds the new version, and restarts **only** once the migration
has succeeded. If anything fails it rolls the checkout back to the commit that was running
and leaves the old service up.

## Options

| install.sh | |
|---|---|
| `--repo URL` | where to clone from (default: this repository) |
| `--ref BRANCH` | branch or tag to install (default: `main`) |
| `--source PATH` | install from a local directory instead of git, via rsync |
| `--base-url URL` | what `PB_BASE_URL` gets on a first install |
| `--trusted-proxy IP` | the proxy allowed to set forwarded headers |
| `--port N` | listen port (default 8000) |
| `--no-start` | install everything but do not start the service |

| update.sh | |
|---|---|
| `--ref BRANCH` | switch to a different branch or tag |
| `--source PATH` | update from a local directory instead of git |
| `--skip-backup` | skip the pre-update database backup |

## What is on the box

| Path | What |
|---|---|
| `/opt/payday-budget` | the checkout, `backend/.venv`, `frontend/dist` |
| `/etc/payday-budget/payday-budget.env` | settings and the secret key, `0640 root:payday` |
| `/var/lib/payday-budget/budget.db` | the database, owned by `payday` |
| `/var/lib/payday-budget/{receipts,backups}` | attachments and nightly backups |

Both scripts are safe to run again. Neither overwrites an existing env file or database.

## Timers

`payday-budget-daily.timer` (07:00) and `payday-budget-backup.timer` (02:30) are installed but
stay **disabled** until `pb run-daily` and `pb backup` exist, which is Phase 9. The next
`update.sh` after that phase enables them automatically.

`restore.sh` is not written yet; it arrives with Phase 7 alongside the rest of the deploy work.
Until then, a restore is: stop the service, copy a file out of `/var/lib/payday-budget/backups`
over `budget.db`, run `alembic upgrade head`, start the service.
