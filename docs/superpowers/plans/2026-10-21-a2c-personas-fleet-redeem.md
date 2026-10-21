# A2c：Personas、fleet 工作流、兌換碼 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 管理員在 portal 後台就能做完閘道 `/personas` 頁與 fleet 按鈕今天能做的事，並能產生／查詢／停用／匯出兌換碼：新增「人設（Personas）」頁（清單、檢視含 revisions、建立、新增 revision、activate、try）、在既有「閘道」頁加上 fleet 的 freeze／resume／candidate／approve／drain／rollback 與唯讀 status／timeline／events、新增「兌換碼」頁（產生時明文只顯示一次、清單、停用、CSV 匯出）。`/api/control` 只代理 fleet 寫入需要的 job 輪詢。開工前先把 `server/app.py` 與三個過大的前端檔拆開（不改行為），並收掉 A2b 留下的四個安全／正確性尾巴。

**Architecture:** 三層不變：瀏覽器 → BFF 白名單（`app/api/portal/[...path]/route.ts`）→ FastAPI（`server/`，`current_user(admin=True)`、審計）→ 閘道（HTTPS，`X-Admin-Token`）。`server/app.py` 的 `create_app` 閉包裡的共用工具搬到 `server/support.py`（`PortalError`／`fail`／`body_json` 等原語與閘道輔助函式，加上一個持有 store／gateway／settings／current_user 的 `PortalContext`），admin 帳號路由與 admin 金鑰／閘道路由各自成模組，以 `attach_*(application, ctx)` 掛上（先例：`server/allocation.py` 的 `attach_allocation`）。A2c 的新路由放在 `server/admin_personas.py`、`server/admin_fleet.py`、`server/admin_redeem.py`，不進 `app.py`。`server/gateway.py` 的 adapter 增加 personas／fleet／control job／redeem 方法，錯誤模型沿用 `GatewayError(code, status, detail)`；`_request` 增加 `timeout` 與 `expect`（object／array／csv）兩個參數。所有行為用 `server/testsupport.py` 的 `FakeGateway` 測，不需要真閘道或節點。

**Tech Stack:** 同 A2b（Python 3.13 FastAPI＋SQLAlchemy Core／Alembic、Vinext／React 19、vitest、unittest；後端測試在 SQLite 與 Postgres 各跑一次）。閘道契約以 sell-panel `origin/main` 044210b 的 `app.py`／`personas.py`／`fleet_state.py`／`fleet_orchestrator.py`／`apikeys.py`（2026-10-21 盤點）為準。

## 已定決策（owner，2026-10-21）

1. 範圍：Personas 頁（清單、檢視含 revisions、建立、新增 revision、activate、try）；fleet 按鈕 freeze／resume／candidate／approve／drain／rollback 與唯讀 status／timeline／events，放在既有「閘道」頁；兌換碼頁（產生——明文只顯示一次、清單、停用、CSV 匯出）；`/api/control` **只**代理 fleet 寫入需要的 job 輪詢。**不**代理 control mode／switch／profit-evidence／validate（也不代理 preview／validation-preview）。
2. portal 的每個寫入動作（包含會花模型 token 的 persona `try`）都寫一筆 `audit_events`，不含秘密（兌換碼明文不進審計、不進日誌、不入庫）。
3. Task 1（本計畫拆成 1A 後端、1B 前端，以便各自審查）是**不改行為**的重構。
4. 帳本（A2b ledger）只收四個尾巴：(a) `admin_gateway` 的 `errors.*` 與 `provision_key` 把閘道 401／403 報成 `gateway_auth_failed`；(b) toggle 改成「設定成指定狀態」而不是盲目翻轉；(c) `POST /admin/keys/{id}/disable {disabled:false}` 要受每客戶有效金鑰上限約束；(d) 簽發金鑰的客戶下拉選單不列 admin。其他全部延後（見文末「不在 A2c」）。
5. `feat/engineer-ssh-self-service` 正在加 migration 0004、`/me/engineer*`、`/account/ssh-key`、機台分配改動。**A2c 在它合進 main 之後才從 main 開分支**；本計畫不假設 migration 編號（A2c 預期不需要 migration；若實作中發現需要，用 rebase 後的下一個空號並先停下來回報）。
6. 生產閘道可能連不到節點；所有 fleet／persona／redeem 行為都要能用 fake gateway 單元測試。
7. spec 同步更新：A2c 段落依本決策改寫、A3 的依賴改成 A2c（Task 11 有逐字文字）。

## Global Constraints

- **基準**：在 Task 1A Step 1 記錄（`origin/main` 合入 SSH 分支之後的實際值）。參考值（2026-10-21，`origin/main` 35d0821）：後端 `Ran 283 tests`，其中 `server.test_allocation.ExportTests.test_render_py_accepts_the_export` 在本機有 b300-cluster `render.py` 時失敗（該測試讀取 repo 外的 `render.py`，沒有就 skip，與 A2c 無關）；vitest 487 passed（46 files）。之後每個 Task：後端測試數只增不減、除上述環境相依測試外 0 failed（該測試的結果必須與 BASE 相同）；vitest 只增不減、0 failed；`npx tsc --noEmit`、`npm run lint` 錯誤數不得比 BASE 多（LESSONS 2026-09-10：用相對斷言）。
- **與 SSH 分支共用的檔案（先 rebase 再動）**：`app/api/portal/[...path]/route.ts`、`lib/portal-client.ts`、`tests/portal-proxy.test.ts`、`tests/portal-ui.test.tsx`、`server/README.md`、`docs/portal-operations.md`；可能還有 `server/app.py`（若 `/me/engineer*` 寫在 app.py）、`server/testsupport.py`、`components/admin-portal.tsx`、`components/admin-shell.tsx`、`app/admin/[[...section]]/page.tsx`、`tests/rendered-html.test.mjs`。本計畫引用的行號都是 35d0821 的值，rebase 後以實際為準。A2c **不碰** `server/allocation.py`、`components/admin-allocation-section.tsx`、`components/account-portal.tsx`、`server/migrations/`。若 `/me/engineer*` 在 `server/app.py`，Task 1A 把它們留在 app.py 的客戶區，不搬進 admin 模組。
- **閘道契約（寫進 adapter 測試，固定）**：
  - Personas（`personas.py` `PersonaStore`；persona_id = `uuid4().hex[:12]`）：`GET /api/personas`（view）→ `{personas:[{persona_id,name,created_at,active_rev,latest_rev}]}`；`GET /api/personas/{id}?rev=N`（view）→ `{persona:{persona_id,name,created_at,active_rev,rev,system,note,author,rev_created_at,examples:[{user,assistant}]}, revisions:[{rev,note,author,created_at,system_len,example_count}]}`，不存在 404 "No such persona."；`POST /api/personas {name}`（admin）→ `{persona_id}`；`POST /api/personas/{id}/revisions {system,examples,note,activate}`（admin；`activate` 省略＝true）→ `{rev}`，不存在 404；`POST /api/personas/{id}/activate {rev}`（admin）→ `{ok:true}`，不存在 404 "No such revision."；`POST /api/personas/{id}/try {input,revs,history,max_tokens,temperature}`（**view**；`revs` 取前兩個，`null`＝active；閘道對後端的逾時 120 s；會記用量 `note="persona_try"`）→ `{input, results:[{rev,note,reply,usage} | {rev,error}]}`，`input` 空 400。閘道用 `await request.json()`，不檢查型別；`examples` 內非 dict 會讓 `to_messages` 500——portal 必須先驗證。
  - Fleet（`app.py:4811-4930`）：`GET /api/fleet/events?model_id=&limit=`（**admin**，`limit` 1..500 否則 400，model 非 control_managed 404）→ `{events:[FleetEvent]}`；`GET /api/fleet/{model}/status`（view）→ `{model_id,enabled,draining,frozen,capacity:CapacityState|null,workflow:WorkflowJob|null}`；`GET /api/fleet/{model}/timeline`（view）→ `{model_id, events:[WorkflowEvent]}`（最多 100）；`POST /api/fleet/{model}/(freeze|resume)`（admin，空 body）→ **200** `CapacityState`（`model_id,sellable_cap,physical_cap,mode,reason,policy_version,observed_at,event_id`）；`POST /api/fleet/{model}/(candidate|drain|approve|rollback)`（admin，空 body）→ **202** `{job_id,state,phase}`。所有 fleet 路由：model 不存在或 `control_managed` 不為 true → 404 "Managed model not found."；`ValueError`／`FleetLeaseLost` → 409（detail＝例外字串）；body 非空 → 400。`{model_id}` 是單一路徑段（不可含 `/`）。`control_managed` **不在** `/api/state` 的輸出裡（`_probe` 的 keep 清單沒有它）。Workflow `state` ∈ {queued, running, awaiting_approval, rolling_back, succeeded, failed, cancelled}；approve 只在 `state=awaiting_approval` 且 `phase=ready` 時成功。
  - Control job（`app.py:4732`）：`GET /api/control/jobs/{job_id}` 路由本身不驗權，由 `protect_management_surface` 中介層以 VIEW_TOKEN 保護（`X-Admin-Token` 通過）；fleet workflow id（`uuid4().hex[:16]`）回 `{id,kind,model_id,actor,state,phase,reason,incumbent_ids,created_at,updated_at}`，否則回舊 SwitchOrchestrator job（形狀不定），找不到 404 "Switch job not found."。另：`GET /api/personas/{id}?rev=N` 遇到不存在的 rev 會退回最新版本而非 404（portal 照樣轉回，UI 以回應中的 `rev` 為準）；fleet 寫入的 body 為 `{}` 也被接受。
  - Redeem（`app.py:5563-5655`、`apikeys.RedeemCodeStore`）：`POST /api/redeem/codes {amount_usd(float>0), count(1..10000), label, expires_days?}`（admin）→ **JSON 陣列** `[{code, code_id, nano_usd}]`（`code` = `secrets.token_urlsafe(24)`，閘道只存 sha256）；`expires_days` ≤0 或省略＝不過期；`GET /api/redeem/codes`（admin）→ **JSON 陣列** `[{code_id,nano_usd,label,created_at,created_by,redeemed_at,redeemed_by_key_id,disabled_at,expires_at}]`（無上限、新到舊、時間為 float epoch）；`POST /api/redeem/codes/{id}/disable` → `{ok,code_id}`，不存在或已停用 404；`GET /api/redeem/codes.csv` → `text/csv`，表頭 `code_id,code_hash,nano_usd,label,created_at,created_by,redeemed_at,redeemed_by_key_id,disabled_at,expires_at`。
  - 401：閘道 `has_admin_access` 在 ADMIN_TOKEN 未設或不符時回 401；portal 一律轉 503 `gateway_auth_failed`。
