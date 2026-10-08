# A1 cutover: portal SQLite -> Postgres (Dokploy)

Most steps use the Dokploy UI (compose "Power Champion Marketplace" -> **Open Terminal** on the named
container). **Steps 2 and 3 are the exception:** the portal container has to be stopped, so they run as
one-off `docker run` commands in a **host shell on the Dokploy server** (Dokploy -> Web Server / Terminal
page, or SSH). That is the only place this runbook needs a host shell.

## 0. Preconditions
- Set `PC_PORTAL_DB_PASSWORD` in the Dokploy compose env **before merging the PR**. A missing value fails the entire compose, website included, and this compose autodeploys on merge.
- Confirm in Dokploy that the compose **Autodeploy** toggle is on (merge = deploy), so the merge is a deliberate act.
- The password must be URL-safe: letters and digits only (e.g. `openssl rand -hex 24`), because `/ @ :` would break the DSN.
- The Dokploy env has **no** `PC_PORTAL_DATABASE_URL` yet.
- `a1/portal-postgres` merged to `main`, CI (portal-backend: sqlite + postgres) green.

## 1. Deploy the compose (adds `powerchampion-db`, portal still on SQLite)
Deploy. Verify: `powerchampion-db` container healthy; portal container still Healthy in Dokploy (the public `/api/portal/health` is 404 by design); a customer can log in.
The portal has no `depends_on` on the database: with `PC_PORTAL_DATABASE_URL` unset it never touches Postgres, and once it is set a portal that cannot reach Postgres exits and `restart: unless-stopped` retries.

## 2. Freeze and back up SQLite (host shell on the Dokploy server)
Run steps 2-4 in one sitting. The portal must not write while the copy is taken, so stop it first.

1. Dokploy -> Docker -> Containers -> `powerchampion-portal` -> **Stop**. The website stays up; portal routes (login, account, admin) return 502 for the maintenance window.
2. Find the real volume and network names (Dokploy prefixes them with the compose project name):
```sh
docker volume ls | grep portal-data
docker network ls | grep powerchampion
```
Below, `powerchampion-marketplace_portal-data` stands for the volume name you found.
3. Take the backup with the SQLite backup API (not `cp`: it is consistent even if the file is in WAL mode). `--user 10001` is the portal's uid, so the copy is owned and readable by it:
```sh
docker run --rm --user 10001 -v powerchampion-marketplace_portal-data:/data python:3.12-slim python -c "import sqlite3,os; s=sqlite3.connect('/data/portal.sqlite3'); d=sqlite3.connect('/data/portal.sqlite3.pre-pg-$(date +%Y%m%d)'); s.backup(d); d.close(); s.close(); os.chmod('/data/portal.sqlite3.pre-pg-$(date +%Y%m%d)', 0o400); print('backup done')"
```
4. Verify the copy; it must print `ok`:
```sh
docker run --rm --user 10001 -v powerchampion-marketplace_portal-data:/data python:3.12-slim python -c "import sqlite3; print(sqlite3.connect('file:/data/portal.sqlite3.pre-pg-$(date +%Y%m%d)?mode=ro', uri=True).execute('PRAGMA integrity_check').fetchone()[0])"
```
Keep the backup for 90 days. With the portal stopped nothing can write, so there is no drift between the backup and the import. If step 3 runs on a later day, replace `$(date +%Y%m%d)` with the backup's actual date suffix (`docker run --rm -v <volume>:/data python:3.12-slim ls /data`).

## 3. Import (host shell, portal still stopped)
The import runs outside the portal container, so the password is **pasted literally** into the command (replace `<password>` with the value of `PC_PORTAL_DB_PASSWORD`). Afterwards remove the line from the shell history (`history -d <line number>`, or `history -c` on a throwaway shell). Import from the frozen `.pre-pg-` copy, not the live file:
```sh
docker run --rm --network <compose network name from step 2> -v powerchampion-marketplace_portal-data:/data powerchampion-portal:latest python -m server.import_sqlite --source /data/portal.sqlite3.pre-pg-<date> --target "postgresql://portal:<password>@powerchampion-db:5432/portal"
```
Every table line must read `source=N target=N` with no MISMATCH; `sessions` and `login_attempts` are skipped on purpose (everyone re-logs in). Note the `users` line for step 5.
- A traceback leaves Postgres empty (the import is one transaction): fix the cause and re-run.
- Exit 2 "target table is not empty" means the import already ran: do not run it twice.
- Re-cutting over after a rollback needs a clean target first: in the db container terminal run `psql -U portal -d portal -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"`, then redo step 3.

## 4. Switch
Dokploy env: add `PC_PORTAL_DATABASE_URL=postgresql://portal:<same password>@powerchampion-db:5432/portal`. Deploy (this also starts the stopped portal container again).
If the portal container is restarting in a loop, the DSN is wrong or Postgres is unreachable: check its logs, then go to section 6.

## 5. Verify
- Dokploy → Docker → `powerchampion-portal` shows Healthy, and a login succeeds. (The public `https://powerchampion.ai/api/portal/health` returns 404: the BFF allowlist does not expose it, and the portal health endpoint does not touch the database anyway. The login test is what proves Postgres works.)
- Log in with an existing customer account (old password). Keys, credits, agents listed as before.
- In the db container terminal: `psql -U portal -d portal -c "select count(*) from users;"` equals the `users` line from step 3. The admin customers page now lists admin accounts too (with a role column), so its count should equal this number.

## 6. Rollback (any time)
Remove `PC_PORTAL_DATABASE_URL` from Dokploy env, deploy. The portal reads `/data/portal.sqlite3` again; that file is unchanged since step 2.
Writes made while on Postgres are lost; that is the accepted trade-off (spec §5.2).

## 7. Backups going forward
A file copy of a live Postgres data directory is not a valid backup, so do not rely on Volume Backup of `portal-pg-data`. Use logical dumps:
- The db service has a second named volume `portal-pg-dumps` mounted at `/var/lib/postgresql/dumps`.
- Dokploy -> compose -> Schedules: add a daily job. A Compose-type schedule runs *inside* the selected service's container, and the postgres image has no `docker` CLI, so use one of these two forms (each also deletes dumps older than 30 days):
  - Compose-type schedule on service `powerchampion-db` (preferred), command:
```sh
pg_dump -U portal -d portal -Fc -f /var/lib/postgresql/dumps/portal-$(date +%Y%m%d).dump && find /var/lib/postgresql/dumps -name 'portal-*.dump' -mtime +30 -delete
```
  - Server-type schedule (runs on the Dokploy host), command:
```sh
docker exec powerchampion-db sh -c "pg_dump -U portal -d portal -Fc -f /var/lib/postgresql/dumps/portal-\$(date +%Y%m%d).dump && find /var/lib/postgresql/dumps -name 'portal-*.dump' -mtime +30 -delete"
```
- Verify: trigger the schedule once, then in the db container terminal run `ls -l /var/lib/postgresql/dumps` and `pg_restore -l /var/lib/postgresql/dumps/<file> | head`.
- Dokploy -> compose -> Volume Backups: point it at `portal-pg-dumps` (a file copy of a finished dump is safe). The `find ... -mtime +30 -delete` in the schedule keeps 30 days of dumps.
- Restore: `pg_restore -U portal -d portal --clean --if-exists /var/lib/postgresql/dumps/portal-<date>.dump` in the db container.
- `POSTGRES_PASSWORD` is applied only when the `portal-pg-data` volume is first created. Rotating `PC_PORTAL_DB_PASSWORD` later requires `ALTER USER portal PASSWORD '...'` in psql **and** updating the password in `PC_PORTAL_DATABASE_URL`.
