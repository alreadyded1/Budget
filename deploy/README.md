# Deploy

Native install on a Debian 13 LXC under systemd. No containers, per D-001. The layout these
scripts produce is specified in `docs/DEPLOYMENT.md`; the step-by-step first deployment for this
household is in [`GO-LIVE.md`](GO-LIVE.md).

## First install

Create an unprivileged Debian 13 CT in Proxmox (2 vCPU, 2 GB RAM, 16 GB disk, start at boot,
static IP or a DHCP reservation), set its timezone so "today" matches real life, then inside the
CT:

```sh
timedatectl set-timezone America/Detroit

curl -fsSLO https://raw.githubusercontent.com/alreadyded1/Budget/main/deploy/install.sh
bash install.sh --base-url https://budget.example.com --trusted-proxy 10.0.0.5
```

`--trusted-proxy` is your NGINX Proxy Manager LXC's IP: uvicorn only trusts forwarded headers
from there. Both flags can be changed later in `/etc/payday-budget/payday-budget.env`.

Then create the first household member:

```sh
pb create-user you
pb seed-categories        # optional: the starter category set
```

`/usr/local/bin/pb` is a wrapper that loads the env file and runs as the `payday` user.
Calling `backend/.venv/bin/pb` directly skips the env file, so it would point at a development
database under `backend/var/` instead of the real one.

## NGINX Proxy Manager

Add a **Proxy Host**:

| Tab | Setting |
|---|---|
| Details | Domain: your hostname · Scheme `http` · Forward to the CT's IP, port `8000` |
| Details | Block Common Exploits **on** · Websockets Support off (not needed) · Cache Assets off |
| SSL | Your certificate (Let's Encrypt, or DNS challenge if the name is LAN-only) · Force SSL · HTTP/2 |
| Advanced | Nothing yet. When receipt uploads arrive (Phase 15), add `client_max_body_size 20m;` |

The app sets its session cookie `Secure` in production, so it only works over the HTTPS name,
not `http://<ct-ip>:8000`. That is expected: the plain port is for the proxy and health checks.

## Firewall (Proxmox)

Port 8000 should only be reachable from the proxy. Use the Proxmox firewall on the CT:

1. **Datacenter → Firewall → Options**: Firewall = Yes. (Check first that the Datacenter rules
   still allow your own access to the Proxmox UI on 8006 and SSH to the host.)
2. **CT → Network → net0 → Edit**: tick **Firewall**.
3. **CT → Firewall → Add** these rules (direction `in`, action `ACCEPT`, enabled):

   | Proto | Dest. port | Source | Comment |
   |---|---|---|---|
   | tcp | 8000 | the NPM LXC's IP | proxy to the app |
   | tcp | 22 | your LAN CIDR | SSH from the LAN |
   | icmp | | your LAN CIDR | ping (optional) |

4. **CT → Firewall → Options**: Firewall = Yes, Input Policy = **DROP**, Output Policy = ACCEPT
   (apt, git and uv need to reach the internet).

Check from another machine on the LAN: `curl -m 3 http://<ct-ip>:8000/api/v1/health` should now
time out, while the HTTPS name still works.

## Updating

```sh
bash /opt/payday-budget/deploy/update.sh
```

It takes a backup, fetches and builds the new version, migrates, and restarts **only** once the
migration has succeeded, then checks health and prints the old and new versions. If anything fails
it rolls the checkout back to the commit that was running and leaves the old service up.

## Backups

`payday-budget-backup.timer` runs `pb backup` every night at 02:30 (`Persistent=true`, so a
night missed while the CT was off runs at the next boot). Each run writes a pair to
`/var/lib/payday-budget/backups/`:

- `budget-YYYYmmdd-HHMMSS.db`, a copy made with SQLite's online backup API (safe while the app
  runs) and checked with `PRAGMA integrity_check`
- `receipts-YYYYmmdd-HHMMSS.tar.gz`, the receipts folder

Pairs older than `PB_BACKUP_KEEP_DAYS` (14) are deleted; the newest is always kept.

```sh
bash /opt/payday-budget/deploy/backup.sh     # a backup now (same as: pb backup)
pb list-backups                              # what is on disk
systemctl list-timers 'payday-budget*'       # when the next one runs
```

These copies live on the same disk as the database. Put the CT in the Proxmox vzdump schedule
(to PBS or a NAS) as well, which covers losing the whole container.

## Restoring

```sh
pb list-backups
bash /opt/payday-budget/deploy/restore.sh budget-20260924-023000.db receipts-20260924-023000.tar.gz
```

It checks the backup before touching anything, asks you to type `restore`, stops the service,
keeps the current data as `budget.db.pre-restore` and `receipts.pre-restore`, puts the backup in
place, migrates it forward if it came from an older version, and starts the service with a health
check. If any step fails the previous data goes back and the service is started again. The
receipts archive is optional; without it the receipts are left alone.

## Rebooting

The service and the backup timer are enabled, so the app comes back on its own after
`reboot` or a Proxmox host restart (with "Start at boot" set on the CT). Check with:

```sh
systemctl is-active payday-budget
curl -s http://127.0.0.1:8000/api/v1/health
```

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
| `--skip-backup` | skip the pre-update backup |

| restore.sh | |
|---|---|
| `--yes` | do not ask for confirmation |
| `--data-dir`, `--env-file`, `--app-dir`, `--user`, `--no-service` | restore onto a scratch copy instead of the live install (used by the tests and the go-live check) |

## What is on the box

| Path | What |
|---|---|
| `/opt/payday-budget` | the checkout, `backend/.venv`, `frontend/dist` |
| `/etc/payday-budget/payday-budget.env` | settings and the secret key, `0640 root:payday` |
| `/var/lib/payday-budget/budget.db` | the database, owned by `payday` |
| `/var/lib/payday-budget/{receipts,backups}` | attachments and nightly backups |
| `/usr/local/bin/pb` | the admin CLI wrapper |

`install.sh` and `update.sh` are safe to run again. Neither overwrites an existing env file or
database.

## Timers

| Timer | When | Runs | State |
|---|---|---|---|
| `payday-budget-backup.timer` | 02:30 | `pb backup` | enabled by `install.sh` |
| `payday-budget-daily.timer` | 07:00 | `pb run-daily` | installed, enabled automatically by the first `update.sh` after Phase 9 adds the command |