- **錯誤對應（所有 A2c 路由共用 `gateway_fail`，另有路由專屬的 404 碼）**：`unconfigured` → 503 `provider_not_configured`；閘道 401／403 → 503 `gateway_auth_failed`；閘道 400／404／409 → 同狀態 `gateway_rejected`（帶閘道 detail，≤300 字）——**除非**該路由宣告了專屬 404 碼（`persona_not_found`、`fleet_not_managed`、`job_not_found`、`redeem_code_not_found`）；其他 4xx → 400 `gateway_rejected`；`unavailable`／`invalid_response`／`response_limit` → 503 `gateway_unavailable`；`invalid_identifier` → 400 `invalid_input`；adapter 的 `ValueError` → 422 `invalid_input`。客戶 → 403 `admin_required`；未登入 → 401 `auth_required`。閘道失敗時**不寫成功審計**（例外：兌換碼產生未確認，見 Task 6）。
- **審計動作名（固定）**：`admin.persona_created`、`admin.persona_revision_saved`、`admin.persona_activated`、`admin.persona_tried`、`admin.fleet_frozen`、`admin.fleet_resumed`、`admin.fleet_candidate_requested`、`admin.fleet_drain_requested`、`admin.fleet_approved`、`admin.fleet_rollback_requested`、`admin.redeem_codes_issued`、`admin.redeem_codes_issue_unconfirmed`、`admin.redeem_code_disabled`、`admin.redeem_codes_exported`；`admin.model_toggled` 改為只在真的翻轉時寫，並帶 details `{requested, enabled}`。details 一律不含：兌換碼明文、persona 的 system／examples／try 輸入原文、任何 token。
- **兌換碼明文**：只存在於閘道回應 → portal 回應 → 瀏覽器一次性對話框的記憶體中。portal 不寫 DB、不寫審計、不寫 log；前端關閉對話框即丟棄，不放 localStorage。測試以 `database_text(store)`、審計 details、root logger 擷取、後續清單回應四處斷言明文不存在。
- **前端**：新 section 各自一檔；`admin-portal.tsx` 只加型別、導覽與分派。四處同步：BFF 白名單、`app/admin/[[...section]]/page.tsx` 白名單、`AdminSection` 型別＋`AdminPortal` navigation、`AdminShell` NAV（＋對應測試 `tests/portal-ui.test.tsx` 的 NAV 標籤斷言與 `tests/rendered-html.test.mjs` 的 section 清單）。NAV 最終順序：總覽、客戶、金鑰、兌換碼、用量、閘道、人設、機台分配、儲值申請、操作紀錄（en：Overview, Customers, API keys, Redeem codes, Usage, Gateway, Personas, Node allocation, Credit requests, Audit log）。新 UI 測試用新的 `tests/support/admin-fetch.tsx`（不改 `portal-ui.test.tsx` 既有 helper，降低與 SSH 分支的衝突）。
- **Git**：worktree `.worktrees/a2c-ops`，分支 `a2c/personas-fleet-redeem` 從（已含 SSH 分支的）`origin/main` 開；venv `.venv-portal`；agent 不 push／merge／碰 Dokploy／動生產；每個 git 指令一行；不用 `git stash`；不用 `git checkout <path>`／`git restore <path>` 清理；永遠不要 add `tsconfig.tsbuildinfo`；開工與收工各跑一次 `git status --short`（LESSONS 2026-09-14／09-16）。Commit 結尾加執行 session 指定的 attribution 行（本 session 為 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`）。
- **長請求**：persona `try` 走「BFF 95 s → FastAPI adapter 90 s → 閘道（後端 120 s）」。只有 try 路徑放寬，其他維持 BFF 20 s／adapter 15 s。部署後要用真環境量一次（Task 12，LESSONS 2026-10-20 Next proxy 30 s 教訓）。
- **無 env／compose 變更**；**無 schema 變更**。

## 新路由總表

`BFF` 欄是 `route.ts` 的 regex（常數：`PERSONA = "[A-Za-z0-9_-]{1,64}"`、`FLEET_MODEL = "[A-Za-z0-9._:-]{1,128}"`、`FLEET_ACTION = "(freeze|resume|candidate|drain|approve|rollback)"`、`CODE = "[A-Za-z0-9_-]{1,64}"`、既有 `JOB = "[A-Za-z0-9._-]{1,128}"`）。portal 路徑都在 `/api/portal` 之下；全部 `current_user(admin=True)`。表格內 regex 的 `\|` 只是 Markdown 跳脫，程式碼裡是 `|`。

| # | Method | Portal path | BFF regex | Gateway | 閘道權限 | 審計（target；details） | 專屬錯誤 |
|---|---|---|---|---|---|---|---|
| 1 | GET | `/admin/personas` | `/^\/admin\/personas$/` | `GET /api/personas` | view | — | — |
| 2 | GET | `/admin/personas/{id}?rev=N` | `` new RegExp(`^/admin/personas/${PERSONA}$`) ``；BFF 只轉送 `rev`，須 `^[1-9][0-9]{0,8}$`，否則 400 | `GET /api/personas/{id}[?rev=N]` | view | — | 404 `persona_not_found` |
| 3 | POST | `/admin/personas` `{name}` | `/^\/admin\/personas$/` | `POST /api/personas` | admin | `admin.persona_created`（persona_id；`{name}`） | 201 |
| 4 | POST | `/admin/personas/{id}/revisions` `{system,examples,note,activate}` | `` new RegExp(`^/admin/personas/${PERSONA}/(revisions\|activate\|try)$`) ``；revisions 的 body 上限 196608 | `POST /api/personas/{id}/revisions` | admin | `admin.persona_revision_saved`（persona_id；`{rev,activate,systemChars,examples}`） | 404 `persona_not_found`；body 過大 413 |
| 5 | POST | `/admin/personas/{id}/activate` `{rev}` | 同 #4 | `POST /api/personas/{id}/activate` | admin | `admin.persona_activated`（persona_id；`{rev}`） | 404 `persona_not_found` |
| 6 | POST | `/admin/personas/{id}/try` `{input,revs,maxTokens,temperature}` | 同 #4；BFF 逾時 95000 ms | `POST /api/personas/{id}/try`（adapter 逾時 90 s） | view | `admin.persona_tried`（persona_id；`{revs,inputChars,maxTokens}`） | — |
| 7 | GET | `/admin/gateway/fleet/{model}/status` | `` new RegExp(`^/admin/gateway/fleet/${FLEET_MODEL}/(status\|timeline)$`) `` | `GET /api/fleet/{model}/status` | view | — | 404 `fleet_not_managed` |
| 8 | GET | `/admin/gateway/fleet/{model}/timeline` | 同 #7 | `GET /api/fleet/{model}/timeline` | view | — | 404 `fleet_not_managed` |
| 9 | GET | `/admin/gateway/fleet/events?modelId=&limit=` | `/^\/admin\/gateway\/fleet\/events$/`；BFF 只轉送 `modelId`（`^${FLEET_MODEL}$`）與 `limit`（`^[1-9][0-9]{0,2}$`），不合 400 | `GET /api/fleet/events?limit=&model_id=` | **admin** | — | `limit` 不在 1..500 → 400 `invalid_input`；404 `fleet_not_managed` |
| 10 | POST | `/admin/gateway/fleet/{model}/{action}`（無 body） | `` new RegExp(`^/admin/gateway/fleet/${FLEET_MODEL}/${FLEET_ACTION}$`) `` | `POST /api/fleet/{model}/{action}`（空 body） | admin | freeze→`admin.fleet_frozen`、resume→`admin.fleet_resumed`、candidate→`admin.fleet_candidate_requested`、drain→`admin.fleet_drain_requested`、approve→`admin.fleet_approved`、rollback→`admin.fleet_rollback_requested`（model；job 類 `{jobId,state,phase}`、freeze／resume `{mode}`） | 404 `fleet_not_managed`；409 `gateway_rejected`＋detail；action 不在白名單 400 `unknown_action` |
| 11 | GET | `/admin/gateway/control/jobs/{job}` | `` new RegExp(`^/admin/gateway/control/jobs/${JOB}$`) `` | `GET /api/control/jobs/{job}` | view（中介層） | — | 404 `job_not_found` |
| 12 | GET | `/admin/redeem/codes` | `/^\/admin\/redeem\/codes(\/export)?$/` | `GET /api/redeem/codes` | admin | — | 未設定時 200 `{gatewayConfigured:false}` |
| 13 | POST | `/admin/redeem/codes` `{amountUsd,count,label,expiresDays?}` | `/^\/admin\/redeem\/codes$/` | `POST /api/redeem/codes` | admin | `admin.redeem_codes_issued`（label；`{count,amountUsd,expiresDays,codeIds}`）；閘道沒確認時 `admin.redeem_codes_issue_unconfirmed`（label；`{count,amountUsd}`） | 201 |
| 14 | POST | `/admin/redeem/codes/{id}/disable` | `` new RegExp(`^/admin/redeem/codes/${CODE}/disable$`) `` | `POST /api/redeem/codes/{id}/disable` | admin | `admin.redeem_code_disabled`（code_id） | 404 `redeem_code_not_found` |
| 15 | GET | `/admin/redeem/codes/export` | 同 #12；BFF 回應上限 6291456 | `GET /api/redeem/codes.csv` | admin | `admin.redeem_codes_exported`（無；`{rows}`） | — |
| 16（改） | POST | `/admin/gateway/models/{id}/toggle` **`{enabled: bool}`** | 不變 | `GET /api/state` 後視需要 `POST /api/models/{id}/toggle` | admin | `admin.model_toggled`（model；`{requested,enabled}`），沒翻轉不寫 | 422（enabled 非 bool）、404 `gateway_rejected`（state 裡沒有此模型）、409 `state_changed` |

## File Map

| 檔案 | 動作 | Task |
|---|---|---|
| `server/support.py` | Create：原語＋閘道輔助＋`PortalContext` | 1A（2、4 擴充） |
| `server/admin_accounts.py` | Create：`attach_admin_accounts` | 1A |
| `server/admin_gateway.py` | Create：`attach_admin_gateway` | 1A（2 修改） |
| `server/app.py` | Modify：只留 create_app、中介層、客戶與公開路由、`attach_*` 呼叫 | 1A、4、5、6 |
| `server/testsupport.py` | Modify：`PortalCase`（由 test_accounts 搬來）、`FakeGateway` 擴充 | 1A、2、3 |
| `server/test_routes.py` | Create：路由唯一性、所有 `/admin` 路由拒絕客戶 | 1A |
| `server/test_accounts.py` | Modify：改 import；Task 2 新測試與 toggle 測試更新 | 1A、2 |
| `server/gateway.py` | Modify：`_request(timeout, expect)`、personas／fleet／control／redeem 方法 | 3 |
| `server/test_portal.py` | Modify：`GatewayAdapterTests` 擴充 | 3 |
| `server/admin_personas.py`、`server/test_admin_personas.py` | Create | 4 |
| `server/admin_fleet.py`、`server/test_admin_fleet.py` | Create | 5 |
| `server/admin_redeem.py`、`server/test_admin_redeem.py` | Create | 6 |
| `app/api/portal/[...path]/route.ts`、`lib/portal-client.ts`、`tests/portal-proxy.test.ts` | Modify | 7 |
| `components/admin-resource.tsx` | Modify：收 `GatewayNotConnected`（1B）、`downloadText`（10） | 1B、10 |
| `components/admin-keys-dialogs.tsx` | Create（由 keys section 搬出） | 1B（2 修改） |
| `components/admin-gateway-panels.tsx` | Create（JobStatus、GpuPanel、對話框、helpers 搬出） | 1B |
| `components/admin-customers-section.tsx`、`admin-credits-section.tsx`、`admin-overview-section.tsx`、`admin-audit-section.tsx` | Create（由 admin-portal 搬出） | 1B |
| `components/admin-portal.tsx`、`admin-keys-section.tsx`、`admin-gateway-section.tsx`、`admin-usage-section.tsx` | Modify | 1B、2、8、9、10 |
| `components/admin-personas-section.tsx`、`components/admin-persona-editor.tsx` | Create | 8 |
| `components/use-job-poll.ts`、`components/admin-fleet-panel.tsx` | Create | 9 |
| `components/admin-redeem-section.tsx`、`components/admin-redeem-dialogs.tsx` | Create | 10 |
| `components/admin-shell.tsx`、`app/admin/[[...section]]/page.tsx` | Modify | 8、10 |
| `tests/support/admin-fetch.tsx` | Create | 8 |
| `tests/admin-personas.test.tsx`、`tests/admin-fleet.test.tsx`、`tests/admin-redeem.test.tsx` | Create | 8、9、10 |
| `tests/portal-ui.test.tsx`、`tests/rendered-html.test.mjs` | Modify（NAV／section 清單、Task 2 的兩條 UI 測試） | 2、8、10 |
| `docs/superpowers/specs/2026-10-08-unified-admin-platform-design.md`、`server/README.md`、`docs/portal-operations.md` | Modify | 11 |

---

### Task 1A: 後端重構——拆 `server/app.py`（行為不變）

**Files:**
- Create: `server/support.py`、`server/admin_accounts.py`、`server/admin_gateway.py`、`server/test_routes.py`
- Modify: `server/app.py`、`server/testsupport.py`（收 `PortalCase`）、`server/test_accounts.py`（改 import）

**Interfaces（搬移，不改邏輯；函式本體逐字搬）：**
- `server/support.py`：
  - 常數 `PREFIX = "/api/portal"`、`COOKIE_NAME = "pc_portal_session"`。
  - 原語（原 `app.py:30-80`）：`class PortalError`、`fail`、`body_json`、`text_value`、`credit_cents`、`audit_details`。
  - 閘道輔助（原閉包 `app.py:169-222, 583-594, 847-861`，改成模組層函式，不再閉包）：`gateway_fail(error)`、`usd_from_nano(value)`、`owner_json(owner_row)`、`owners_by_gateway_key_id(con)`、`gateway_key_json(item, owner_row=None)`、`limits_from(body)`、`usd_amount(raw, allow_zero)`、`gateway_key_id(value)`、`gateway_path(value, pattern)`、`admin_target(con, user_id, admin)`。
  - `@dataclass class PortalContext: store; gateway; settings; current_user`，方法（原閉包 `app.py:160-167, 338-375, 847-856`）：`require_gateway(customer=False)`、`key_issuance()`、`async gateway_call(call, *args)`、`async provision_key(owner_id, label, prepaid_usd, limits, actor_id, audit_action)`。**方法內一律在呼叫當下讀 `self.gateway.xxx`／`self.settings.xxx`，不要在 attach 時把 bound method 存起來**——測試會在 app 建好之後替換 `gateway.configured`、`gateway.nodes` 等屬性。
- `server/admin_accounts.py`：`attach_admin_accounts(application, ctx)`，路由（原樣）：`GET /admin/overview`、`GET /admin/customers`、`GET /admin/credits`、`POST /admin/credits/{credit_id}/review`、`POST /admin/customers/{user_id}/status`、`/role`、`/reset-password`、`GET /admin/audit`。
- `server/admin_gateway.py`：`attach_admin_gateway(application, ctx)`，路由（原樣）：`POST /admin/customers/{user_id}/keys`、`GET /admin/keys`、`GET /admin/usage`、`POST /admin/keys/{key_id}/disable|limits|balance`、`GET /admin/gateway`、`POST /admin/gateway/models/{model_id:path}/toggle|maintenance`、`POST /admin/gateway/nodes/{name}/ops/{action}`、`GET /admin/gateway/nodes/{name}/jobs/{job_id}`。
- `server/app.py` 保留：`create_app`（lifespan、中介層、三個 exception handler、`current_user`、`set_session`）、health／trial／auth／session／logout／password／overview／customer keys（`GET/POST /keys`、`DELETE /keys/{id}`）／usage／credits／agents 路由，然後依序 `attach_admin_accounts(application, ctx)`、`attach_admin_gateway(application, ctx)`、`attach_runtime(...)`、`attach_allocation(...)`，最後 `app = create_app()`。`from .support import PortalError, fail, body_json, PREFIX, COOKIE_NAME`（保留舊名稱可從 `server.app` import）。若 SSH 分支在 app.py 加了 `/me/engineer*`，原地保留。
- 預期行數：`app.py` ≤ 460、`support.py` ≈ 230、`admin_accounts.py` ≈ 150、`admin_gateway.py` ≈ 320（`wc -l` 回報）。

- [ ] **Step 1: 前置檢查、worktree、基準**

```bash
cd /Users/optyne/repository/b300/sell-panel/powerchampion-marketplace
git status --short | grep -v '^??' | head
git fetch origin
git log --oneline -3 origin/main
git show "origin/main:app/api/portal/[...path]/route.ts" | grep -c "me/engineer"
git ls-tree --name-only origin/main server/migrations/versions/
```
Expected：`grep -c` ≥ 1 且 versions 有 `0004_*`（SSH 分支已合入）。**若為 0：停止，回報 BLOCKED（"feat/engineer-ssh-self-service 尚未合進 origin/main"），不得自行 merge 該分支**（LESSONS 2026-08-10）。

```bash
cd /Users/optyne/repository/b300/sell-panel/powerchampion-marketplace
git worktree add -b a2c/personas-fleet-redeem .worktrees/a2c-ops origin/main
cd .worktrees/a2c-ops
git status --short
python3 -m venv .venv-portal
.venv-portal/bin/pip install -q -r server/requirements.txt
.venv-portal/bin/python -m unittest discover -s server -t . -p 'test_*.py' 2>&1 | tail -4
npm ci --silent 2>&1 | tail -1
npx vitest run 2>&1 | tail -5
npx tsc --noEmit 2>&1 | grep -c "error TS"
npm run lint 2>&1 | tail -3
```
把 `Ran N tests`、失敗清單、vitest 數、tsc 錯誤數、lint 結果記到 `.superpowers/sdd/2026-10-21-a2c/progress.md`（BASE）。

- [ ] **Step 2: 路由快照（改動前）**

```bash
cd /Users/optyne/repository/b300/sell-panel/powerchampion-marketplace/.worktrees/a2c-ops
mkdir -p .superpowers/sdd/2026-10-21-a2c
.venv-portal/bin/python - > .superpowers/sdd/2026-10-21-a2c/routes-before.txt <<'EOF'
import tempfile
from server.app import create_app
from server.settings import Settings
app = create_app(Settings(db_path=tempfile.mkdtemp() + "/routes.sqlite"))
for path, methods in sorted((r.path, ",".join(sorted(getattr(r, "methods", None) or []))) for r in app.routes):
    print(methods, path)
EOF
wc -l .superpowers/sdd/2026-10-21-a2c/routes-before.txt
```

- [ ] **Step 3: 新測試（先寫；在舊結構上應該就通過，作為重構的護欄）**

`server/testsupport.py`：把 `test_accounts.py` 的 `ORIGIN`、`BASE`、`PASSWORD` 與 `_PortalCase` 整段搬過來，類名改 `PortalCase`（docstring 保留「holds no tests」）；`create_app` 在 `setUp` 裡才 import（`from server.app import create_app`），不要放在 testsupport 頂層，避免每個 import testsupport 的測試模組都觸發 `server.app` 的 `app = create_app()`。`test_accounts.py` 改為 `from server.testsupport import BASE, ORIGIN, PASSWORD, FakeGateway, PortalCase as _PortalCase, fresh_database, rows`（其餘不動）。

`server/test_routes.py`：

```python
import re
import unittest

from server.testsupport import BASE, ORIGIN, PortalCase


class RouteTableTests(PortalCase):
    def test_every_method_and_path_is_registered_once(self):
        pairs = [(route.path, method) for route in self.app.routes for method in (getattr(route, "methods", None) or ())]
        self.assertEqual(len(pairs), len(set(pairs)), [p for p in pairs if pairs.count(p) > 1])

    def test_every_admin_route_refuses_customers_and_anonymous_callers(self):
        customer = self.client()
        self.register(customer, "route-check@example.test")
        anonymous = self.client()
        checked = 0
        for route in self.app.routes:
            if not getattr(route, "path", "").startswith(BASE + "/admin"):
                continue
            path = re.sub(r"\{[^}]+\}", "x", route.path)
            for method in sorted(route.methods or ()):
                if method == "HEAD":
                    continue
                for client, status in ((customer, 403), (anonymous, 401)):
                    response = client.request(method, path, json={}, headers={"Origin": ORIGIN})
                    self.assertEqual(response.status_code, status, (method, route.path, response.text))
                checked += 1
        self.assertGreaterEqual(checked, 20)


if __name__ == "__main__":
    unittest.main()
