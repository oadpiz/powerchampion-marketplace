# A1 cutover: portal SQLite -> Postgres (Dokploy)

All commands run in the Dokploy UI: compose "Power Champion Marketplace" -> **Open Terminal** on the
named container. Nothing here needs SSH.

## 0. Preconditions
- `a1/portal-postgres` merged to `main`, CI (portal-backend: sqlite + postgres) green.
- Dokploy env for the compose has `PC_PORTAL_DB_PASSWORD=<strong random>` and **no** `PC_PORTAL_DATABASE_URL` yet.

## 1. Deploy the compose (adds `powerchampion-db`, portal still on SQLite)
Deploy. Verify: `powerchampion-db` container healthy; portal `/api/portal/health` still 200; a customer can log in.

## 2. Freeze and back up SQLite (portal container terminal)
```sh
cp /data/portal.sqlite3 /data/portal.sqlite3.pre-pg-$(date +%Y%m%d)
chmod 400 /data/portal.sqlite3.pre-pg-*
```
Keep the backup for 90 days. From here until step 5 no customer writes should happen: announce a short maintenance window.

## 3. Import (portal container terminal)
```sh
python -m server.import_sqlite --source /data/portal.sqlite3 --target "postgresql://portal:${PC_PORTAL_DB_PASSWORD}@powerchampion-db:5432/portal"
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

## 6. Rollback (any time)
Remove `PC_PORTAL_DATABASE_URL` from Dokploy env, deploy. The portal reads `/data/portal.sqlite3` again.
Writes made while on Postgres are lost; that is the accepted trade-off (spec §5.2).

## 7. Backups going forward
Dokploy -> compose -> Volume Backups: add `portal-pg-data` (daily). Manual dump from the db container:
```sh
pg_dump -U portal -d portal -Fc -f /var/lib/postgresql/data/portal-$(date +%Y%m%d).dump
```
