# Go-live checklist

The first deployment of Payday Budget for this household, and the checks that close Phase 7's
"Done when" boxes. Values used here:

| | |
|---|---|
| Hostname | `payday.h-dungeon.com` |
| NGINX Proxy Manager LXC | `10.10.20.98` |
| Budget CT | `<ct-ip>` — fill in the static IP or DHCP reservation you give it |

Each section ends with the box it proves. Note anything that does not match and bring it to the
next session.

## 1. Create the CT (Proxmox UI)

- Debian 13 standard template, **unprivileged**, nesting off.
- 2 vCPU, 2048 MB RAM, 16 GB disk.
- net0: static IP (or a UniFi DHCP reservation). Tick **Firewall** on net0 (used in step 4).
- Options → **Start at boot: Yes**.
- Add it to your vzdump backup job.

## 2. Install (CT console, as root)

```sh
timedatectl set-timezone America/Detroit
apt-get update && apt-get install -y curl

curl -fsSLO https://raw.githubusercontent.com/alreadyded1/Budget/main/deploy/install.sh
bash install.sh --base-url https://payday.h-dungeon.com --trusted-proxy 10.10.20.98
```

Expect a green line per step, `timezone America/Detroit`, `payday-budget-backup.timer enabled`,
a warning that the daily timer waits for Phase 9, and a health line with the version. Then:

```sh
pb create-user <your-username>
pb seed-categories
```

## 3. NGINX Proxy Manager (NPM UI)

Proxy Hosts → Add:

- Domain `payday.h-dungeon.com` · scheme `http` · forward `<ct-ip>` port `8000`
- Block Common Exploits on
- SSL: request a certificate for `payday.h-dungeon.com` (DNS challenge if the name only resolves
  on the LAN) · Force SSL · HTTP/2

DNS: `payday.h-dungeon.com` must resolve to NPM (`10.10.20.98`) from the devices that will use it.

Open `https://payday.h-dungeon.com`, sign in, set up the pay schedule under Settings, add an
account, and enter one transaction.

- [ ] **Box 1** — one script took a fresh Debian 13 LXC to a running app, reachable over HTTPS
      through NPM.

## 4. Firewall (Proxmox UI)

Follow "Firewall (Proxmox)" in `deploy/README.md` with source `10.10.20.98` for port 8000 and your
LAN CIDR for SSH. Then from a laptop on the LAN:

```sh
curl -m 3 http://<ct-ip>:8000/api/v1/health     # should time out now
curl -s https://payday.h-dungeon.com/api/v1/health   # should still answer
```

## 5. Reboot

```sh
reboot
```

After it comes back (console or SSH):

```sh
systemctl is-active payday-budget               # active
curl -s http://127.0.0.1:8000/api/v1/health     # {"status":"ok",...}
systemctl list-timers 'payday-budget*'          # the backup timer has a NEXT time
```

And the site still works at `https://payday.h-dungeon.com` with your transaction there.

- [ ] **Box 2** — the app comes back after an LXC reboot.

## 6. Backup, then restore onto a scratch copy

Run the nightly job now instead of waiting for 02:30, and look at what it wrote:

```sh
systemctl start payday-budget-backup.service
journalctl -u payday-budget-backup -n 5 --no-pager
pb list-backups
```

Restore that backup onto a **scratch copy**. The live install is not touched:

```sh
SCRATCH=/var/lib/payday-budget-scratch
install -d -o payday -g payday -m 0750 "$SCRATCH"
sed "s#/var/lib/payday-budget#$SCRATCH#g" /etc/payday-budget/payday-budget.env > /root/scratch.env

LATEST_DB=$(ls -1 /var/lib/payday-budget/backups/budget-*.db | tail -1)
LATEST_TAR=$(ls -1 /var/lib/payday-budget/backups/receipts-*.tar.gz | tail -1)
bash /opt/payday-budget/deploy/restore.sh --no-service --yes \
  --env-file /root/scratch.env --data-dir "$SCRATCH" "$LATEST_DB" "$LATEST_TAR"

sqlite3 "$SCRATCH/budget.db" "select count(*) from transactions; select version_num from alembic_version;"
ls "$SCRATCH/receipts"
rm -rf "$SCRATCH" /root/scratch.env
```

The count matches what you entered, and the version matches the live database.

- [ ] **Box 3** — the nightly backup produces a DB copy and a receipts archive, and restoring onto
      a scratch copy works.

## 7. Update

```sh
bash /opt/payday-budget/deploy/update.sh
```

Expect, in order: a backup, the fetch, Python dependencies, the frontend build, migrations, a
restart, a health line, and `Updated <old> -> <new>`. With nothing new on `main` it rebuilds the
same version, which is still a full run of every step.

- [ ] **Box 4** — `update.sh` backs up, migrates, rebuilds, restarts, and runs a health check.

## If something goes wrong

- `journalctl -u payday-budget -n 50 --no-pager` shows why the app will not start.
- `PB_TRUSTED_PROXY` in `/etc/payday-budget/payday-budget.env` must be `10.10.20.98`. If it is
  wrong, every visitor looks like the proxy's IP, and five failed sign-ins by anyone lock the whole
  household out for 15 minutes. Restart after editing it: `systemctl restart payday-budget`.
- Signing in on `http://<ct-ip>:8000` fails by design: the session cookie is HTTPS-only.