```

```bash
cd /Users/optyne/repository/b300/sell-panel/powerchampion-marketplace/.worktrees/a2c-ops
.venv-portal/bin/python -m unittest server.test_routes server.test_accounts 2>&1 | tail -4
```
Expected：OK（舊結構上就該綠）。若 `test_every_admin_route_refuses_customers_and_anonymous_callers` 抓到某條 admin 路由在驗權前先讀 body 或回別的狀態：**這是真發現，不要改測試**，停下來回報該路由。

- [ ] **Step 4: 搬移**

依上方 Interfaces 建三個模組、改 `app.py`。只搬不改：函式本體、錯誤碼、訊息字串、審計名、SQL 全部逐字保留；閉包內對 `store`／`gateway`／`settings` 的引用改成 `ctx.store`／`ctx.gateway`／`ctx.settings`；原本呼叫 `require_gateway()`／`gateway_call(...)`／`provision_key(...)` 改為 `ctx.` 方法。模組只 import `server.support`、`server.store`、`server.gateway`、`server.security`，**不 import `server.app`**（避免循環）。

- [ ] **Step 5: 驗證（行為不變的證據）**

```bash
cd /Users/optyne/repository/b300/sell-panel/powerchampion-marketplace/.worktrees/a2c-ops
.venv-portal/bin/python - > .superpowers/sdd/2026-10-21-a2c/routes-after.txt <<'EOF'
import tempfile
from server.app import create_app
from server.settings import Settings
app = create_app(Settings(db_path=tempfile.mkdtemp() + "/routes.sqlite"))
for path, methods in sorted((r.path, ",".join(sorted(getattr(r, "methods", None) or []))) for r in app.routes):
    print(methods, path)
EOF
diff .superpowers/sdd/2026-10-21-a2c/routes-before.txt .superpowers/sdd/2026-10-21-a2c/routes-after.txt && echo ROUTES_IDENTICAL
.venv-portal/bin/python -m py_compile server/app.py server/support.py server/admin_accounts.py server/admin_gateway.py
.venv-portal/bin/python -m unittest discover -s server -t . -p 'test_*.py' 2>&1 | tail -4
bash scripts/test_backend_postgres.sh 2>&1 | tail -4
wc -l server/app.py server/support.py server/admin_accounts.py server/admin_gateway.py
grep -n "def gateway_fail\|def provision_key\|def admin_target" server/app.py
```
Expected：`ROUTES_IDENTICAL`；兩種後端測試數 = BASE＋2（`test_routes` 的兩條；`PortalCase` 不含測試，搬移不改數量），失敗僅 BASE 的環境相依那條；`grep` 無輸出（這些函式已不在 app.py）。

- [ ] **Step 6: commit**

```bash
cd /Users/optyne/repository/b300/sell-panel/powerchampion-marketplace/.worktrees/a2c-ops
git status --short
git add server/support.py server/admin_accounts.py server/admin_gateway.py server/app.py server/testsupport.py server/test_accounts.py server/test_routes.py
git commit -m "portal: split admin routes and shared gateway helpers out of app.py (no behaviour change)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 1B: 前端重構——拆 `admin-portal.tsx`、`admin-keys-section.tsx`、`admin-gateway-section.tsx`（行為不變）

**Files:**
- Create: `components/admin-customers-section.tsx`（`CustomersSection` 與專用型別）、`components/admin-account-dialog.tsx`（`AccountActionDialog`，約 230 行）、`components/admin-credits-section.tsx`（`ReviewDialog`＋`CreditsSection`＋`moneyLabel`、`statusLabel`——只有這裡用）、`components/admin-overview-section.tsx`（`OverviewSection`）、`components/admin-audit-section.tsx`（`AuditSection`）、`components/admin-keys-dialogs.tsx`（`IssueKeyDialog`、`LimitsDialog`、`TopUpDialog`、`SecretDialog`、`ErrorLine`、`parseOptionalCount`、`parseUsd`、`MAX_USD`，以及 `GatewayKey`、`CustomerOption`、`IssuedKey` 型別，export section 需要的部分）、`components/admin-gateway-panels.tsx`（`BlockError`、`JobStatus`、`MaintenanceDialog`、`ConfirmNodeDialog`、`GpuPanel`、`asRecord`／`pick`／`finite`／`text`、`ACTION_ZH`、`NODE_ACTIONS`、`TERMINAL_STATES`、`POLL_MS`、`MAX_POLLS`、`GatewayModel`／`GatewayNode`／`GatewayOverview`／`Job` 型別）
- Modify: `components/admin-resource.tsx`（收 `GatewayNotConnected`，逐字搬自 `admin-keys-section.tsx:73-82`）、`components/admin-keys-section.tsx`、`components/admin-gateway-section.tsx`、`components/admin-usage-section.tsx`（`GatewayNotConnected` 改從 `./admin-resource` import）、`components/admin-portal.tsx`（只留 `AdminSection`、`AdminPortal` 與 section import）

- [ ] **Step 1: 基準**：`npx vitest run 2>&1 | tail -5`、`wc -l components/admin-*.tsx`（記錄）。
- [ ] **Step 2: 搬移**（JSX、文案、className、aria 全部逐字；只動 import／export）。`tests/` 只 import `AdminPortal`、`AdminShell`、`AdminAllocationSection`，不需改測試。
- [ ] **Step 3: 驗證**

```bash
cd /Users/optyne/repository/b300/sell-panel/powerchampion-marketplace/.worktrees/a2c-ops
npx vitest run 2>&1 | tail -5
npx tsc --noEmit 2>&1 | grep -c "error TS"
npm run lint 2>&1 | tail -3
npm test 2>&1 | tail -6
wc -l components/admin-portal.tsx components/admin-keys-section.tsx components/admin-keys-dialogs.tsx components/admin-gateway-section.tsx components/admin-gateway-panels.tsx components/admin-customers-section.tsx components/admin-credits-section.tsx
grep -rn "from \"./admin-keys-section\"" components | grep GatewayNotConnected
```
Expected：vitest 數 = BASE、0 failed；tsc／lint 不多於 BASE；`npm test`（含 build 與 rendered-html）通過；`admin-portal.tsx` ≤ 200 行、其餘每檔 ≤ 450 行；最後的 grep 無輸出。
- [ ] **Step 4: commit**（`git add` 上列 components 檔；訊息 `admin: split oversized admin components along their dialog and panel seams (no behaviour change)`＋attribution）。

---

### Task 2: A2b 安全／正確性尾巴（四項）

**Files:**
- Modify: `server/support.py`（`gateway_error_code`、`PortalContext.audit`、`provision_key` 的 401／403）、`server/admin_gateway.py`（overview errors、toggle 設定語意、enable 受上限約束）、`server/testsupport.py`（`FakeGateway` 的 state／toggle 變成有狀態）
- Modify: `server/test_accounts.py`（新測試＋更新既有 toggle 測試）
- Modify: `components/admin-gateway-section.tsx`（toggle 送 `{enabled}`）、`components/admin-keys-dialogs.tsx`（下拉只列 `role === "customer"`）、`tests/portal-ui.test.tsx`

**Interfaces：**
- `support.gateway_error_code(error) -> str`：`GatewayError` 且 `code=="rejected"` 且 `status in (401, 403)` → `"gateway_auth_failed"`；其他 `GatewayError` → `error.code`；非 `GatewayError` → `"unavailable"`。`GET /admin/gateway` 的 `errors.*` 改用它。
- `PortalContext.audit(action, actor, target=None, details=None)`：`with self.store.connect() as con: self.store.audit(con, action, actor["id"], target, details)`。
- `provision_key`：`except GatewayError as error:` 若 401／403 → `fail("gateway_auth_failed", "The portal's gateway token was rejected. Check PC_GATEWAY_ADMIN_TOKEN.", 503)`，否則維持原本的 `gateway_unavailable` 訊息。（`finally` 釋放 reservation 不變。）
- `POST /admin/gateway/models/{id}/toggle` body `{enabled: bool}`（缺或非 bool → 422 `invalid_input`，不呼叫閘道）。流程：`state = await ctx.gateway_call(ctx.gateway.state)` → 在 `state["models"]` 找 `id == model_id`；找不到 → 404 `gateway_rejected` "Model not found."；目前狀態 `current = model.get("enabled") is not False`（閘道把缺省視為啟用，`/api/state` 會給 `None`）；`current == enabled` → 200 `{id, enabled, changed: false}`，不翻、不審計；否則 `result = await ctx.gateway_call(ctx.gateway.toggle_model, model_id)`，審計 `admin.model_toggled` details `{requested: enabled, enabled: result.get("enabled")}`；`result.get("enabled") is not enabled` → 409 `state_changed`（"The model changed while this request was in flight. Refresh and check its state."）；否則回 `dict(result, changed=True)`。（讀與翻之間仍有很小的競態，閘道沒有「設定」API；記在 README。）
- `POST /admin/keys/{id}/disable {disabled:false}`：查詢改為 `SELECT k.id, k.user_id, k.status, u.disabled_at FROM gateway_keys k JOIN users u ON u.id=k.user_id WHERE k.gateway_key_id=?`；帳號停用 → 409 `account_disabled`（不變）；本地列 `status=='revoked'` → `reservation = store.reserve_key_slot(owner["user_id"])`，`None` → 409 `key_limit` "This account already has the maximum number of active keys. Disable one first."（不呼叫閘道、不審計）；閘道成功後在同一個 `BEGIN IMMEDIATE` 交易裡 UPDATE 為 active 並 `DELETE FROM key_reservations WHERE id=?`；`finally: store.release_key_slot(reservation)`（若有）。無本地擁有者或本地已 active 的 key 不檢查上限。
- 前端：`toggleModel` 送 `body: JSON.stringify({ enabled: !model.enabled })`；`IssueKeyDialog` 的 `active` 過濾改為 `customer.status === "active" && customer.role === "customer"`，`CustomerOption` 加 `role`。`portal-client.ts` 在 Task 7 才加 `key_limit`／`state_changed` 文案（本 Task 先用狀態碼通用文案）。

- [ ] **Step 1: FakeGateway 改成有狀態**（`server/testsupport.py`）：

```python
        self.state_value = {"models": [{"id": "glm-5.3", "enabled": False}, {"id": "zai-org/GLM-5.3", "enabled": False}],
                            "nodes": [], "gateway": {"public_base_url": "https://gateway.example"}}
...
    async def toggle_model(self, model_id):
        self._maybe_fail()
        model = next((m for m in self.state_value["models"] if m["id"] == model_id), None)
        if model is None:
            raise GatewayError("rejected", 404, "Model not found.")
        model["enabled"] = not model["enabled"]
        self.toggled.append(model_id)
        return {"id": model_id, "enabled": model["enabled"]}
```

- [ ] **Step 2: 失敗的測試**（`server/test_accounts.py`）

```python
# AdminGatewayTests
    def test_overview_reports_a_rejected_token_as_auth_failure(self):
        admin = self.admin()
        self.gateway.reject = 401
        body = admin.get(BASE + "/admin/gateway").json()
        self.assertEqual(body["errors"], {"state": "gateway_auth_failed", "nodes": "gateway_auth_failed", "metrics": "gateway_auth_failed"})

    def test_toggle_sets_the_requested_state_instead_of_flipping(self):
        admin = self.admin()
        r = self.post(admin, "/admin/gateway/models/glm-5.3/toggle", {"enabled": False})
        self.assertEqual((r.status_code, r.json()), (200, {"id": "glm-5.3", "enabled": False, "changed": False}))
        self.assertEqual((self.gateway.toggled, self.audit("admin.model_toggled")), ([], []))
        r = self.post(admin, "/admin/gateway/models/glm-5.3/toggle", {"enabled": True})
        self.assertEqual((r.status_code, r.json()["enabled"], r.json()["changed"]), (200, True, True))
        self.assertEqual(self.gateway.toggled, ["glm-5.3"])
        self.assertEqual(json.loads(self.audit("admin.model_toggled")[0]["details"]), {"enabled": True, "requested": True})
        for bad in ({}, {"enabled": "yes"}, {"enabled": 1}):
            self.assertEqual(self.post(admin, "/admin/gateway/models/glm-5.3/toggle", bad).status_code, 422, bad)
        self.assertEqual(self.post(admin, "/admin/gateway/models/glm-9/toggle", {"enabled": True}).status_code, 404)
        self.assertEqual(self.gateway.toggled, ["glm-5.3"])

    def test_toggle_race_is_reported_and_audited(self):
        admin = self.admin()

        async def raced(model_id):
            self.gateway.toggled.append(model_id)
            return {"id": model_id, "enabled": False}

        self.gateway.toggle_model = raced
        r = self.post(admin, "/admin/gateway/models/glm-5.3/toggle", {"enabled": True})
        self.assertEqual((r.status_code, r.json()["error"]), (409, "state_changed"))
        self.assertEqual(len(self.audit("admin.model_toggled")), 1)

# AdminAccountTests
    def test_issue_with_a_rejected_gateway_token_is_an_auth_failure(self):
        admin = self.admin()
        user = self.register(self.client(), "a@example.test")
        self.gateway.reject = 401
        r = self.post(admin, f"/admin/customers/{user['id']}/keys", {"label": "A", "prepaidUsd": 5})
        self.assertEqual((r.status_code, r.json()["error"]), (503, "gateway_auth_failed"))
        self.assertNotIn("private upstream token", r.text)
        self.assertEqual((rows(self.store, "gateway_keys"), rows(self.store, "key_reservations")), ([], []))

# AdminKeysTests
    def test_enable_respects_the_active_key_cap(self):
        admin = self.admin()
        user = self.register(self.client(), "a@example.test")
        with self.store.connect() as con:
            for n in range(20):
                con.execute("INSERT INTO gateway_keys VALUES (?,?,?,?,?,?,?,NULL)", ("local-%d" % n, user["id"], "gk-%d" % n, "k", "sk-%d" % n, "active", 1))
            con.execute("INSERT INTO gateway_keys VALUES (?,?,?,?,?,?,?,?)", ("local-x", user["id"], "gk-x", "k", "sk-x", "revoked", 1, 2))
        r = self.post(admin, "/admin/keys/gk-x/disable", {"disabled": False})
        self.assertEqual((r.status_code, r.json()["error"]), (409, "key_limit"))
        self.assertEqual((self.gateway.enabled, self.audit("admin.key_enabled"), rows(self.store, "key_reservations")), ([], [], []))
        with self.store.connect() as con:
            con.execute("UPDATE gateway_keys SET status='revoked' WHERE id='local-0'")
        self.assertEqual(self.post(admin, "/admin/keys/gk-x/disable", {"disabled": False}).status_code, 200)
        self.assertEqual(self.gateway.enabled, ["gk-x"])
        self.assertEqual(rows(self.store, "key_reservations"), [])
        self.assertEqual(next(k for k in rows(self.store, "gateway_keys") if k["id"] == "local-x")["status"], "active")
```

並更新既有 `AdminGatewayTests`：`test_model_and_node_actions_are_audited` 的 toggle 改送 `{"enabled": True}`（預期 `enabled` True）；`test_model_id_with_slash_and_empty_maintenance_message` 的 toggle 改送 `{"enabled": True}`；`test_gateway_rejection_and_outage_are_mapped_and_not_audited` 與 `test_unconfigured_gateway_refuses_writes` 的 toggle 改送 `{"enabled": True}`（預期碼不變：404 `gateway_rejected`、503 `provider_not_configured`）；`AdminKeysTests.test_rejected_gateway_token_is_reported_as_auth_failure`（`test_accounts.py:508-519`，對 toggle 送 `{}` 期待 503 `gateway_auth_failed`）改送 `{"enabled": True}`；`test_customer_forbidden` 不變。**檢查順序固定為 `current_user` → `gateway_path` → body（`enabled` 必須是 bool）→ 閘道**，這樣 `test_bad_path_parameters_never_reach_the_gateway` 與 `test_dot_segment_model_ids_never_reach_the_gateway`（`test_accounts.py:720-738`，送 `{}` 或 `{"message": "x"}`）仍得到 400／404 而不是 422。

`tests/portal-ui.test.tsx`：
- 「toggles a model using an encoded id」加斷言：該 POST 的 `body` 為 `{ enabled: false }`；「…enables without a dialog」加斷言 `{ enabled: true }`。
- `describe("admin keys section")` 新增：`/admin/customers` 回兩個 active（一個 `role:"admin"`、一個 `role:"customer"`）＋一個 disabled customer；開「Issue key for a customer」對話框，下拉選項只有那個 active customer 的 email。

