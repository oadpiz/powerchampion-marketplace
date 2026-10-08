# A1 cutover: portal SQLite -> Postgres (Dokploy)

All commands run in the Dokploy UI: compose "Power Champion Marketplace" -> **Open Terminal** on the
named container. Nothing here needs SSH.

## 0. Preconditions
- Set `PC_PORTAL_DB_PASSWORD` in the Dokploy compose env **before merging the PR**. A missing value fails the entire compose, website included, and this compose autodeploys on merge.
- The password must be URL-safe: letters and digits only (e.g. `openssl rand -hex 24`), because `/ @ :` would break the DSN.
- The Dokploy env has **no** `PC_PORTAL_DATABASE_URL` yet.
- `a1/portal-postgres` merged to `main`, CI (portal-backend: sqlite + postgres) green.

## 1. Deploy the compose (adds `powerchampion-db`, portal still on SQLite)
Deploy. Verify: `powerchampion-db` container healthy; portal `/api/portal/health` still 200; a customer can log in.

## 2. Freeze and back up SQLite (portal container terminal)
```sh
cp /data/portal.sqlite3 /data/portal.sqlite3.pre-pg-$(date +%Y%m%d)
chmod 400 /data/portal.sqlite3.pre-pg-*
```
Keep the backup for 90 days. The portal keeps serving SQLite until step 4, so any write made between this step and step 4 is lost on the Postgres side: announce a short maintenance window and make no customer-facing changes until step 5.
Run steps 2-4 in one sitting. If step 3 runs on a later day, replace `$(date +%Y%m%d)` in the `--source` path with the backup's actual date suffix (`ls /data/portal.sqlite3.pre-pg-*`).

## 3. Import (portal container terminal)
The variable `PC_PORTAL_DB_PASSWORD` is available inside the portal container (passed through by compose). Import from the frozen `.pre-pg-` copy, not the live file:
```sh
python -m server.import_sqlite --source /data/portal.sqlite3.pre-pg-$(date +%Y%m%d) --target "postgresql://portal:${PC_PORTAL_DB_PASSWORD}@powerchampion-db:5432/portal"
```
Every table line must read `source=N target=N` with no MISMATCH; `sessions` and `login_attempts` are skipped on purpose (everyone re-logs in).
If it exits 2 ("target table is not empty"), the import already ran: do not run it twice.

## 4. Switch
Dokploy env: add `PC_PORTAL_DATABASE_URL=postgresql://portal:<same password>@powerchampion-db:5432/portal`. Deploy.

## 5. Verify
- `/api/portal/health` 200.
- Log in with an existing customer account (old password). Keys, credits, agents listed as before.
- Admin: customers count equals the `users` line from step 3.
- In the db container terminal: `psql -U portal -d portal -c "select count(*) from users;"` equals the same number.
- Optional hygiene: once the import is done, the portal no longer needs `PC_PORTAL_DB_PASSWORD`; remove that line from the portal service's `environment` in the compose (follow-up change). Do not delete the variable from the Dokploy env: the db service and the `PC_PORTAL_DATABASE_URL` DSN still need it.

## 6. Rollback (any time)
Remove `PC_PORTAL_DATABASE_URL` from Dokploy env, deploy. The portal reads `/data/portal.sqlite3` again.
Writes made while on Postgres are lost; that is the accepted trade-off (spec §5.2).
Because the portal has `depends_on: service_healthy`, it will not start if the db container is unhealthy, even on this SQLite rollback path. If the db container is unhealthy and you need the SQLite rollback, edit the compose in Dokploy to remove BOTH the `powerchampion-db` service block AND the portal's `depends_on:` block, check with `docker compose -f docker-compose.dokploy.yml config`, then deploy. Restore both blocks once the database is fixed.

## 7. Backups going forward
Dokploy -> compose -> Volume Backups: add `portal-pg-data` (daily). Manual dump from the db container:
```sh
pg_dump -U portal -d portal -Fc -f /tmp/portal-$(date +%Y%m%d).dump
```
Copy the dump out of the container via Dokploy "Browse Files" (it lives in `/tmp`, deliberately not inside the Postgres data directory). The `/tmp` dump disappears when the container is recreated, so copy it out immediately.
