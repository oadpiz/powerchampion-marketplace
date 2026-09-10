# Post-deploy numeric anchors — marketing site, 2026-09-09

Recorded before deploying. Each row is checked again after the marketing-site
deploy, and again after the gateway deploy (spec §10.3, §10.4). A mismatch is a
rollback trigger, not a "look into it later".

| # | Anchor | How to check after deploy | Expected |
|---|---|---|---|
| 1 | Model count on `/models` | count the model cards on `https://powerchampion.ai/models` | equals `curl -s https://b300.powerchampion.ai/catalog.json \| jq '.models \| length'`; while `/catalog.json` is absent, equals `CATALOG_SNAPSHOT.length` (9) **and** the snapshot notice is visible |
| 2 | Snapshot notice | visible text on `/models`, `/pricing`, `/` | present while the catalogue is a snapshot; **gone** once the gateway serves `/catalog.json` |
| 3 | Every price on `/pricing` | compare each row against the catalogue | token models: `prompt_usd` / `completion_usd` verbatim; image models: `completion_usd / 1000` per image; audio: `completion_usd * 3 / 1000` per minute (Global Constraints) |
| 4 | `/status` unavailable count | count rows labelled unavailable | equals `curl -s https://b300.powerchampion.ai/status.json \| jq '[.models[] \| select(.ready == false)] \| length'` |
| 5 | `/status` machine-readable link | the link at the foot of the model table | `href` is `https://b300.powerchampion.ai/status.json` |
| 6 | `/contact` title | `curl -s https://powerchampion.ai/contact \| grep -o '<title>[^<]*'` | `Contact \| Power Champion` |
| 7 | Sitemap routes | `curl -s https://powerchampion.ai/sitemap.xml \| grep -c '<loc>'` | 14 entries, including `/console` and `/data-retention`, and **no** `/about` |
| 8 | `/about` redirect | `curl -sI https://powerchampion.ai/about` | `308`, `Location` ending `/company` |
| 9 | Legal pages clean | fetch `/privacy`, `/terms`, `/data-retention` | each contains `Power Champion Investment Limited`, `Effective 2026-09-09`, `info@powerchampion.org`; none contains `TBD`, `yourdomain`, or an `https://...powerchampion.org` URL |
| 10 | Locale | `curl -s -H 'Accept-Language: zh-TW' https://powerchampion.ai/ \| grep -o '<html[^>]*lang="[^"]*"'` | `lang="zh-Hant"`, and the body carries `取得 API 存取` |
| 11 | OpenAPI | `curl -s https://powerchampion.ai/openapi.json \| jq '.servers[0].url, (.paths \| keys \| length)'` | `"https://b300.powerchampion.ai"` and `10` |

## Values recorded before deploy

- `npm test`: `Test Files  23 passed (23)` / `Tests  238 passed (238)` (vitest stage); `Build complete. Run \`vinext start\` to start the production server.` (build stage); `ℹ tests 16` / `ℹ pass 16` / `ℹ fail 0` (node --test rendered-html stage). Recorded 2026-09-10, worktree HEAD `7455cc0`.
- `/catalog.json` reachable: **no** — `curl -s --max-time 6 https://b300.powerchampion.ai/catalog.json` returns `{"detail":"Management authentication required."}` (auth-gated, not the public payload). Expected until the sibling gateway plan ships the endpoint. Every catalogue page currently renders from `CATALOG_SNAPSHOT` with the snapshot notice (`node --test` logs `[rendered-html] /, /models, /pricing: snapshot-fallback branch (gateway unreachable from this build)`).
- `/status.json` model count / unavailable count: **9 models / 9 unavailable**. Live response: `{"status":"down","summary":"Major outage", ...}` — every model in the live gateway status currently reports `ready: false`. This is the production gateway's own live state as observed 2026-09-10 23:41 UTC, not something this branch changed; flagged here as a fact for the record, not a task-9 defect (out of scope — no gateway/production changes were made by this branch).
- `<loc>` count in `public/sitemap.xml`: **14** (confirmed includes `/console` and `/data-retention`; confirmed **no** `/about`).
- `CATALOG_SNAPSHOT.length` / `CATALOG_SNAPSHOT_DATE`: **9** / **`2026-09-09`** (`lib/catalog.ts:60`).

## Known gap found during acceptance (not fixed here, per Task 9's "writes no source code" boundary)

`npx tsc --noEmit` reports 5 errors. Two are genuinely pre-existing and untouched by this
plan's commits (`tests/visual-contract.test.ts:97`, `worker/index.ts:6` — zero-line diff
against both `origin/main`'s merge-base `6c51bc3` and the plan's stated baseline `2c1161d`).
The remaining **three are in `tests/catalog.test.ts`, a file Task 1's test commit
(`c8b41a3`) newly created** — it does not exist at either `6c51bc3` or `2c1161d`, so these
three are *not* pre-existing; they are a type-checking gap introduced by this plan that the
Global Constraints supplied to Task 9 did not disclose. They do not fail `vitest run` (Vitest
does not type-check) or `npm run build`, so `npm test` stays green, but Step 3 of this task's
brief ("no output from `tsc`") does not pass as a result. This belongs to Task 1/1's test
commit to fix, not Task 9. See the Task 9 report for full detail.

All 8 `npm run lint` errors were checked the same way and are genuinely pre-existing
(unchanged lines, or the same lint-rule violation already present on the same
still-synchronous-setState / still-unused-variable pattern before this plan's commits):
`app/status/page.tsx`, `components/demo-checkout.tsx`, `components/locale-provider.tsx`,
`components/site-shell.tsx`, `tests/locale-detection.test.tsx`, `tests/setup.ts`.