```bash
cd /Users/optyne/repository/b300/sell-panel/powerchampion-marketplace/.worktrees/a2c-ops
.venv-portal/bin/python -m unittest server.test_accounts 2>&1 | tail -4
npx vitest run tests/portal-ui.test.tsx 2>&1 | tail -5
```
Expected：新測試失敗（auth 碼、toggle 語意、cap、下拉）。

- [ ] **Step 3: 實作**（依 Interfaces）。
- [ ] **Step 4: 驗證**：兩種後端全量、`npx vitest run`、`npx tsc --noEmit`、`npm run lint`。Expected：BASE＋新增數、0 新失敗。
- [ ] **Step 5: commit**（`portal: report rejected gateway tokens, set model state explicitly, cap key re-enables, keep admins out of key issuance`）。

---

### Task 3: Adapter——personas、fleet、control job、redeem

**Files:**
- Modify: `server/gateway.py`、`server/test_portal.py`（`GatewayAdapterTests`）、`server/testsupport.py`（`FakeGateway`）

**Step 1: 失敗的 adapter 測試**（`GatewayAdapterTests`，沿用 `self.transport`；需要攔截 client 參數時另寫 `patch("server.gateway.httpx.AsyncClient", side_effect=...)` 把 kwargs 存起來）

```python
    async def test_persona_contracts(self):
        with self.transport(lambda _: httpx.Response(200, json={"personas": [{"persona_id": "abc123def456", "name": "S"}, "junk"]})):
            listing = await self.gateway.list_personas()
        self.assertEqual(listing["personas"], [{"persona_id": "abc123def456", "name": "S"}])
        with self.transport(lambda _: httpx.Response(200, json={"persona": {"persona_id": "abc123def456"}, "revisions": []})):
            await self.gateway.get_persona("abc123def456", 3)
        self.assertTrue(str(self.requests[-1].url).endswith("/api/personas/abc123def456?rev=3"))
        with self.transport(lambda _: httpx.Response(200, json={"rev": 4})):
            rev = await self.gateway.save_persona_revision("abc123def456", system="s", examples=[{"user": "u", "assistant": "a"}], note="n", activate=False)
        self.assertEqual(rev, 4)
        self.assertEqual(json.loads(self.requests[-1].content), {"system": "s", "examples": [{"user": "u", "assistant": "a"}], "note": "n", "activate": False})
        with self.assertRaises(GatewayError):
            await self.gateway.get_persona("../x")
        with self.transport(lambda _: httpx.Response(200, json={"rev": True})):
            with self.assertRaises(GatewayError):
                await self.gateway.save_persona_revision("abc123def456", system="", examples=[], note="", activate=True)

    async def test_persona_try_gets_a_longer_timeout(self):
        seen = []

        def client(**kwargs):
            seen.append(kwargs)
            return self.real_client(transport=httpx.MockTransport(lambda r: httpx.Response(200, json={"input": "x", "results": []})), **kwargs)

        with patch("server.gateway.httpx.AsyncClient", side_effect=client):
            await self.gateway.try_persona("abc123def456", text="x", revs=[None], max_tokens=300, temperature=0.8)
        self.assertGreaterEqual(seen[0]["timeout"], 90)

    async def test_fleet_actions_send_no_body_and_validate(self):
        with self.transport(lambda _: httpx.Response(202, json={"job_id": "0123456789abcdef", "state": "queued", "phase": "queued"})):
            value = await self.gateway.fleet_action("glm-5.2-fp8", "candidate")
        self.assertEqual(self.requests[0].url.path, "/api/fleet/glm-5.2-fp8/candidate")
        self.assertEqual(self.requests[0].content, b"")
        self.assertEqual(value["job_id"], "0123456789abcdef")
        for model, action in (("glm-5.2-fp8", "delete"), ("a/b", "freeze"), ("..", "freeze")):
            with self.assertRaises(GatewayError):
                await self.gateway.fleet_action(model, action)
        with self.assertRaises(ValueError):
            await self.gateway.fleet_events(limit=501)
        with self.transport(lambda _: httpx.Response(409, json={"detail": "workflow already active"})):
            with self.assertRaises(GatewayError) as caught:
                await self.gateway.fleet_action("glm-5.2-fp8", "drain")
        self.assertEqual((caught.exception.status, caught.exception.detail), (409, "workflow already active"))

    async def test_control_job_is_projected(self):
        job = {"id": "0123456789abcdef", "kind": "candidate", "model_id": "m", "state": "running", "phase": "warming", "reason": "",
               "created_at": 1.0, "updated_at": 2.0, "route_before": {"x": {"enabled": True}}, "admin_token": "t"}
        with self.transport(lambda _: httpx.Response(200, json=job)):
            value = await self.gateway.control_job("0123456789abcdef")
        self.assertEqual(set(value), {"id", "kind", "model_id", "state", "phase", "reason", "created_at", "updated_at"})
        self.assertEqual(self.requests[0].url.path, "/api/control/jobs/0123456789abcdef")

    async def test_redeem_issue_validates_the_array_and_never_leaks_codes(self):
        codes = [{"code": "A" * 32, "code_id": "c1", "nano_usd": 5_000_000_000}, {"code": "B" * 32, "code_id": "c2", "nano_usd": 5_000_000_000}]
        with self.transport(lambda _: httpx.Response(200, json=codes)):
            value = await self.gateway.issue_redeem_codes(amount_usd=Decimal("5"), count=2, label="L", expires_days=30)
        self.assertEqual(json.loads(self.requests[0].content), {"amount_usd": 5.0, "count": 2, "label": "L", "expires_days": 30})
        self.assertEqual([c["code_id"] for c in value], ["c1", "c2"])
        with self.transport(lambda _: httpx.Response(200, json=codes[:1])):
            with self.assertRaises(GatewayError) as caught:
                await self.gateway.issue_redeem_codes(amount_usd=5, count=2, label="L")
        self.assertEqual(caught.exception.code, "invalid_response")
        self.assertNotIn("A" * 32, repr(caught.exception) + caught.exception.detail)
        with self.transport(lambda _: httpx.Response(200, json={"codes": codes})):
            with self.assertRaises(GatewayError):
                await self.gateway.issue_redeem_codes(amount_usd=5, count=2, label="L")

    async def test_redeem_csv_requires_csv_and_the_known_header(self):
        header = "code_id,code_hash,nano_usd,label,created_at,created_by,redeemed_at,redeemed_by_key_id,disabled_at,expires_at\r\n"
        with self.transport(lambda _: httpx.Response(200, text=header + "c1,h,1000000000,L,1.0,admin,,,,\r\n", headers={"content-type": "text/csv; charset=utf-8"})):
            rows = await self.gateway.redeem_code_rows()
        self.assertEqual(rows, [["c1", "h", "1000000000", "L", "1.0", "admin", "", "", "", ""]])
        with self.transport(lambda _: httpx.Response(200, json={"ok": True})):
            with self.assertRaises(GatewayError):
                await self.gateway.redeem_code_rows()
        with self.transport(lambda _: httpx.Response(200, text="wrong,header\r\n", headers={"content-type": "text/csv"})):
            with self.assertRaises(GatewayError):
                await self.gateway.redeem_code_rows()
```
（`test_portal.py` 需要 `from decimal import Decimal`。）

```bash
cd /Users/optyne/repository/b300/sell-panel/powerchampion-marketplace/.worktrees/a2c-ops
.venv-portal/bin/python -m unittest server.test_portal.GatewayAdapterTests 2>&1 | tail -4
```
Expected：AttributeError／TypeError 失敗。

**Step 2: 實作 `server/gateway.py`**

```python
import csv
import io
...
PERSONA_ID = re.compile(r"[A-Za-z0-9_-]{1,64}")
FLEET_MODEL_ID = re.compile(r"[A-Za-z0-9._:-]{1,128}")
CODE_ID = re.compile(r"[A-Za-z0-9_-]{1,64}")
REDEEM_CODE = re.compile(r"[A-Za-z0-9_-]{16,128}")
FLEET_ACTIONS = frozenset({"freeze", "resume", "candidate", "drain", "approve", "rollback"})
CONTROL_JOB_FIELDS = ("id", "kind", "model_id", "state", "phase", "reason", "created_at", "updated_at")
REDEEM_CSV_HEADER = ["code_id", "code_hash", "nano_usd", "label", "created_at", "created_by",
                     "redeemed_at", "redeemed_by_key_id", "disabled_at", "expires_at"]
PERSONA_TRY_TIMEOUT = 90


def _positive_int(value, maximum, name):
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= maximum:
        raise ValueError(name + " out of range")
    return value
```

`_request(self, method, path, payload=None, *, timeout=15, expect="object")`：`httpx.AsyncClient(timeout=timeout, …)`；成功後：

```python
                    if expect == "csv":
                        if not response.headers.get("content-type", "").lower().startswith("text/csv"):
                            raise GatewayError("invalid_response")
                        return bytes(data).decode("utf-8")
                    value = json.loads(data)
                    if not isinstance(value, list if expect == "array" else dict):
                        raise GatewayError("invalid_response")
                    return value
```

新方法：

```python
    # personas
    async def list_personas(self):
        value = await self._request("GET", "/api/personas")
        if not isinstance(value.get("personas"), list):
            raise GatewayError("invalid_response")
        return {"personas": [p for p in value["personas"] if isinstance(p, dict)]}

    async def get_persona(self, persona_id, rev=None):
        path = "/api/personas/" + _identifier(persona_id, PERSONA_ID)
        if rev is not None:
            path += "?rev=" + str(_positive_int(rev, 10 ** 9, "rev"))
        value = await self._request("GET", path)
        if not isinstance(value.get("persona"), dict) or not isinstance(value.get("revisions"), list):
            raise GatewayError("invalid_response")
        return value

    async def create_persona(self, name):
        value = await self._request("POST", "/api/personas", {"name": name})
        persona_id = value.get("persona_id")
        if not isinstance(persona_id, str) or not PERSONA_ID.fullmatch(persona_id):
            raise GatewayError("invalid_response")
        return persona_id

    async def save_persona_revision(self, persona_id, *, system, examples, note, activate):
        value = await self._request("POST", "/api/personas/" + _identifier(persona_id, PERSONA_ID) + "/revisions",
                                    {"system": system, "examples": examples, "note": note, "activate": bool(activate)})
        rev = value.get("rev")
        if isinstance(rev, bool) or not isinstance(rev, int) or rev < 1:
            raise GatewayError("invalid_response")
        return rev

    async def activate_persona(self, persona_id, rev):
        value = await self._request("POST", "/api/personas/" + _identifier(persona_id, PERSONA_ID) + "/activate",
                                    {"rev": _positive_int(rev, 10 ** 9, "rev")})
        if value.get("ok") is not True:
            raise GatewayError("invalid_response")

    async def try_persona(self, persona_id, *, text, revs, max_tokens, temperature):
        value = await self._request("POST", "/api/personas/" + _identifier(persona_id, PERSONA_ID) + "/try",
                                    {"input": text, "revs": revs, "max_tokens": max_tokens, "temperature": temperature},
                                    timeout=PERSONA_TRY_TIMEOUT)
        if not isinstance(value.get("results"), list):
            raise GatewayError("invalid_response")
        return value

    # fleet
    async def fleet_status(self, model_id):
        value = await self._request("GET", "/api/fleet/" + _identifier(model_id, FLEET_MODEL_ID) + "/status")
        workflow = value.get("workflow")
        if isinstance(workflow, dict):
            # routing/capacity snapshots are internal; the panel needs ids and state only
            value["workflow"] = {k: v for k, v in workflow.items() if k not in ("route_before", "capacity_before")}
        return value

    async def fleet_timeline(self, model_id):
        value = await self._request("GET", "/api/fleet/" + _identifier(model_id, FLEET_MODEL_ID) + "/timeline")
        if not isinstance(value.get("events"), list):
            raise GatewayError("invalid_response")
        return value

    async def fleet_events(self, model_id=None, limit=100):
        query = "?limit=" + str(_positive_int(limit, 500, "limit"))
        if model_id is not None:
            query += "&model_id=" + _identifier(model_id, FLEET_MODEL_ID)
        value = await self._request("GET", "/api/fleet/events" + query)
        if not isinstance(value.get("events"), list):
            raise GatewayError("invalid_response")
        return value

    async def fleet_action(self, model_id, action):
        model_id = _identifier(model_id, FLEET_MODEL_ID)
        if action not in FLEET_ACTIONS:
            raise GatewayError("invalid_identifier")
        return await self._request("POST", "/api/fleet/" + model_id + "/" + action)

    async def control_job(self, job_id):
        value = await self._request("GET", "/api/control/jobs/" + _identifier(job_id, JOB_ID))
        return {name: value.get(name) for name in CONTROL_JOB_FIELDS}

    # redeem codes — plaintext codes only ever travel in the return value
    async def issue_redeem_codes(self, *, amount_usd, count, label, expires_days=None):
        amount = Decimal(str(amount_usd))
        if not amount.is_finite() or amount <= 0:
            raise ValueError("amount_usd must be positive")
        payload = {"amount_usd": float(amount), "count": _positive_int(count, 10000, "count"), "label": label}
        if expires_days is not None:
            payload["expires_days"] = _positive_int(expires_days, 3650, "expires_days")
        value = await self._request("POST", "/api/redeem/codes", payload, expect="array")
        nano = int(round(float(amount) * 1_000_000_000))
        codes = []
        for item in value:
            if (not isinstance(item, dict) or not isinstance(item.get("code"), str) or not REDEEM_CODE.fullmatch(item["code"])
                    or not isinstance(item.get("code_id"), str) or not CODE_ID.fullmatch(item["code_id"])
                    or isinstance(item.get("nano_usd"), bool) or item.get("nano_usd") != nano):
                raise GatewayError("invalid_response")
            codes.append({"code": item["code"], "code_id": item["code_id"], "nano_usd": nano})
        if len(codes) != count:
            raise GatewayError("invalid_response")
        return codes

    async def list_redeem_codes(self):
        return [item for item in await self._request("GET", "/api/redeem/codes", expect="array") if isinstance(item, dict)]

    async def disable_redeem_code(self, code_id):
        value = await self._request("POST", "/api/redeem/codes/" + _identifier(code_id, CODE_ID) + "/disable")
        if value.get("ok") is not True:
            raise GatewayError("invalid_response")

    async def redeem_code_rows(self):
        text = await self._request("GET", "/api/redeem/codes.csv", expect="csv")
        rows = list(csv.reader(io.StringIO(text)))
        if not rows or rows[0] != REDEEM_CSV_HEADER or any(len(row) != len(REDEEM_CSV_HEADER) for row in rows[1:]):
            raise GatewayError("invalid_response")
        return rows[1:]
```

**Step 3: `FakeGateway` 擴充**（`server/testsupport.py`；全部先 `self._maybe_fail()`）：

```python
        # __init__ additions
        self.personas = {"p1": {"persona_id": "p1", "name": "Support", "created_at": 1.0, "active_rev": 1,
                                "revisions": [{"rev": 1, "system": "Be kind.", "examples": [], "note": "first", "author": "admin", "created_at": 1.0}]}}
        self.persona_calls = []
        self.try_delay = 0
        self.fleet_managed = {"glm-5.2-fp8"}
        self.fleet_calls = []
        self.job_value = {"id": "wf-1", "kind": "candidate", "model_id": "glm-5.2-fp8", "state": "awaiting_approval",
                          "phase": "ready", "reason": "", "created_at": 1.0, "updated_at": 2.0}
        self.redeem_codes, self.issued_codes, self.disabled_codes = [], [], []
```
方法（`fleet_calls` 只記 events 與 actions，且在受管檢查**之後**才記：events 記 `("events", model_id, limit)`、actions 記 `(model_id, action)`；status／timeline 不記）：`list_personas`（每筆 `persona_id,name,created_at,active_rev,latest_rev`）、`get_persona(persona_id, rev=None)`（記 `("get", id, rev)`；不存在 `GatewayError("rejected", 404, "No such persona.")`；回 `{persona, revisions}` 與閘道同形）、`create_persona(name)`（id `"p%d"`，`active_rev=None`、`revisions=[]`；之後 `get_persona` 回的 `persona` 不含 rev 類欄位，與閘道相同）、`save_persona_revision(...)`（不存在的 persona → 404 "No such persona."；成功才記 `("revision", id, rev, activate)`；activate 時更新 `active_rev`）、`activate_persona(id, rev)`（不存在的 persona 或 rev → 404 "No such revision."；成功才記 `("activate", id, rev)`）、`try_persona(...)`（`await asyncio.sleep(self.try_delay)`；記 `("try", id, tuple(revs), max_tokens, temperature)`；回 `{"input": text, "results": [{"rev": r, "reply": "ok", "usage": {"prompt_tokens": 5, "completion_tokens": 3}} for r in revs]}`）；`fleet_status` 回 `{"model_id", "enabled": True, "draining": False, "frozen": False, "capacity": None, "workflow": None}`、`fleet_timeline` 回 `{"model_id", "events": []}`、`fleet_events` 回 `{"events": []}`；`fleet_status`／`fleet_timeline`／`fleet_events(model_id=None, limit=100)`／`fleet_action(model_id, action)`（非 `fleet_managed` → `GatewayError("rejected", 404, "Managed model not found.")`；freeze／resume 回 CapacityState 形 `{"model_id", "mode": "frozen"|"observe", "sellable_cap": 8, "physical_cap": 8, "reason": "operator", "policy_version": "v1", "observed_at": 1.0, "event_id": 1}`，其他回 `{"job_id": "wf-%d" % len(self.fleet_calls), "state": "queued", "phase": "queued"}`）；`control_job(job_id)`（`"missing"` → 404 "Switch job not found."，否則 `dict(self.job_value, id=job_id)`）；`issue_redeem_codes(...)`（明文 `"PlainRedeemCode-%04d-abcdefghijkl" % n` 存入 `issued_codes`，閘道側 row 存入 `redeem_codes`，不含明文）、`list_redeem_codes()`（新到舊的 row 副本）、`disable_redeem_code(code_id)`（不存在或已停用 → 404 "Code not found or already disabled."）、`redeem_code_rows()`（每筆 `[code_id, "hash-"+code_id, str(nano), label, str(created_at), created_by, "", "", "", ""]`）。

**Step 4: 驗證**

```bash
cd /Users/optyne/repository/b300/sell-panel/powerchampion-marketplace/.worktrees/a2c-ops
.venv-portal/bin/python -m unittest server.test_portal.GatewayAdapterTests -v 2>&1 | tail -12
.venv-portal/bin/python -m unittest discover -s server -t . -p 'test_*.py' 2>&1 | tail -4
```
Expected：adapter 測試全綠、全量 0 新失敗（FakeGateway 擴充不影響既有測試）。

**Step 5: commit**（`portal: gateway adapter for personas, fleet workflows, control jobs and redeem codes`）。

---

### Task 4: Personas 後端路由（`server/admin_personas.py`）

**Files:**
- Create: `server/admin_personas.py`、`server/test_admin_personas.py`
- Modify: `server/support.py`（`gateway_call` 加 `not_found` 與 kwargs）、`server/app.py`（`attach_admin_personas(application, ctx)`）

**Interfaces：**
- `PortalContext.gateway_call(call, *args, not_found=None, **kwargs)`：`not_found=(code, detail)` 時，`GatewayError` `rejected` 且 `status==404` → `fail(code, detail, 404)`；其餘同原本。既有呼叫點不受影響。
- 驗證（全部 422 `invalid_input`，`name` 用既有 `text_value` 為 400）：
  - `name`：`text_value(…, "persona name", 80)`。
  - `system`：str、≤ 32000 字、可空、除 `\n\r\t` 外不得有控制字元。
  - `examples`：list、≤ 50；每項 dict 只能有 `user`／`assistant` 兩個鍵；兩者皆 str（缺＝`""`）、各 ≤ 4000、同上控制字元規則、至少一個非空白；送出清理後的 list。
  - `note`：str（缺＝`""`）、≤ 200、單行（`text_value(..., required=False)` 語意但回 422）。
  - `activate`：**必填** bool（portal 不沿用閘道「省略＝立即啟用」的預設；理由：啟用即影響正在使用該 persona 的流量，要明確選擇）。
  - revisions body 上限：`body_json(request, maximum=196608)`（超過 413）。
  - activate 的 `rev`：int 1..10^9（bool 不算）。
  - try：`input` 1..4000 字（允許換行，去掉頭尾空白後不得為空）；`revs` 預設 `[None]`，list 長度 1..2，每項 `None` 或 int 1..10^9；`maxTokens` 預設 300、int 1..1024；`temperature` 預設 0.8、int 或 float、0..2（bool 不算）。不接受 `history`（A2c 不做多輪試跑）。
  - `GET /admin/personas/{id}?rev=`：FastAPI `rev: int | None = None`，`rev < 1` → 400 `invalid_input`；路徑參數先 `gateway_path(persona_id, PERSONA_ID)`。
- `GET /admin/personas`：閘道未設定 → **200** `{gatewayConfigured: false, personas: []}`（與金鑰／兌換碼清單相同；BFF 會把 503 `provider_not_configured` 改寫成 `service_unavailable`，所以清單不能用 503 表示未連線）；已設定 → `{gatewayConfigured: true, personas: [...]}`。其餘 persona 路由未設定時維持 503 `provider_not_configured`（使用者只會在清單已顯示「未連線」時才可能打到）。
- 回應：檢視與 try 原樣轉回閘道 JSON；create 回 201 `{"persona_id": id}`；revisions 回 `{"rev": n}`；activate 回 `{"ok": true}`。
- 審計見總表 #3–#6（`ctx.audit(...)`，在閘道成功之後）。`persona_not_found` detail："This persona or revision does not exist."

- [ ] **Step 1: 失敗的測試**（`server/test_admin_personas.py`，繼承 `PortalCase`）

```python
import json
import unittest

from server.gateway import GatewayError
from server.testsupport import BASE, PortalCase, rows


class AdminPersonaTests(PortalCase):
    def details(self, action):
        return [json.loads(e["details"]) if e["details"] else None for e in self.audit(action)]

    def test_list_and_view_pass_through(self):
        admin = self.admin()
        self.assertEqual([p["persona_id"] for p in admin.get(BASE + "/admin/personas").json()["personas"]], ["p1"])
        body = admin.get(BASE + "/admin/personas/p1?rev=1").json()
        self.assertEqual((body["persona"]["rev"], len(body["revisions"])), (1, 1))
        self.assertIn(("get", "p1", 1), self.gateway.persona_calls)
        r = admin.get(BASE + "/admin/personas/nope")
        self.assertEqual((r.status_code, r.json()["error"]), (404, "persona_not_found"))
        self.assertEqual(admin.get(BASE + "/admin/personas/p1?rev=0").status_code, 400)
        self.assertEqual(admin.get(BASE + "/admin/personas/bad%20id").status_code, 400)

    def test_create_revise_activate_try_are_audited_without_content(self):
        admin = self.admin()
        r = self.post(admin, "/admin/personas", {"name": "Sales"})
        self.assertEqual(r.status_code, 201, r.text)
        pid = r.json()["persona_id"]
        r = self.post(admin, f"/admin/personas/{pid}/revisions", {"system": "Line one\nLine two", "examples": [{"user": "hi", "assistant": "hello"}], "note": "v1", "activate": False})
        self.assertEqual(r.json(), {"rev": 1})
        self.assertEqual(self.post(admin, f"/admin/personas/{pid}/activate", {"rev": 1}).json(), {"ok": True})
        r = self.post(admin, f"/admin/personas/{pid}/try", {"input": "price?", "revs": [1, None], "maxTokens": 200})
        self.assertEqual(len(r.json()["results"]), 2)
        self.assertIn(("try", pid, (1, None), 200, 0.8), self.gateway.persona_calls)
        admin_id = self.user_id("admin@example.test")
        for action in ("admin.persona_created", "admin.persona_revision_saved", "admin.persona_activated", "admin.persona_tried"):
            events = self.audit(action)
            self.assertEqual([(e["actor_id"], e["target_id"]) for e in events], [(admin_id, pid)], action)
        self.assertEqual(self.details("admin.persona_revision_saved"), [{"rev": 1, "activate": False, "systemChars": 17, "examples": 1}])
        self.assertEqual(self.details("admin.persona_tried"), [{"revs": [1, None], "inputChars": 6, "maxTokens": 200}])
        stored = json.dumps([e["details"] for e in rows(self.store, "audit_events")])
        for secret_ish in ("Line one", "hello", "price?"):
            self.assertNotIn(secret_ish, stored)

    def test_revision_validation_never_reaches_the_gateway(self):
        admin = self.admin()
        good = {"system": "s", "examples": [], "note": "", "activate": True}
        bad = [dict(good, activate=None), dict(good, system="x" * 32001), dict(good, system="a\x00b"),
               dict(good, examples=[{"user": "u"}] * 51), dict(good, examples=[{"user": "u", "extra": "x"}]),
               dict(good, examples=[{"user": " ", "assistant": ""}]), dict(good, examples=["text"]),
               dict(good, note="n" * 201), dict(good, note="a\nb")]
        for body in bad:
            self.assertEqual(self.post(admin, "/admin/personas/p1/revisions", body).status_code, 422, body)
        r = self.post(admin, "/admin/personas/p1/revisions", dict(good, system="字" * 30000, examples=[{"user": "字" * 4000, "assistant": "字" * 4000}] * 10))
        self.assertEqual(r.status_code, 413)
        self.assertFalse([c for c in self.gateway.persona_calls if c[0] == "revision"])
        self.assertEqual(self.post(admin, "/admin/personas/nope/revisions", good).json()["error"], "persona_not_found")

    def test_try_and_activate_validation(self):
        admin = self.admin()
        for body in ({"input": ""}, {"input": "x" * 4001}, {"input": "x", "revs": []}, {"input": "x", "revs": [1, 2, 3]},
                     {"input": "x", "revs": [0]}, {"input": "x", "revs": ["1"]}, {"input": "x", "revs": [True]},
                     {"input": "x", "maxTokens": 0}, {"input": "x", "maxTokens": 1025}, {"input": "x", "maxTokens": "5"},
                     {"input": "x", "temperature": -0.1}, {"input": "x", "temperature": 2.1}, {"input": "x", "temperature": True}):
            self.assertEqual(self.post(admin, "/admin/personas/p1/try", body).status_code, 422, body)
        for body in ({}, {"rev": 0}, {"rev": "1"}, {"rev": True}):
            self.assertEqual(self.post(admin, "/admin/personas/p1/activate", body).status_code, 422, body)
        r = self.post(admin, "/admin/personas/p1/activate", {"rev": 9})
        self.assertEqual((r.status_code, r.json()["error"]), (404, "persona_not_found"))
        self.assertFalse([c for c in self.gateway.persona_calls if c[0] in ("try", "activate")])
        self.assertEqual(self.audit("admin.persona_activated"), [])

    def test_gateway_failures_map_and_are_not_audited(self):
        admin = self.admin()
        self.gateway.reject = GatewayError("rejected", 409, "busy")
        r = self.post(admin, "/admin/personas", {"name": "X"})
        self.assertEqual((r.status_code, r.json()), (409, {"error": "gateway_rejected", "detail": "busy"}))
        self.gateway.reject = 401
        r = self.post(admin, "/admin/personas", {"name": "X"})
        self.assertEqual((r.status_code, r.json()["error"]), (503, "gateway_auth_failed"))
        self.assertNotIn("private upstream token", r.text)
        self.gateway.reject = None
        self.gateway.fail = True
        self.assertEqual(self.post(admin, "/admin/personas/p1/try", {"input": "x"}).json()["error"], "gateway_unavailable")
        self.assertEqual([e for e in rows(self.store, "audit_events") if e["action"].startswith("admin.persona")], [])

    def test_unconfigured_and_forbidden(self):
        admin = self.admin()
        self.gateway.configured = False
        self.assertEqual(admin.get(BASE + "/admin/personas").json(), {"gatewayConfigured": False, "personas": []})
        self.assertEqual(self.post(admin, "/admin/personas", {"name": "X"}).json()["error"], "provider_not_configured")
        client = self.client()
        self.register(client, "a@example.test")
        self.assertEqual(client.get(BASE + "/admin/personas").status_code, 403)
        self.assertEqual(self.post(client, "/admin/personas/p1/try", {"input": "x"}).status_code, 403)


if __name__ == "__main__":
    unittest.main()
```

```bash
cd /Users/optyne/repository/b300/sell-panel/powerchampion-marketplace/.worktrees/a2c-ops
.venv-portal/bin/python -m unittest server.test_admin_personas 2>&1 | tail -4
```
Expected：404 not_found 類失敗（路由還不存在）。

- [ ] **Step 2: 實作**（`attach_admin_personas(application, ctx)`；路由前綴 `PREFIX + "/admin/personas"`；每條第一行 `ctx.current_user(request, admin=True)`；路徑參數先 `gateway_path(persona_id, PERSONA_ID)`；驗證在 `require_gateway` 之前（未設定閘道時，合法請求得 503，非法請求仍得 422））。
- [ ] **Step 3: 測試通過（兩種後端）**

```bash
cd /Users/optyne/repository/b300/sell-panel/powerchampion-marketplace/.worktrees/a2c-ops
.venv-portal/bin/python -m unittest server.test_admin_personas server.test_routes -v 2>&1 | tail -10
.venv-portal/bin/python -m unittest discover -s server -t . -p 'test_*.py' 2>&1 | tail -4
bash scripts/test_backend_postgres.sh 2>&1 | tail -4
```
Expected：全綠（`test_routes` 會自動涵蓋新路由的 403／401）。
- [ ] **Step 4: commit**（`portal: persona administration routes proxied to the gateway with validation and audit`）。

---

### Task 5: Fleet 與 control job 後端路由（`server/admin_fleet.py`）

**Files:**
- Create: `server/admin_fleet.py`、`server/test_admin_fleet.py`
- Modify: `server/app.py`（`attach_admin_fleet(application, ctx)`）

**Interfaces：**
- `GET /admin/gateway/fleet/events`：query `modelId: str = ""`、`limit: int = 100`（FastAPI 解析失敗 → 既有 handler 回 400 `invalid_input`）；`limit` 不在 1..500 → 400 `invalid_input`；`modelId` 非空時 `gateway_path(modelId, FLEET_MODEL_ID)`；呼叫 `fleet_events(model_id or None, limit)`。
- `GET /admin/gateway/fleet/{model_id}/status`、`/timeline`：`gateway_path(model_id, FLEET_MODEL_ID)`。
- `POST /admin/gateway/fleet/{model_id}/{action}`：`gateway_path` → `action not in FLEET_ACTIONS` → 400 `unknown_action`（"That fleet action is not supported."）→ `ctx.gateway_call(ctx.gateway.fleet_action, model_id, action, not_found=FLEET_NOT_MANAGED)` → 審計（總表 #10；details：結果有 `job_id` 時 `{jobId, state, phase}`，否則 `{mode}`）→ 原樣回傳。portal 不讀 body（瀏覽器送空 body）。
- `GET /admin/gateway/control/jobs/{job_id}`：`gateway_path(job_id, JOB_ID)` → `control_job`，404 → `job_not_found`（"This job does not exist."）。
- `FLEET_NOT_MANAGED = ("fleet_not_managed", "This model is not managed by the fleet controller (control_managed is off).")`。
- 註冊順序：`/fleet/events` 先於 `/fleet/{model_id}/...`。

- [ ] **Step 1: 失敗的測試**（`server/test_admin_fleet.py`）

```python
import json
import unittest

from server.testsupport import BASE, PortalCase, rows

AUDIT = {"freeze": "admin.fleet_frozen", "resume": "admin.fleet_resumed", "candidate": "admin.fleet_candidate_requested",
         "drain": "admin.fleet_drain_requested", "approve": "admin.fleet_approved", "rollback": "admin.fleet_rollback_requested"}


class AdminFleetTests(PortalCase):
    def test_reads(self):
        admin = self.admin()
        self.assertEqual(admin.get(BASE + "/admin/gateway/fleet/glm-5.2-fp8/status").json()["model_id"], "glm-5.2-fp8")
        self.assertEqual(admin.get(BASE + "/admin/gateway/fleet/glm-5.2-fp8/timeline").json()["events"], [])
        r = admin.get(BASE + "/admin/gateway/fleet/bge-m3/status")
        self.assertEqual((r.status_code, r.json()["error"]), (404, "fleet_not_managed"))
        self.assertEqual(admin.get(BASE + "/admin/gateway/fleet/events").json(), {"events": []})
        admin.get(BASE + "/admin/gateway/fleet/events?modelId=glm-5.2-fp8&limit=20")
        self.assertEqual(self.gateway.fleet_calls, [("events", None, 100), ("events", "glm-5.2-fp8", 20)])
        for query in ("limit=0", "limit=501", "limit=abc", "modelId=bad%20id"):
            self.assertEqual(admin.get(BASE + "/admin/gateway/fleet/events?" + query).status_code, 400, query)
        self.assertEqual(admin.get(BASE + "/admin/gateway/fleet/events?modelId=bge-m3").json()["error"], "fleet_not_managed")
        self.assertEqual([e for e in rows(self.store, "audit_events") if e["action"].startswith("admin.fleet")], [])

    def test_every_action_is_audited_with_its_own_name(self):
        admin = self.admin()
        for action, name in AUDIT.items():
            r = self.post(admin, f"/admin/gateway/fleet/glm-5.2-fp8/{action}", {})
            self.assertEqual(r.status_code, 200, (action, r.text))
            event = self.audit(name)
            self.assertEqual([e["target_id"] for e in event], ["glm-5.2-fp8"], action)
            details = json.loads(event[0]["details"])
            if action in ("freeze", "resume"):
                self.assertEqual(set(details), {"mode"})
            else:
                self.assertEqual(details["jobId"], r.json()["job_id"])
        self.assertEqual([c[1] for c in self.gateway.fleet_calls], list(AUDIT))

    def test_bad_input_and_conflicts_never_audit(self):
        admin = self.admin()
        self.assertEqual(self.post(admin, "/admin/gateway/fleet/glm-5.2-fp8/delete", {}).json()["error"], "unknown_action")
        self.assertEqual(self.post(admin, "/admin/gateway/fleet/bad%20id/freeze", {}).json()["error"], "invalid_input")
        self.assertEqual(self.post(admin, "/admin/gateway/fleet/bge-m3/freeze", {}).json()["error"], "fleet_not_managed")
        from server.gateway import GatewayError
        self.gateway.reject = GatewayError("rejected", 409, "workflow already active")
        r = self.post(admin, "/admin/gateway/fleet/glm-5.2-fp8/candidate", {})
        self.assertEqual((r.status_code, r.json()), (409, {"error": "gateway_rejected", "detail": "workflow already active"}))
        self.gateway.reject = 401
        self.assertEqual(self.post(admin, "/admin/gateway/fleet/glm-5.2-fp8/drain", {}).json()["error"], "gateway_auth_failed")
        self.assertEqual(self.gateway.fleet_calls, [])
        self.assertEqual([e for e in rows(self.store, "audit_events") if e["action"].startswith("admin.fleet")], [])

    def test_control_job_poll(self):
        admin = self.admin()
        body = admin.get(BASE + "/admin/gateway/control/jobs/0123456789abcdef").json()
        self.assertEqual((body["id"], body["state"]), ("0123456789abcdef", "awaiting_approval"))
        r = admin.get(BASE + "/admin/gateway/control/jobs/missing")
        self.assertEqual((r.status_code, r.json()["error"]), (404, "job_not_found"))
        self.assertEqual(admin.get(BASE + "/admin/gateway/control/jobs/bad%20job").status_code, 400)

    def test_forbidden_and_unconfigured(self):
        client = self.client()
        self.register(client, "a@example.test")
        self.assertEqual(self.post(client, "/admin/gateway/fleet/glm-5.2-fp8/rollback", {}).status_code, 403)
        admin = self.admin()
        self.gateway.configured = False
        self.assertEqual(self.post(admin, "/admin/gateway/fleet/glm-5.2-fp8/freeze", {}).json()["error"], "provider_not_configured")
        self.assertEqual(self.gateway.fleet_calls, [])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: 實作**；**Step 3: 測試通過（兩種後端）**（同 Task 4 指令，模組換成 `server.test_admin_fleet`）；**Step 4: commit**（`portal: fleet workflow controls and control-job polling for administrators`）。

---

### Task 6: 兌換碼後端路由（`server/admin_redeem.py`）

**Files:**
- Create: `server/admin_redeem.py`、`server/test_admin_redeem.py`
- Modify: `server/app.py`（`attach_admin_redeem(application, ctx)`）

**Interfaces：**
- `GET /admin/redeem/codes`：閘道未設定 → 200 `{gatewayConfigured:false, codes:[], total:0, counts:{active:0,redeemed:0,disabled:0,expired:0}, truncated:false}`；否則回同形且 `gatewayConfigured:true`，資料來自 `list_redeem_codes()`，以 `owners_by_gateway_key_id` 對應兌換者，投影成白名單欄位（**不得轉送任何其他欄位**，例如閘道哪天多回一個 `code`）：`{codeId, amountUsd (usd_from_nano), label, createdAt, createdBy, redeemedAt, redeemedByKeyId, redeemedBy (owner_json|null), disabledAt, expiresAt, status}`；時間用 `safe_iso`（加在 `server/support.py`：int／float 且有限才轉 `iso()`，其他 → null）；`status`（與閘道 `redeem()` 的判斷順序一致）：`redeemedAt`→`redeemed`、`disabledAt`→`disabled`、`expiresAt`≤now→`expired`、其他 `active`；依 `createdAt` 新到舊，只回前 1000 筆，`total`、`counts`（全部）、`truncated`。
- `POST /admin/redeem/codes`：body `{amountUsd, count, label, expiresDays?}`；`amountUsd`：同 `usd_amount` 的解析（int／float／str、有限、兩位小數），且 0 < x ≤ 1000，否則 422；`count`：int 1..500（bool、float、str 不算）否則 422；`label`：`text_value(…, "batch label", 80)`（必填，用來對帳；400）；`expiresDays`：省略／null 或 int 1..3650，否則 422；`ctx.require_gateway()`；呼叫 `issue_redeem_codes`：
  - `GatewayError` 的 `code ∈ {"unavailable","invalid_response","response_limit"}` → 先審計 `admin.redeem_codes_issue_unconfirmed`（target label；`{count, amountUsd}`），再 `gateway_fail`（→ 503 `gateway_unavailable`）。401／403 與其他 rejected 不寫此審計。
  - 成功 → 審計 `admin.redeem_codes_issued`（target label；`{count, amountUsd: f"{amount:.2f}", expiresDays, codeIds}`）→ 201 `{codes:[{code, codeId, amountUsd}], count, amountUsd, label, expiresDays}`。
  - 不 log、不存 DB。
- `POST /admin/redeem/codes/{code_id}/disable`：`gateway_path(code_id, CODE_ID)`；404 → `redeem_code_not_found`（"This code does not exist or is already disabled."）；審計；回 `{ok:true, codeId}`。
- `GET /admin/redeem/codes/export`：`redeem_code_rows()` → 用 `csv.writer`（`lineterminator="\r\n"`）輸出 `REDEEM_CSV_HEADER`＋每列；每個儲存格若以 `= + - @ \t \r` 開頭，前面加 `'`（試算表公式注入防護）；審計 `admin.redeem_codes_exported`（`{rows}`）；回 `{filename: "redeem_codes-YYYYMMDD.csv"（UTC）, csv, rows}`。CSV 只有 `code_hash`（sha256），沒有明文。

- [ ] **Step 1: 失敗的測試**（`server/test_admin_redeem.py`）

```python
import csv
import io
import json
import logging
import unittest

from server.testsupport import BASE, PortalCase, database_text, rows


class _Capture(logging.Handler):
    def __init__(self):
        super().__init__(logging.DEBUG)
        self.messages = []

    def emit(self, record):
        self.messages.append(record.getMessage())


class AdminRedeemTests(PortalCase):
    def issue(self, client, **body):
        return self.post(client, "/admin/redeem/codes", {"amountUsd": 5, "count": 3, "label": "Promo", **body})

    def test_plaintext_is_returned_once_and_stored_nowhere(self):
        admin = self.admin()
        capture, root = _Capture(), logging.getLogger()
        previous = root.level
        root.addHandler(capture)
        root.setLevel(logging.DEBUG)
        try:
            r = self.issue(admin, expiresDays=30)
        finally:
            root.removeHandler(capture)
            root.setLevel(previous)
        self.assertEqual(r.status_code, 201, r.text)
        body = r.json()
        self.assertEqual([c["code"] for c in body["codes"]], self.gateway.issued_codes)
        self.assertEqual({c["amountUsd"] for c in body["codes"]}, {"5.00"})
        listing = admin.get(BASE + "/admin/redeem/codes").text
        audit = json.loads(self.audit("admin.redeem_codes_issued")[0]["details"])
        self.assertEqual((audit["count"], audit["amountUsd"], audit["expiresDays"]), (3, "5.00", 30))
        self.assertEqual(audit["codeIds"], [c["codeId"] for c in body["codes"]])
        self.assertEqual(self.audit("admin.redeem_codes_issued")[0]["target_id"], "Promo")
        for code in self.gateway.issued_codes:
            self.assertNotIn(code, database_text(self.store))
            self.assertNotIn(code, listing)
            self.assertFalse([m for m in capture.messages if code in m])

    def test_issue_validation(self):
        admin = self.admin()
        for body in ({"amountUsd": 0}, {"amountUsd": -1}, {"amountUsd": 1000.01}, {"amountUsd": 1.234}, {"amountUsd": "abc"},
                     {"amountUsd": True}, {"count": 0}, {"count": 501}, {"count": 1.5}, {"count": "3"}, {"count": True},
                     {"expiresDays": 0}, {"expiresDays": 3651}, {"expiresDays": "7"}):
            self.assertEqual(self.issue(admin, **body).status_code, 422, body)
        for label in ("", "x" * 81):
            self.assertEqual(self.issue(admin, label=label).status_code, 400, label)
        self.assertEqual(self.gateway.issued_codes, [])
        self.assertEqual(self.audit("admin.redeem_codes_issued"), [])

    def test_unconfirmed_issue_is_audited_without_codes(self):
        admin = self.admin()
        self.gateway.fail = True
        r = self.issue(admin)
        self.assertEqual((r.status_code, r.json()["error"]), (503, "gateway_unavailable"))
        self.assertEqual(json.loads(self.audit("admin.redeem_codes_issue_unconfirmed")[0]["details"]), {"count": 3, "amountUsd": "5.00"})
        self.gateway.fail = False
        self.gateway.reject = 401
        self.assertEqual(self.issue(admin).json()["error"], "gateway_auth_failed")
        self.assertEqual(len(self.audit("admin.redeem_codes_issue_unconfirmed")), 1)

    def test_list_projection_status_owner_and_cap(self):
        admin = self.admin()
        owner = self.register(self.client(), "buyer@example.test")
        with self.store.connect() as con:
            con.execute("INSERT INTO gateway_keys VALUES (?,?,?,?,?,?,?,NULL)", ("lk", owner["id"], "gk-owner", "k", "sk-o", "active", 1))
        base = {"nano_usd": 1_000_000_000, "label": "L", "created_by": "admin", "redeemed_at": None, "redeemed_by_key_id": None, "disabled_at": None, "expires_at": None}
        self.gateway.redeem_codes = [
            dict(base, code_id="a", created_at=4.0, code="LEAKED-PLAINTEXT-SHOULD-NOT-PASS"),
            dict(base, code_id="r", created_at=3.0, redeemed_at=5.0, redeemed_by_key_id="gk-owner"),
            dict(base, code_id="d", created_at=2.0, disabled_at=6.0),
            dict(base, code_id="e", created_at=1.0, expires_at=1.0),
        ]
        body = admin.get(BASE + "/admin/redeem/codes").json()
        self.assertNotIn("LEAKED-PLAINTEXT", json.dumps(body))
        status = {c["codeId"]: c["status"] for c in body["codes"]}
        self.assertEqual(status, {"a": "active", "r": "redeemed", "d": "disabled", "e": "expired"})
        self.assertEqual(next(c for c in body["codes"] if c["codeId"] == "r")["redeemedBy"]["email"], "buyer@example.test")
        self.assertEqual(body["counts"], {"active": 1, "redeemed": 1, "disabled": 1, "expired": 1})
        self.gateway.redeem_codes = [dict(base, code_id="c%d" % n, created_at=float(n)) for n in range(1005)]
        body = admin.get(BASE + "/admin/redeem/codes").json()
        self.assertEqual((len(body["codes"]), body["total"], body["truncated"], body["codes"][0]["codeId"]), (1000, 1005, True, "c1004"))

    def test_disable_and_not_found(self):
        admin = self.admin()
        code_id = self.issue(admin).json()["codes"][0]["codeId"]
        self.assertEqual(self.post(admin, f"/admin/redeem/codes/{code_id}/disable", {}).json(), {"ok": True, "codeId": code_id})
        r = self.post(admin, f"/admin/redeem/codes/{code_id}/disable", {})
        self.assertEqual((r.status_code, r.json()["error"]), (404, "redeem_code_not_found"))
        self.assertEqual([e["target_id"] for e in self.audit("admin.redeem_code_disabled")], [code_id])

    def test_export_has_hashes_only_and_neutralises_formulas(self):
        admin = self.admin()
        self.issue(admin, label="=HYPERLINK(\"x\")", count=2)
        body = admin.get(BASE + "/admin/redeem/codes/export").json()
        table = list(csv.reader(io.StringIO(body["csv"])))
        self.assertEqual(table[0][:2], ["code_id", "code_hash"])
        self.assertEqual({row[3] for row in table[1:]}, {"'=HYPERLINK(\"x\")"})
        self.assertEqual(body["rows"], 2)
        self.assertRegex(body["filename"], r"^redeem_codes-\d{8}\.csv$")
        for code in self.gateway.issued_codes:
            self.assertNotIn(code, body["csv"])
        self.assertEqual(json.loads(self.audit("admin.redeem_codes_exported")[0]["details"]), {"rows": 2})

    def test_unconfigured_and_forbidden(self):
        admin = self.admin()
        self.gateway.configured = False
        self.assertEqual(admin.get(BASE + "/admin/redeem/codes").json()["gatewayConfigured"], False)
        self.assertEqual(self.issue(admin).json()["error"], "provider_not_configured")
        client = self.client()
        self.register(client, "a@example.test")
        self.assertEqual(self.issue(client).status_code, 403)
        self.assertEqual(client.get(BASE + "/admin/redeem/codes/export").status_code, 403)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: 實作**；**Step 3: 測試通過（兩種後端）**；**Step 4: commit**（`portal: redeem code issuance, listing, disabling and CSV export for administrators`）。

---

### Task 7: BFF 白名單、query／逾時／大小、錯誤文案、proxy 測試

**Files:**
- Modify: `app/api/portal/[...path]/route.ts`、`lib/portal-client.ts`、`tests/portal-proxy.test.ts`

**改動：**
- 常數：`PERSONA`、`FLEET_MODEL`、`FLEET_ACTION`、`CODE`（值見總表）。
- `routes.GET` 加：`/^\/admin\/personas$/`、`` new RegExp(`^/admin/personas/${PERSONA}$`) ``、`/^\/admin\/gateway\/fleet\/events$/`、`` new RegExp(`^/admin/gateway/fleet/${FLEET_MODEL}/(status|timeline)$`) ``、`` new RegExp(`^/admin/gateway/control/jobs/${JOB}$`) ``、`/^\/admin\/redeem\/codes(\/export)?$/`。
- `routes.POST` 加：`/^\/admin\/personas$/`、`` new RegExp(`^/admin/personas/${PERSONA}/(revisions|activate|try)$`) ``、`` new RegExp(`^/admin/gateway/fleet/${FLEET_MODEL}/${FLEET_ACTION}$`) ``、`/^\/admin\/redeem\/codes$/`、`` new RegExp(`^/admin/redeem/codes/${CODE}/disable$`) ``。
- Query（沿用 month 的作法：只轉送白名單參數，不合格回 400 `invalid_input`）：`/admin/personas/<id>` 的 `rev`（`^[1-9][0-9]{0,8}$`）；`/admin/gateway/fleet/events` 的 `modelId`（`^${FLEET_MODEL}$`）與 `limit`（`^[1-9][0-9]{0,2}$`）。
- 請求 body 上限：`/admin/personas/<id>/revisions` → 196608（與 `/runtime/tasks` 相同），其他不變。
- 逾時：路徑符合 `^/admin/personas/${PERSONA}/try$` → 95000 ms，其他 20000 ms（抽成 `function timeoutFor(path)`，不要新增 route 檔的 export）。
- 回應上限：`/admin/redeem/codes/export` → 6291456，其他 2097152。
- `portalErrorCodeText` 加：`persona_not_found`（zh「找不到此人設或版本。」）、`fleet_not_managed`（zh「此模型不由 fleet 控制器管理（control_managed 未開啟）。」）、`job_not_found`（zh「找不到這個工作。」）、`redeem_code_not_found`（zh「找不到此兌換碼，或它已經停用。」）、`state_changed`（zh「狀態在送出期間被其他操作改變了，請重新整理後確認。」）、`key_limit`（zh「此帳號的有效金鑰已達上限，請先停用一把。」）、`unknown_action` 文案改為不限節點（zh「此操作無法使用。」，en "That action is not available."；同步更新 `tests/portal-ui.test.tsx:85` 對舊英文文案的斷言）。英文對應文案同義。

- [ ] **Step 1: 測試（RED）**（`tests/portal-proxy.test.ts`）：
  - 允許：上列每條 GET／POST 各一個 200 案例，斷言 upstream URL 完全相同（沿用「proxies the gateway administration routes to the exact upstream path」寫法，另開一個 `it`）。
  - query：`/admin/personas/abc123def456?rev=3` 轉送 `?rev=3`；`?rev=0`、`?rev=abc` → 400；`/admin/gateway/fleet/events?modelId=glm-5.2-fp8&limit=20&other=x` 只轉送 `modelId`、`limit`；`limit=0`、`limit=1000`、`modelId=a%2Fb` → 400。
  - 拒絕（404、不呼叫 fetch）：`/admin/gateway/fleet/glm-5.2-fp8/delete`、`/admin/gateway/fleet/a%2Fb/freeze`、`/admin/gateway/fleet/%2e%2e/freeze`、`/admin/personas/x/delete`、`/admin/personas//try`、`/admin/redeem/codes/x/enable`、`DELETE /admin/redeem/codes/x`、`GET /admin/gateway/control/switch`、`POST /admin/gateway/control/mode`、`GET /admin/gateway/control`。
  - 大小：revisions 150 KB body → 轉送；同 body 打 `/admin/personas/x/activate` → 413；export 回應 3 MB JSON → 200，打 `/admin/redeem/codes` 回 3 MB → 502。
  - 逾時（`vi.useFakeTimers()`；fetch mock 在 `init.signal` abort 時 reject）：try 路徑在 20001 ms 時仍未結束、95001 ms 時回 504；`/admin/personas` 在 20001 ms 回 504。測試結束 `vi.useRealTimers()`。
  - 4xx 透傳：upstream 回 404 `{error:"fleet_not_managed", detail:"…"}` → 瀏覽器拿到同樣 404 JSON。
  - `tests/portal-ui.test.tsx`（或新檔）：`portalErrorText(new PortalError(404, "fleet_not_managed", "x"), "zh")` 等六個新碼各一條。
- [ ] **Step 2: 實作**。
- [ ] **Step 3: 驗證**：`npx vitest run tests/portal-proxy.test.ts`、`npx vitest run`、`npx tsc --noEmit`、`npm run lint`。
- [ ] **Step 4: commit**（`portal: proxy persona, fleet, control-job and redeem administration routes`）。

---

### Task 8: 前端「人設（Personas）」頁

**Files:**
- Create: `components/admin-personas-section.tsx`（清單、建立對話框、選取後的詳情與 revisions 表、activate 確認）、`components/admin-persona-editor.tsx`（`RevisionEditor`、`TryPanel`）、`tests/support/admin-fetch.tsx`（`adminFetch(routes)`＋`wrap(node)`，從 `portal-ui.test.tsx` 複製 `customer`（:17）、`wrap`（:23）、`Handler` 型別與 `adminFetch`（:547-567），不改原檔；行號以 rebase 後為準）、`tests/admin-personas.test.tsx`
- Modify: `components/admin-portal.tsx`（`AdminSection` 加 `"personas"`、navigation、分派）、`components/admin-shell.tsx`（NAV 加 `{ href: "/admin/personas", en: "Personas", zh: "人設" }`，放在「閘道」之後）、`app/admin/[[...section]]/page.tsx`（白名單）、`tests/portal-ui.test.tsx`（NAV 標籤斷言加 "Personas"）、`tests/rendered-html.test.mjs`（加 `["/admin/personas", "Personas"]`）

**UI 契約：**
- 清單（`GET /admin/personas`）：表格欄位 名稱、ID、使用中版本（`active_rev`，null 顯示「尚未啟用」）、最新版本（`latest_rev`）、建立時間；列動作「檢視」。頂部「新增人設」→ 對話框（名稱，1–80 字）→ `POST /admin/personas` → 重新整理並選取新 persona。未設定閘道 → `GatewayNotConnected`。
- 詳情（`GET /admin/personas/{id}`，選版本時加 `?rev=N`；**persona 沒有任何版本時閘道不回 `rev`／`system`／`note`／`author`／`examples`**——所有欄位都當可選處理）：顯示目前檢視的版本（rev、note、author、時間）、system（唯讀 `<pre>`）、examples 表；revisions 表（rev、note、author、時間、system 長度、範例數；「檢視」「啟用」；使用中那列標示「使用中」且不顯示啟用鈕）。「啟用」→ 確認對話框（「啟用版本 N 後，使用這個人設的請求立即改用此版本。」）→ `POST …/activate {rev}`。
- 新版本編輯器：預填目前檢視的版本；system `<textarea>`（顯示字數／32000）、examples 可增刪的 user／assistant 對（≤50）、note（≤200，單行）、「儲存後立即啟用」checkbox **預設不勾**；送出前在前端做與後端相同的長度驗證（不通過時不送出，顯示欄位錯誤）；成功後重新載入詳情並檢視新版本。
- 試跑：輸入框（≤4000）、版本 A（預設「使用中」＝`null`）、可選版本 B（比較）、max tokens（預設 300，1–1024）；按鈕旁固定提示「每次試跑都會實際呼叫模型並計入閘道用量（會留下操作紀錄）」；送出 `POST …/try {input, revs, maxTokens}`；結果並排顯示每個 rev 的 reply、token 用量或 error；送出中停用按鈕並顯示「最多約 90 秒」。
- 錯誤用 `portalErrorText`；`persona_not_found` 時回到清單並重新整理。

- [ ] **Step 1: 測試（RED）**（`tests/admin-personas.test.tsx`，每條用 `adminFetch`）：
  1. 清單渲染名稱與「尚未啟用」；按「新增人設」送 `POST /admin/personas {name:"Sales"}` 後重新請求清單。
  2. 檢視 p1：顯示 system 與 revisions；按 rev 1 的「檢視」請求 `GET /admin/personas/p1?rev=1`；使用中那列沒有「啟用」鈕；對另一列按「啟用」→ 確認對話框 → `POST /admin/personas/p1/activate {rev:2}`；取消時不送出。
  3. 編輯器：預設 checkbox 未勾；送出 body `{system, examples:[{user,assistant}], note, activate:false}`；system 超過 32000 字時不呼叫 fetch 並顯示錯誤。
  4. 試跑：送出 `{input:"price?", revs:[null, 1], maxTokens:300}`；兩欄結果都渲染；一個結果帶 `error` 時顯示該錯誤；用量提示文字存在。
  5. 未設定閘道（`GET /admin/personas` 回 200 `{gatewayConfigured:false, personas:[]}`）→ 顯示 GatewayNotConnected 文案，沒有「新增人設」鈕。
  5b. 剛建立、沒有任何版本的 persona（閘道回的 `persona` 沒有 `rev`／`system`／`examples`，`revisions: []`）→ 詳情顯示「尚無版本，請建立第一個版本」，編輯器以空白預填，不崩潰；試跑區停用並提示需先有版本。
  6. `AdminShell` NAV 標籤順序（更新 `portal-ui.test.tsx` 既有斷言為 `["Overview","Customers","API keys","Usage","Gateway","Personas","Node allocation","Credit requests","Audit log"]`）。
- [ ] **Step 2: 實作**；**Step 3: `npx vitest run`、`npx tsc --noEmit`、`npm run lint`、`npm test`**；**Step 4: 本地 `npm run start` 開 `/admin/personas` 200 且含 `<h1 class="admin-content-title">Personas</h1>`**；**Step 5: commit**（`admin: personas section with revisions, activation and side-by-side try`）。

---

### Task 9: 前端 fleet 面板（「閘道」頁內）

**Files:**
- Create: `components/use-job-poll.ts`、`components/admin-fleet-panel.tsx`（`FleetPanel`、`FleetEvents`、確認對話框）、`tests/admin-fleet.test.tsx`
- Modify: `components/admin-gateway-section.tsx`（模型列加「Fleet」按鈕、渲染 `FleetPanel` 與可展開的 `FleetEvents`）

**介面：**
- `useJobPoll(path: string | null, { intervalMs = 5000, maxPolls = 120 })` → `{ job, error, done, stopped }`：用 `setTimeout` 串接（上一個請求結束才排下一個，不重疊）、每次請求帶 `AbortController`、unmount 時 abort 並清 timer；`state ∈ {succeeded, failed, cancelled, awaiting_approval}` 時停止（`done=true`）；達 `maxPolls` 停止並 `stopped=true`（UI 顯示「已停止自動更新，請重新整理」）。單一請求失敗只記錄錯誤、繼續輪詢。
- `FleetPanel({ modelId, onClose })`：載入 `GET /admin/gateway/fleet/{id}/status` 與 `/timeline`。`fleet_not_managed` → 顯示「此模型不由 fleet 控制器管理（control_managed 未開啟）。」且不顯示按鈕。否則顯示：enabled／draining／frozen、capacity（mode、sellable_cap／physical_cap、reason、observed_at）、workflow（kind、state、phase、reason、updated_at）、timeline 表（時間、event_type、old_state→new_state、actor、reason、result）。按鈕六個，每個都先開確認對話框（標題「對 {model} 執行 {動作}？」，內文說明影響：freeze「容量調整暫停在目前值」、resume「恢復自動容量調整」、candidate「開始下載、驗證與預熱候選版本，就緒後等待核准」、approve「降低現行版本並切換到候選版本」、drain「排空此模型的流量」、rollback「回到前一個 serving 狀態」）。啟用規則：freeze 在 `frozen` 時停用；resume 在非 `frozen` 時停用；approve 只在 `workflow.state==="awaiting_approval" && workflow.phase==="ready"` 時啟用；其他永遠可按（閘道會以 409 拒絕衝突並顯示 detail）。job 類動作回 `job_id` 後用 `useJobPoll("/admin/gateway/control/jobs/" + id)` 顯示 state／phase，結束時重新載入 status 與 timeline。freeze／resume 回應後直接重新載入。
- `FleetEvents`：預設收合（「顯示 fleet 事件」），展開才請求 `GET /admin/gateway/fleet/events?limit=100`（可選模型篩選，選項來自 state.models）。events 是 `FleetEvent`（容量事件，`fleet_state.py:125-141`），**不是** timeline 的 `WorkflowEvent`：表格欄位為時間（`observed_at`）、模型、mode、容量（`previous_cap` → `sellable_cap`／`physical_cap`）、reason、policy_version、event_id。
- `AdminGatewaySection`：模型表「動作」欄多一個「Fleet」鈕（`aria-label` "Fleet controls for {id}"／「{id} 的 fleet 控制」），同時只開一個 `FleetPanel`（放在模型表下方，有關閉鈕）。模型 id 含 `/` 時 Fleet 鈕停用並以 title 說明「fleet 路由不支援含 / 的模型 id」（閘道 `{model_id}` 是單一路徑段）。

- [ ] **Step 1: 測試（RED）**（`tests/admin-fleet.test.tsx`）：
  1. 按「Fleet」→ 請求 status 與 timeline 並渲染 capacity mode 與 timeline 一列。
  2. 不受管的模型（status 回 404 `fleet_not_managed`）→ 顯示說明文字，沒有任何 fleet 動作鈕。
  3. 每個動作鈕先開確認對話框，取消不送出；確認後 POST 到 `/admin/gateway/fleet/glm-5.2-fp8/candidate`（無 body）。
  4. approve 在 workflow 非 `awaiting_approval/ready` 時 disabled，符合時 enabled；freeze／resume 依 `frozen` 互斥。
  5. 輪詢（`vi.useFakeTimers({ shouldAdvanceTime: true })`，`userEvent.setup({ advanceTimers: vi.advanceTimersByTime })`）：candidate 回 `job_id` → 5 s 後請求 `/admin/gateway/control/jobs/wf-1`；回 `running` 再一次；回 `awaiting_approval` 後不再請求（再推進 20 s，呼叫數不變），並重新請求 status；unmount 後不再請求。
  6. 409（`gateway_rejected`，detail "workflow already active"）顯示 detail。
  7. `FleetEvents` 收合時不請求 events；展開後請求 `?limit=100`。
- [ ] **Step 2: 實作**；**Step 3: `npx vitest run`、`npx tsc --noEmit`、`npm run lint`、`npm test`**；**Step 4: commit**（`admin: fleet workflow panel with confirmed actions and job polling on the gateway page`）。

---

### Task 10: 前端「兌換碼」頁

**Files:**
- Create: `components/admin-redeem-section.tsx`（清單、篩選、停用、匯出）、`components/admin-redeem-dialogs.tsx`（`GenerateCodesDialog`、`CodesOnceDialog`、`ConfirmDisableDialog`）、`tests/admin-redeem.test.tsx`
- Modify: `components/admin-resource.tsx`（加 `downloadText(filename, text, type)`；`admin-allocation-section.tsx` 的同名私有函式**不動**）、`components/admin-portal.tsx`（`"redeem"`）、`components/admin-shell.tsx`（NAV 加 `{ href: "/admin/redeem", en: "Redeem codes", zh: "兌換碼" }`，放在「金鑰」之後）、`app/admin/[[...section]]/page.tsx`、`tests/portal-ui.test.tsx`（NAV 斷言最終版）、`tests/rendered-html.test.mjs`（加 `["/admin/redeem", "Redeem codes"]`）

**UI 契約：**
- 產生（`GenerateCodesDialog`）：每張面額（USD，>0、≤1000、兩位小數）、張數（1–500）、批次標籤（必填 ≤80）、有效天數（選填 1–3650，空＝不過期）；前端先驗證；第二步顯示「將產生 N 張、每張 $X、合計 $N×X」再按「產生」。
- 一次性顯示（`CodesOnceDialog`）：標題「兌換碼只會顯示這一次」；表格列出 code、codeId、面額；「複製全部」（`navigator.clipboard.writeText`，失敗時顯示「無法複製，請手動選取」）、「下載 CSV（含明文）」（`downloadText`，欄位 `code,code_id,amount_usd,label`，在瀏覽器產生，不經伺服器）；只能以「我已保存」關閉（Esc 不關）；關閉後把 codes 從 state 清掉；不寫 localStorage／sessionStorage。
- 產生失敗且錯誤碼為 `gateway_unavailable` 時，對話框內顯示：「閘道沒有確認結果，可能已建立標籤為「{label}」的兌換碼（明文已無法取回）。請重新整理清單，停用該標籤的兌換碼後再產生。」
- 清單（`GET /admin/redeem/codes`）：狀態計數 tile（可用／已兌換／已停用／已過期）；狀態篩選（全部＋四種，前端篩）；表格欄位 codeId、面額、標籤、狀態、建立時間、建立者、兌換時間、兌換者（email 或 key id）、到期；`status==="active"` 的列有「停用」（確認對話框）；`truncated` 時顯示「只顯示最新 1000 筆，共 {total} 筆；完整資料請用 CSV 匯出」。
- 匯出：「匯出 CSV」→ `GET /admin/redeem/codes/export` → `downloadText(filename, csv, "text/csv")`；提示「匯出檔只含雜湊，不含兌換碼明文」。
- 未設定閘道 → `GatewayNotConnected`。

- [ ] **Step 1: 測試（RED）**（`tests/admin-redeem.test.tsx`）：
  1. 清單：計數 tile 與各狀態列；篩選「已兌換」只剩那一列；`truncated` 提示出現。
  2. 產生：不合法面額（0、1000.01、1.234）與張數（0、501）不呼叫 fetch；合法時先出現合計確認，再送 `POST /admin/redeem/codes {amountUsd:5, count:2, label:"Promo", expiresDays:30}`。
  3. 一次性顯示：兩個 code 出現；Esc 不關閉；按「我已保存」後 code 文字從 DOM 消失，`window.localStorage.length` 與 `sessionStorage.length` 為 0；重新整理後清單請求的回應裡沒有 code 欄位（UI 也不顯示）。
  4. 複製全部呼叫 `navigator.clipboard.writeText`，內容以換行串接兩個 code。
  5. `gateway_unavailable` 時顯示「可能已建立標籤為「Promo」」說明。
  6. 停用：確認後 POST `/admin/redeem/codes/c1/disable`，然後重新請求清單；取消不送出。
  7. 匯出：呼叫 `URL.createObjectURL`（stub）一次，檔名來自回應。
  8. NAV 最終順序：`["Overview","Customers","API keys","Redeem codes","Usage","Gateway","Personas","Node allocation","Credit requests","Audit log"]`。
- [ ] **Step 2: 實作**；**Step 3: `npx vitest run`、`npx tsc --noEmit`、`npm run lint`、`npm test`**；**Step 4: 本地 `npm run start`：`/admin/redeem` 200 含 `<h1 class="admin-content-title">Redeem codes</h1>`、`/admin/redeem/x` 404**；**Step 5: commit**（`admin: redeem codes section with one-time plaintext display, disable and CSV export`）。

---

### Task 11: 文件與 spec

**Files:**
- Modify: `docs/superpowers/specs/2026-10-08-unified-admin-platform-design.md`、`server/README.md`、`docs/portal-operations.md`

**spec 逐字修改**（old → new；行號為 35d0821 時的參考）：

1. §3 表格 :54
   - old：`| | A2c | Personas、fleet 工作流、`/api/control`、兌換碼 | A2b |`
   - new：`| | A2c | 拆分 `server/app.py` 與過大的 admin 前端檔；A2b 尾巴（401 對應、toggle 設定語意、啟用金鑰受上限、簽發下拉不列 admin）；Personas 頁、閘道頁的 fleet 工作流（寫入＋唯讀 status／timeline／events）、fleet job 輪詢（僅 `/api/control/jobs/{id}`）、兌換碼頁 | A2b |`
2. §3 表格 :55
   - old：`| | A3 | 閘道 HTML 管理頁退場切換 | A2b |`
   - new：`| | A3 | 閘道 HTML 管理頁退場切換 | A2c |`
3. :64 段落末尾追加一句（同一行）：
   `2026-10-21：A2c 範圍定案——`/api/control` 只代理 fleet 寫入需要的 job 輪詢（`GET /api/control/jobs/{id}`），control 的 mode／switch／profit-evidence／validate／preview 不代理；persona `try` 會實際呼叫模型，與其他寫入一樣寫 `audit_events`；兌換碼明文只在產生當下回給瀏覽器一次，不入 portal 資料庫、審計或日誌；A3 改為依賴 A2c（閘道 `/personas` 退場前，portal 必須先有 Personas 頁）。`
4. §5.3 :128-130（old 文字在原檔跨三行，替換時三行一起換）
   - old：`Personas、fleet 工作流、`/api/control`、兌換碼移到 **A2c**。以下「後台殼層」「密碼重設」兩段屬 A2a，其餘（安全閘門、金鑰政策、停用即撤銷、頁面表中的金鑰／用量／閘道）屬 A2b；代理清單中的 `/api/personas*`、`/api/fleet/*` 與頁面表的 Personas 屬 A2c。`
   - new：`Personas、fleet 工作流、fleet job 輪詢（`/api/control/jobs/{id}`）、兌換碼移到 **A2c**。以下「後台殼層」「密碼重設」兩段屬 A2a，其餘（安全閘門、金鑰政策、停用即撤銷、頁面表中的金鑰／用量／閘道）屬 A2b；代理清單中的 `/api/personas*`、`/api/fleet/*`、`/api/control/jobs/{id}`、`/api/redeem/codes*` 與頁面表的 Personas、兌換碼、閘道頁的 fleet 屬 A2c。`
5. §5.3 :159-162 代理清單
   - old：`` `/api/keys/{id}/limits`、`/api/keys/{id}/balance`、`/api/usage/report`、`/api/metrics`、 `` 換行 `` `/api/personas*`、`/api/fleet/*`。每條在 BFF allowlist 加一行，在 FastAPI 加對應 `/admin/*` 路由。 ``
   - new：`` `/api/keys/{id}/limits`、`/api/keys/{id}/balance`、`/api/usage/report`、`/api/metrics`、 `` 換行 `` `/api/personas*`、`/api/fleet/*`、`/api/control/jobs/{id}`（`/api/control` 只代理這一條）、`/api/redeem/codes*`。每條在 BFF allowlist 加一行，在 FastAPI 加對應 `/admin/*` 路由。 ``
6. §5.3 頁面表 :171-172
   - 閘道列 old：`| 閘道 | 模型啟停、維護訊息、節點 start/stop/restart/check（A2b）、GPU 指標、fleet 的 freeze/resume/candidate/approve/drain/rollback（A2c） | 同上 |`
   - new：`| 閘道 | 模型啟停（設定成指定狀態，非盲目翻轉）、維護訊息、節點 start/stop/restart/check（A2b）、GPU 指標、fleet 的 freeze/resume/candidate/approve/drain/rollback 與唯讀 status／timeline／events、fleet job 輪詢（A2c） | 同上 |`
   - Personas 列 old：`| Personas（A2c） | 代理 `/api/personas*`：清單、建立、revisions、activate、try | 同上 |`
   - new：`| Personas（A2c） | 代理 `/api/personas*`：清單、檢視（含 revisions）、建立、新增 revision、activate、try（try 會花模型 token，照樣審計） | 同上 |`
   - 在 Personas 列之後插入：`| 兌換碼（A2c） | 代理 `/api/redeem/codes*`：產生（明文只在產生當下顯示一次，不入庫、不進審計與日誌）、清單、停用、CSV 匯出（只含雜湊） | 同上 |`
7. §5.3 驗收（:185 之後）追加：
   ```
   - A2c：在「人設」頁建立 persona → 新增 revision（不啟用）→ 試跑新舊兩版並排 → 啟用新版；「稽核」頁依序出現
     `admin.persona_created`、`admin.persona_revision_saved`、`admin.persona_tried`、`admin.persona_activated`，
     details 不含 system 或試跑原文。
   - A2c：對非 `control_managed` 模型開 fleet 面板，顯示「不由 fleet 控制器管理」且沒有動作鈕；對受管模型
     status／timeline 可讀（生產驗收不執行 fleet 寫入）。
   - A2c：產生 1 張兌換碼後關閉一次性對話框，該明文不出現在清單回應、CSV 匯出、portal 資料庫與審計；停用後狀態為「已停用」。
   ```
8. §5.4 :189 之前（第一個 bullet 前）插入：`- **前置**：A2c 已部署且「人設」頁通過驗收；否則 `/personas` 302 之後沒有替代頁。`

**README／runbook：**
- `server/README.md`：新增「Personas, fleet and redeem routes (A2c)」表（總表 #1–#15 的 route＋purpose）、錯誤碼（`persona_not_found`、`fleet_not_managed`、`job_not_found`、`redeem_code_not_found`、`state_changed`、`key_limit`）、審計名清單、`POST /admin/gateway/models/{id}/toggle` 改為 `{enabled}` 並註明讀後翻轉的競態窗口、`/admin/keys/{id}/disable {disabled:false}` 受 20 把上限約束、兌換碼明文政策。
- `docs/portal-operations.md`：新增「Personas／fleet／兌換碼（A2c）」：fleet 六個動作的意義與 approve 時機；閘道端 actor 一律記成 `admin`，誰按的看 portal「操作紀錄」；兌換碼一次性顯示、未確認時的對帳步驟（依標籤停用）；CSV 只含雜湊；persona 試跑計入用量；本期無 env、無 migration。
- 驗證：`grep -n "A2c" docs/superpowers/specs/2026-10-08-unified-admin-platform-design.md`、`grep -n "| A3 |" …`（應以 `A2c |` 結尾）；派 fresh read-back agent 依本節 8 條逐條核對（檔案類 >30 行改動，10-dispatch §5）。
- commit（`docs: A2c routes, runbook and spec scope (A3 now depends on A2c)`）。

---

### Task 12: 【使用者執行】部署與驗收

- [ ] **Step 1: 前置（使用者）**：在 Dokploy 確認閘道 app 最後一筆 Done 部署的 commit 包含 personas／fleet／redeem 路由（`git merge-base --is-ancestor <含這些路由的 commit> <部署 sha>`；LESSONS 2026-10-08）。marketplace 不需新 env。
- [ ] **Step 2: 【使用者執行】** push、開 PR、CI 綠後 merge（agent 不 push／merge）。
- [ ] **Step 3: agent 驗證（唯讀為主）**：`/admin/personas`、`/admin/redeem` 頁面 HTML 含 section 標題；請使用者登入後確認：人設清單筆數與閘道 `/personas` 頁一致；對 `glm-5.2-fp8` 開 fleet 面板能讀 status／timeline、對 `bge-m3` 顯示「不由 fleet 控制器管理」；兌換碼清單載入。**生產驗收不執行任何 fleet 寫入**。
- [ ] **Step 4: 【使用者執行，可選】** 產生 1 張 1 USD、標籤 `a2c-acceptance` 的兌換碼 → 確認明文只出現一次 → 立即停用 → 「操作紀錄」有 `admin.redeem_codes_issued` 與 `admin.redeem_code_disabled`；匯出 CSV 有該 codeId、沒有明文。
- [ ] **Step 5: 【使用者執行，可選】** 人設試跑一次（花少量 token），量從按下到出結果的秒數；若超過 60 s 仍成功代表整條鏈（Traefik／Cloudflare）沒有更短的逾時；若在 ~60 s 或 ~100 s 斷掉，回報實測值以調整 BFF／adapter 逾時（LESSONS 2026-10-20）。生產節點連不到時，結果會是每個 rev 的 `error`，這不是 portal 缺陷。

---

## 不在 A2c（延後，來源：A2b ledger 與本次盤點）

- Adapter：toggle_model／set_maintenance／node_job／nodes／metrics／list_keys 成功路徑缺測試；`create_key`／`adjust_balance` 接受非有限或非數字金額（`Decimal("Infinity")`、`InvalidOperation`）；`create_key` 閘道漏回 `balance_nano_usd` 時回 None 而非 `invalid_response`；`_strip_secrets` 以子字串 "key" 過度剝除。
- 金鑰：撤銷迴圈在 UPDATE 0 列時仍審計與計數；撤銷迴圈與停用交易之間新發 key 的競態（第二輪掃描）；停用帳號簽發回 409 但碼是 `invalid_input`；admin 能替自己簽發；`prepaidUsd` 接受數字字串；清單測試缺「本地已撤銷、閘道仍啟用」；`gateway_key_json` 遇 `model_ids: null`／非數字時間會崩；`admin_issue_key` 重複金額解析；balance 測試只斷言 id；閘道成功後本地寫入失敗不留審計；I3 兩位 admin 同時「啟用帳號／啟用金鑰」的競態。
- 用量：cost 字串接受怪異 Decimal 形式（要用 ASCII regex 把關）；per-key 總計未對帳；key_id／label 長度無上限；排序與預設月份等測試缺口。
- 閘道路由：字面 `models/../toggle` 測試是空驗證（補 `%2e%2e`、`models/a//toggle`）；路由層 `gateway_path` 與 `gateway._identifier` 重複（應公開一個 `valid_identifier()`）；`admin_gateway` 把 `BaseException`（含 CancelledError）標成 unavailable、寫入路由把非 `GatewayError` 變成 500；`gateway_call` 的 ValueError 分支、maintenance 拒絕、jobs 不寫審計等未測。
- BFF／前端：上游 503 `provider_not_configured` 被收斂成 `service_unavailable`；traversal 測試註解；`gateway_rejected` detail 在中文介面顯示英文；**既有節點 `JobStatus` 的 setInterval 輪詢**（重疊、無 AbortController、上限後無提示——A2c 新的 `useJobPoll` 只用在 fleet，不回頭改節點輪詢）；複製 secret 無 clipboard 時靜默失敗；refresh 後失焦；節點操作雙重 refresh；用量 label 可能為 null；限額欄位無法解析時被靜默丟掉；客戶清單載入錯誤蓋掉驗證訊息。
- 文件：runbook「對帳處理」說重新「停用」但 UI 只對已停用帳號顯示「啟用」；README 的 unconfigured 例外清單漏 `GET /admin/gateway`、`invalid_input` 也可能是 409／413／415。
- A2c 刻意不做：`/api/control` 的 mode／switch／profit-evidence／validate／preview／validation-preview；persona 多輪 `history` 試跑；persona 改名（閘道 `PersonaStore.rename` 沒有路由）；fleet events 分頁；客戶自助兌換（`/v1/redeem`）的 portal UI；在閘道 `/api/state` 輸出 `control_managed`；兌換碼總數約 1.8 萬張以上時閘道清單會超過 adapter 的 4 MiB 上限（回 503，需閘道分頁）；toggle 讀後翻轉仍有很小的競態窗口，且每次 toggle 多一次 `/api/state` 探測；`downloadText` 與 `admin-allocation-section.tsx` 去重；`portal-ui.test.tsx` 的 `adminFetch` 與新 `tests/support/admin-fetch.tsx` 去重；稽核頁顯示 details。

## 自我檢查

- owner 範圍：Personas 六個動作 → Task 3、4、8；fleet 六個寫入＋三個讀 → Task 3、5、9；control 只有 jobs → Task 3、5、7（BFF 拒絕 mode／switch 的測試）；兌換碼產生／清單／停用／匯出 → Task 3、6、10。
- 每個寫入都審計（含 try）→ 總表審計欄＋Task 4／5／6 測試；明文不入庫／審計／日誌 → Task 6 第一條測試＋Task 10 第 3 條。
- Task 1 不改行為 → 1A 路由快照 diff＋全量測試、1B vitest 數不變。
- 四個尾巴 → Task 2（各有一條失敗先行的測試）。
- 不假設 migration 編號、先 rebase、共用檔案清單 → Global Constraints＋Task 1A Step 1 的 BLOCKED 條件。
- fake gateway 可測 → Task 3 `FakeGateway`；adapter 以 `httpx.MockTransport` 測，無網路。
- spec 更新（A2c 段、A3 依賴）→ Task 11 逐字修改。
- 四處同步（BFF、page 白名單、AdminSection／navigation、AdminShell NAV）→ Task 7、8、10。
