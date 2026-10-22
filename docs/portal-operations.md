# Power Champion 帳號後台與上線交接

目前版本提供可持續儲存的客戶帳號與管理後台，並隨 powerchampion.ai 一起部署（見下方「正式環境（Dokploy）」）。既有推論服務及正式付款流程未變更；匿名試用維持關閉。閘道需另外設定 admin token 才會連線（見「連接閘道（A2b）」），客戶自助發放金鑰預設關閉。

## 開啟本機版本

在本專案資料夾分別開啟兩個終端：

```sh
npm run dev:backend
```

```sh
npm run dev -- --port 3010
```

- 註冊：`http://localhost:3010/register`
- 客戶工作區：`http://localhost:3010/account`
- 管理後台：`http://localhost:3010/admin`
- 繁中／日文／韓文公開頁：`/zh-Hant`、`/ja`、`/ko`。舊 `/zh-Hans` 連結會轉址至對應繁中頁面。

帳號資料存在 Postgres（Dokploy 內網服務 `powerchampion-db`，volume `portal-pg-data`）；連線逾時 5 秒、鎖等待逾時 15 秒（`connect_timeout`／`lock_timeout`）；本機開發預設仍用 `.local/portal.sqlite3`，設 `PC_PORTAL_DATABASE_URL` 可切換。正式環境必須配置持久磁碟與備份。服務初次啟動不會自動建立管理員，也不會將第一個註冊的人變成管理員。

## 品牌官網與模型工具

- `/`：模型 API／Agent 建置／GPU 品牌官網。立體主視覺可切換推理、視覺與創作模型並前往對應模型頁；三項服務可切換架構示意與詳細入口。加入游標互動、分層光影、捲動進場與按鈕回饋；可暫停並遵循減少動態偏好，鍵盤可操作模型及服務分頁。
- `/chat`：選用的多輪文字聊天、助理切換、取消等待、複製回覆和匯出對話。三組立即可看的內容清楚標為預寫範例，不會冒充模型生成。
- `/agents`：四種可搜尋的助理範本、指令預覽，以及企業 Agent 建置服務。需求表先產生使用者可檢視的郵件草稿，不會自動寄信。
- `/agents/build`：設定名稱、用途、模型、指令、語氣、參考資料與測試問題；可主動儲存／還原／刪除瀏覽器草稿、複製指令與匯出 JSON。測試設定使用 sessionStorage，30 分鐘內可重新載入；聊天的「返回編輯」會帶回同一設定。登入後可再把智能體**存進帳號**：每次儲存會新增一個版本，並取得一組只顯示一次的智能體權杖，用來呼叫它自己的端點（下節）。每個帳號上限 20 個智能體。
- `/solutions`：保留可用的品牌首頁別名，canonical 指向 `/`。既有工具、帳戶與後台網址仍可使用。

內建助理是指令範本，沒有自動連接外部工具、搜尋引擎或客戶系統。企業服務可由需求確認、知識整理、工具串接、測試與交付另行建置。

聊天使用 `POST /api/chat`，僅接受兩個文字模型，並將請求轉送至固定閘道。客戶金鑰只保留在頁面記憶體；開啟其他頁面或重新載入後須再連接。對話不會儲存於帳戶，匯出檔也不包含金鑰。

截至 2026-09-11，公開閘道狀態仍回報中斷。本機預覽已驗證 `/api/chat/config` 回傳 `trialAvailable: false`，無金鑰請求回傳 `503 trial_unavailable`，沒有執行付費模型請求。真實對話需要可用閘道及有效客戶金鑰；免金鑰試用則另需營運者啟用以下設定。

### 選用公開試用

帳號服務必須同時設定 `PC_TRIAL_ENABLED=1`、專用 `PC_TRIAL_API_KEY` 與正數 `PC_TRIAL_DAILY_REQUEST_LIMIT`。預設關閉；金鑰不得放入前端公開變數。完整設定見 [server/README.md](../server/README.md#anonymous-chat-trial)。

每次試用先在資料庫保留全站與該瀏覽器當日名額，失敗／逾時／取消也占名額；重設 Cookie 無法重設全站上限。每次輸出上限 512 tokens，對話歷史上限 8,000 字元，最多 24 則訊息。這是次數與單次內容限制，不是美元花費上限，仍須替專用閘道金鑰設定適合的額度。公開入口另需可信任的邊緣請求限制。

## 智能體端點

儲存到帳號的智能體有自己的端點，供伺服器對伺服器呼叫：

```sh
curl https://powerchampion.ai/api/agents/<agent-id>/chat \
  -H "Authorization: Bearer $POWERCHAMPION_API_KEY" \
  -H "X-PC-Agent-Token: $PC_AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"…"}]}'
```

- **兩個憑證各司其職**：`Authorization` 是客戶自己的閘道金鑰，只在該次請求轉送給固定閘道、不落地；`X-PC-Agent-Token` 證明可以使用這個智能體，由帳號服務驗證。兩者都不會寫進資料庫或日誌。
- 送出的 system 訊息**就是建置器預覽的那段文字**（存為 `systemPrompt`），所以客戶看到的與實際執行的一致。輸出上限取智能體設定與請求值的較小者。
- 端點不回 CORS 標頭、不讀寫 Cookie，因此沒有瀏覽器工作階段可被冒用；對話不儲存，用量依刊登費率計入送出的那把金鑰。
- 權杖遺失就換發（`POST /api/portal/agents/{id}/token`），舊的立即失效；刪除智能體後端點即停止回應，版本紀錄與稽核事件保留。
- `POST /api/portal/agents/resolve` 只給網站伺服器使用，**不在瀏覽器 BFF 的允許清單內**。

## 建立管理員

由操作人員在本機執行以下命令，將範例信箱替換為自己的信箱，再於隱藏輸入提示中設定密碼：

```sh
python3 -m server.manage create-admin --email you@example.com
```

接著在 `/login` 登入並選擇 Open administration。此命令不會將已存在的一般客戶提升權限。需要復原帳號時，管理員先確認帳號擁有者，再到 `/admin/customers` 重設密碼（見下節「帳號管理」）；沒有可用的管理員時才用命令列：

```sh
python3 -m server.manage reset-password --email you@example.com
```

重設密碼會登出該帳號的所有工作階段。系統目前不會寄送驗證信或密碼重設信。

## 帳號管理

管理員在 `/admin/customers` 管理所有帳號（清單包含管理員，並顯示角色與狀態）：

- **停用／啟用**：停用的帳號無法登入（回 403 `account_disabled`），既有工作階段立即登出，其智能體權杖也停止生效；啟用後可再登入。停用帳號會同時撤銷其所有仍有效的閘道金鑰（見「連接閘道（A2b）」的「停用即撤銷」）。
- **改角色**：`customer` ↔ `admin`。
- **重設密碼**：管理員設定新密碼並自行交給帳號擁有者；該帳號所有工作階段登出，登入失敗計數清除。先確認帳號擁有者再做。
- 不能對自己的帳號執行以上三項（顯示為「You」，伺服器回 409 `self_target`）。自己的密碼走下面的自助頁。
- 停用帳號會撤銷其閘道金鑰：每把仍有效的金鑰逐一呼叫閘道停用並寫一筆 `key.revoked`；閘道連不上時帳號仍然停用，並以 `key.revocation_needs_reconciliation` 記下閘道金鑰 ID，之後須人工對帳（處理方式見「連接閘道（A2b）」）。停用完成後客戶頁會顯示「N 把閘道金鑰已撤銷」，有金鑰撤銷失敗時另外顯示「N 把金鑰無法撤銷，請到「金鑰」頁對帳處理」。啟用帳號不會讓已撤銷的金鑰復活；帳號停用期間，它的金鑰也不能在 `/admin/keys` 按「啟用」（回 409 `account_disabled`），要先啟用帳號，再逐把啟用需要的金鑰。
- 每個動作都寫入稽核（`admin.account_disabled`、`admin.account_enabled`、`admin.role_changed`、`admin.password_reset`），稽核不記錄密碼內容。

所有已登入使用者（客戶與管理員）可在 `/account/security` 自行改密碼，需輸入目前密碼；成功後保留目前工作階段、登出其他裝置，稽核事件為 `account.password_changed`。每位使用者 15 分鐘內最多 5 次嘗試，超過回 429。

命令列（`python -m server.manage`）只用於建立第一個管理員與沒有管理員可用時的緊急復原。**Dokploy 網頁終端裡 Python `getpass` 收到的是空輸入**，互動式密碼提示不能用，要改以環境變數帶入，並用 bash `read -s` 輸入，密碼不會進歷史紀錄或程序列表。終端必須以 **Bash** 開啟（`/bin/sh` 選項是 dash，沒有 `read -s`），或把整行包成 `bash -c '…'`：

```sh
read -s PW; PC_PORTAL_ADMIN_PASSWORD="$PW" python -m server.manage create-admin --email you@example.com; unset PW
```

重設密碼同理，環境變數換成 `PC_PORTAL_NEW_PASSWORD`：

```sh
read -s PW; PC_PORTAL_NEW_PASSWORD="$PW" python -m server.manage reset-password --email you@example.com; unset PW
```

## 正式環境（Dokploy）

`docker-compose.dokploy.yml` 同時啟動網站與帳號服務（`server/Dockerfile`）：

- 帳號服務容器 `powerchampion-portal` 只在 Compose 內部網路，沒有對外 port、沒有 Traefik 路由，也不在 `dokploy-network`；網站以 `PC_PORTAL_ORIGIN=http://powerchampion-portal:3020` 連線。BFF 只允許單段主機名（Compose 服務名）使用 http，其他明文位址一律拒絕。
- SQLite 資料庫在具名 volume `portal-data`（容器內 `/data/portal.sqlite3`），重新部署不會清除；切換到 Postgres 後它是 SQLite 後備與回滾來源。備份需另外在 Dokploy 設定 Volume Backup；Postgres 以每日 `pg_dump` 寫入 volume `portal-pg-dumps`，Volume Backup 指向該 volume，不要直接備份 `portal-pg-data`（見 `docs/deploy/a1-postgres-cutover.md`）。
- 已設定 `PC_PORTAL_ENV=production`、`PC_PORTAL_SECURE_COOKIES=1`、`PC_PORTAL_ALLOWED_ORIGINS=https://powerchampion.ai`。網站需 `VINEXT_TRUST_PROXY=1`，否則 TLS 在 Traefik 終止後同源檢查會失敗、全站會被標為 noindex。
- `PC_GATEWAY_ADMIN_TOKEN` 由 Dokploy 環境變數帶入（compose 只寫 `${PC_GATEWAY_ADMIN_TOKEN:-}`，不寫死值）；留空代表閘道未連線。`PC_CUSTOMER_KEY_ISSUANCE` 預設 `0`（客戶自助發放關閉）。連接步驟與政策見下節「連接閘道（A2b）」。
- 匿名試用關閉（`PC_TRIAL_ENABLED=0`、無 `PC_TRIAL_API_KEY`）。

建立第一個管理員：在 Dokploy 開啟 `powerchampion-portal` 容器的 Terminal（選 **Bash**，不要選 `/bin/sh`）。網頁終端的 `getpass` 收不到輸入，必須用環境變數帶密碼：

```sh
read -s PW; PC_PORTAL_ADMIN_PASSWORD="$PW" python -m server.manage create-admin --email you@example.com; unset PW
```

### 回滾（schema）

資料庫結構由 Alembic 管理，目前 head 為 `0003_node_allocation`（機台分配）。退回 0003 之前的映像要先降到 `0002_users_disabled_at`，見「機台分配」一節的回滾；下面降到基線的指令會一併刪掉機台分配的資料表與 `audit_events.details`，先匯出 `engineers.yaml` 留底。`0002_users_disabled_at` 新增 `users.disabled_at`。**在退回 A2a 之前的舊映像前，必須先用新映像把結構降回基線**：在 `powerchampion-portal` 容器的 Terminal（Bash）執行：

```sh
python -c "from alembic import command; from server.migrate import _config; from server.db import Database; from server.settings import Settings; command.downgrade(_config(Database(Settings.from_env().resolved_database_url).url), '0001_baseline')"
```

沒做的話，舊映像的 `Store()` 啟動時會拋出 `Can't locate revision '0002_users_disabled_at'` 並不斷重啟。降級會刪除 `users.disabled_at` 欄位，**所有被停用的帳號會因此恢復為啟用**；回滾後如需維持停用，要自行處理（例如重設密碼）。再次升級到新映像時，啟動會自動回到 head。

登入限制目前只有帳號層級（每帳號 15 分鐘 5 次失敗、註冊每帳號每小時 10 次）。建議另在邊緣（Cloudflare 或 Traefik）對 `/api/portal/auth/*` 設定以來源 IP 計的速率限制。

## 連接閘道（A2b）

A2b 讓管理後台透過閘道的 admin token 管理金鑰、用量與模型／節點。未設定 `PC_GATEWAY_ADMIN_TOKEN` 時，`/admin/keys`、`/admin/usage`、`/admin/gateway` 顯示「閘道尚未連線（PC_GATEWAY_ADMIN_TOKEN 未設定）」，客戶與帳號功能不受影響。後台導覽順序：總覽、客戶、金鑰、兌換碼、用量、閘道、人設、機台分配、工程師、儲值申請、操作紀錄。

### 部署前

1. **前置檢查**：到 Dokploy 開啟閘道 compose「B300 Selling Platform」的 Environment，確認同時有 `SELL_PANEL_VIEW_TOKEN` 與 `SELL_PANEL_ADMIN_TOKEN`。缺 `SELL_PANEL_VIEW_TOKEN` 要先補，否則閘道的 view 等級路由沒有認證。
2. **取得值**：複製 `SELL_PANEL_ADMIN_TOKEN` 的值，填進 marketplace compose 的 `PC_GATEWAY_ADMIN_TOKEN` 環境變數。**先設環境變數、再 merge**：marketplace compose 開啟 Autodeploy，merge 一進 main 就會部署，那時 token 必須已經在。值只放在 Dokploy，不要貼進聊天、issue 或 commit。
3. **`PC_CUSTOMER_KEY_ISSUANCE` 不設**（預設 `0`）：客戶的 `/overview`、`/keys` 回應帶 `keyIssuance: false`（只有閘道已連線且此旗標為 `1` 時才是 `true`），`/account/keys` 不顯示建立表單，改顯示「API 金鑰由我們的團隊簽發，請聯繫支援」；直接呼叫 `POST /keys` 仍回 503 `provider_not_configured`。客戶自己撤銷金鑰只需要閘道已連線，不受此旗標影響。設成 `1` 會讓客戶自助發出餘額為 0 的後付金鑰，上線前須先確認這是想要的，收款流程接上前不建議開。

### 部署後驗證

以管理員登入後依序確認（驗收只對節點做一次 `check`，**不要在生產做 stop／restart**）：

- `/admin/keys`：看到閘道上的金鑰，以及設定檔（env）金鑰。
- `/admin/usage`：有當月數字（API 為 `GET /api/portal/admin/usage?month=YYYY-MM`）。
- `/admin/gateway`：看到模型與節點；對一個節點按一次 `check`，工作完成後狀態正常。
- `/admin/audit`（操作紀錄）：出現剛才的 `admin.node_op`，目標格式為 `節點名:check`。
- 若後台頁面顯示「閘道拒絕了入口網站的管理權杖，請檢查 portal 服務的 PC_GATEWAY_ADMIN_TOKEN 設定」（API 為 503 `gateway_auth_failed`，閘道對 portal 的 token 回了 401／403），代表 `PC_GATEWAY_ADMIN_TOKEN` 跟閘道的 `SELL_PANEL_ADMIN_TOKEN` 不一致：回到 Dokploy 重新複製值、重新部署 marketplace。這不是網路問題，重試不會好。

### 金鑰政策

- **代發必帶預付**：`/admin/keys` 為客戶發金鑰必須給 `prepaidUsd`（大於 0、不超過 100000、最多兩位小數），否則回 422 `invalid_input`；每日 token、RPM、同時請求數可選填，沒填就用 `PC_GATEWAY_DAILY_TOKEN_LIMIT`、`PC_GATEWAY_RPM`、`PC_GATEWAY_MAX_INFLIGHT`。密鑰（`secret`）只在發放當下顯示一次，請當場交給客戶。已停用的帳號不能代發（409）。
- **客戶自助發放預設關閉**：由 `PC_CUSTOMER_KEY_ISSUANCE` 控制，預設 `0`；匿名試用也維持關閉。
- **停用即撤銷**：停用客戶帳號時，其所有仍有效的閘道金鑰一併撤銷，每把寫一筆 `key.revoked`（目標為本機金鑰紀錄 ID）。若閘道當下連不上，帳號仍會停用，並寫一筆 `key.revocation_needs_reconciliation`（目標為閘道金鑰 ID）；閘道上那把金鑰可能仍有效。
- **對帳處理**：在操作紀錄（`/admin/audit`）找 `key.revocation_needs_reconciliation`；閘道恢復後，主要做法是由管理員到 `/admin/keys` 找到該閘道金鑰 ID 按「停用」（成功會寫 `admin.key_disabled`）。另一個做法只能走 API：以管理員工作階段對該客戶再呼叫一次 `POST /api/portal/admin/customers/{id}/status`，body 為 `{"action": "disable"}`——本機記錄中仍為有效的金鑰會被重試撤銷；後台介面對已停用的帳號只顯示「啟用」，沒有這個按鈕。停用 API 的回應帶 `keysRevoked`／`keysFailed` 數量，`keysFailed` 大於 0 就代表有金鑰需要對帳（後台停用帳號時會直接顯示這個警告）。金鑰發放過程閘道失敗時同理會有 `key.provisioning_needs_reconciliation`，以閘道金鑰 ID 比對 `/admin/keys` 清單處理。
- **停用帳號的金鑰不能單獨啟用**：在 `/admin/keys` 對某把金鑰按「啟用」時，若它在本機記錄裡屬於已停用的帳號，回 409 `account_disabled`（「Enable the account first.」），不呼叫閘道、不寫稽核；請先到客戶頁啟用帳號。沒有本機擁有者的金鑰（手動或設定檔建立的）不受此限制。
- **停用模型要確認**：`/admin/gateway` 按模型的「停用」會先跳出確認視窗（停用後客戶會收到 404），確認後才送出；「啟用」仍是一鍵。A2c 起送出的是「要變成啟用／停用」，不是「翻轉」：模型已經是那個狀態時什麼都不做；兩位管理員同時操作導致狀態跟要求不同時，畫面顯示「狀態在送出期間被其他操作改變了」，請重新整理後確認。
- **簽發只給客戶帳號**：「為客戶簽發金鑰」的下拉只列有效的客戶帳號，API 對管理員帳號回 409 `target_not_customer`。
- **重新啟用金鑰受 20 把上限約束**：帳號已有 20 把有效金鑰時回 409 `key_limit`，請先停用一把；另一位管理員正在啟用同一把時回 409 `key_enable_in_progress`，稍後重新整理即可。
- 金鑰相關審計事件：`admin.key_issued`、`admin.key_disabled`、`admin.key_enabled`、`admin.key_limits`、`admin.key_balance`、`key.created`（客戶自助）、`key.revoked`；閘道操作為 `admin.model_toggled`、`admin.model_maintenance`、`admin.node_op`。事件不含密鑰內容。

### 回滾

把 Dokploy 的 `PC_GATEWAY_ADMIN_TOKEN` 拿掉並重新部署：後台三個頁面回到「未連線」，客戶資料、帳號與已發出的金鑰不受影響（金鑰留在閘道）。此版沒有新增資料庫結構，不需要降級 schema。

## Personas／fleet／兌換碼（A2c）

A2c 把閘道 `/personas` 頁、fleet 按鈕與兌換碼搬進後台。**本期沒有新環境變數、沒有 migration**；閘道要已部署含 personas／fleet／redeem 路由的版本（確認方式見 [A2c 計畫](superpowers/plans/2026-10-21-a2c-personas-fleet-redeem.md) Task 12）。

### 人設（`/admin/personas`）

- 清單 → 檢視 → 版本表。「新增版本」預填目前檢視的版本；「儲存後立即啟用」預設**不勾**，啟用會讓使用這個人設的請求立刻改用新版本，要啟用請在版本表按「啟用」並確認。編輯器顯示內容大小（上限 196,608 位元組），超過時不能儲存。
- **試跑會花 token**：每次試跑都實際呼叫模型並計入閘道用量。最多約 90 秒（Cloudflare 在約 100 秒會切斷，所以不能再拉長）；逾時的試跑仍可能已經用掉 token（API 為 504 `gateway_timeout`），重試前先確認用量。操作紀錄在呼叫前就寫 `admin.persona_try_started`，成功後再寫 `admin.persona_tried`；只有前者的那筆，就是逾時或失敗的試跑。紀錄只有字數與版本，不含系統提示或試跑內容。

### Fleet（`/admin/gateway` 模型列的「Fleet」）

- 只對 `control_managed` 的模型有作用；其他模型會顯示「此模型不由 fleet 控制器管理（control_managed 未開啟）」且沒有按鈕。模型 id 含 `/` 的不能開（閘道 fleet 路由只接受單一路徑段）。
- 六個動作，每個都要先確認：
  - **freeze／resume**：凍結（容量調整停在目前值）／恢復自動容量調整，立即生效。
  - **candidate**：下載、驗證並預熱候選版本，完成後停下等待核准（面板顯示 `awaiting_approval · ready`）。
  - **approve**：只有在等待核准時能按；降低現行版本並切換到候選版本。
  - **drain**：排空此模型的流量。**rollback**：回到前一個 serving 狀態。
- candidate／approve／drain／rollback 會回傳 job，面板每 5 秒查一次 `/api/control/jobs/{id}`，結束或等待核准時停止並重新載入狀態；最多查 120 次後停止自動更新。閘道拒絕衝突（例如已有工作流程在跑）時直接顯示閘道給的原因。
- **閘道那邊的 actor 一律記成 `admin`**（portal 用同一把 admin token），要知道是誰按的請看 portal 的「操作紀錄」（`admin.fleet_*`）。
- 「顯示 fleet 事件」展開後才載入容量事件（最近 100 筆，可依模型篩選）。

### 兌換碼（`/admin/redeem`）

- 產生：每張面額 > 0 且 ≤ 1000 美元、每批 1–500 張、批次標籤必填、有效天數 1–3650 或不填（不過期）。送出前會顯示「將產生 N 張、每張 $X、合計 $Y」再確認。
- **明文只顯示一次**：產生後的對話框列出兌換碼，可「複製全部」或「下載兌換碼（.txt，含明文）」（一行一碼的純文字，檔案在瀏覽器產生，不經伺服器；**請用文字編輯器開啟，不要用 Excel 開啟後另存**，試算表會把以「-」或「=」開頭的兌換碼當成公式而改掉）；只能按「我已保存」關閉。portal 不存明文，閘道只存雜湊，關閉後再也拿不到。
- **閘道沒有確認時的對帳**：產生時若閘道逾時或回應異常，畫面會說可能已建立標籤為「X」的兌換碼，操作紀錄有 `admin.redeem_codes_issue_unconfirmed`。這些碼如果存在，沒有人看過明文，請：重新整理清單 → 依標籤篩選 → 按「停用此標籤的 N 張可用兌換碼」（或逐張停用）。30 分鐘內用同一個標籤再產生會被擋下（409 `redeem_issue_unconfirmed_recent`；比對時忽略大小寫、前後與重複空白和 Unicode 寫法差異，所以「Promo」與「 promo 」視為同一個），要先勾選「我已檢查並停用該標籤的兌換碼」才會送出，那筆 `admin.redeem_codes_issued` 會帶 `acknowledgedUnconfirmed: true`。清單被截斷（超過 1000 筆）時批次停用會關閉，因為它可能漏掉較舊的碼；請逐張停用或用 CSV 匯出比對。
- 清單只顯示最新 1000 筆；完整資料用「匯出 CSV」，**匯出檔只有雜湊、沒有明文**，可疑儲存格（以 `=`、`+`、`-`、`@` 開頭）前面會加 `'`，避免試算表當成公式。
- 容量：閘道清單一次回全部兌換碼，portal 最多讀 32 MiB（約 14 萬張）、匯出最多約 4 萬張；超過要等閘道分頁（後續工作）。
- 審計：`admin.redeem_codes_issued`（含 code id，不含明文）、`admin.redeem_code_disabled`、`admin.redeem_codes_exported`。

### 回滾

前端與 FastAPI 一起回到前一個 image 即可；沒有 schema 或 env 變更。已產生的兌換碼與人設版本留在閘道，不受影響。

## 機台分配（node allocation）

`/admin/allocation`（後台導覽「機台分配」）記錄 16 台 b300 GPU 節點（b300-11..16、b300-22..31，IP `172.16.10.<n>`）各自是**業務**（對外銷售）、**工程師**（某位工程師的個人節點）還是**保留**。它是半自動的唯一資料來源：portal 不連任何機器，管理員在這裡改分配 → 匯出 `engineers.yaml` → 在 Mac 上用 `~/github/b300-cluster` 的腳本同步到機器。

### 資料與 migration

- Migration `0003_node_allocation`（啟動時自動套用）新增 `alloc_engineers`、`alloc_nodes`（含待清理欄位 `pending_cleanup_revision`／`pending_cleanup_engineer_id`）、單列表 `alloc_meta`（分配版本號 `revision`、owner email、上次匯出的版本與時間），並在 `audit_events` 加上可為空的 `details` 欄位（JSON，記錄變更前→後）。`server/import_sqlite.py`（A1 的 SQLite→Postgres 搬遷工具）刻意不搬 `alloc_*`：它的來源早於這些表，目標端由 migration 自行種子；要搬分配就匯出 `engineers.yaml` 再輸入。
- 同一個 migration 寫入 2026-10-20 的分配作為種子（不需要另跑指令），內容等於當天的 `access/engineers.yaml`：業務 b300-14、b300-31；justin（eng1）b300-11..13；mwind（eng2）b300-15、16、22；zhuling（eng3）b300-23..25；nati（eng4）b300-26..28；ll（eng5）b300-29、30；保留 0 台；owner email `zhuling@oadpiz.com`。工程師 email 為 `<username>@oadpiz.com`，全部**還沒有 SSH 公鑰**；`revision` 從 1 開始。
- Migration `0004_engineer_accounts` 在 `alloc_engineers` 加上 `user_id`（連結的入口網站帳號，FK `users.id`、UNIQUE：一個帳號最多代表一位工程師）、`key_updated_revision`（公鑰最後一次變更時的分配版本）、`key_updated_by`（`admin`／`engineer`）與 `key_previous_fingerprint`（上次匯出時機器上那把公鑰的指紋；兩次匯出之間改好幾次，仍保留最早的「舊」指紋），並在 `users` 加上 `password_change_required_at`（管理員發的密碼尚未被使用者換掉）。`key_updated_revision` 大於上次匯出的版本時，這把公鑰是「待同步」。migration 之前存的公鑰沒有紀錄，視為已同步。
- 每位工程師有一個 **cluster id**（`eng1`…）：它是匯出檔裡的 `id`，也是 render.py 給 Prometheus target 的 `owner` 標籤與 `ssh-config --engineer` 的參數，所以建立後固定不變；新增的工程師自動拿下一個號碼（`eng6`…）。
- 每次寫入（新增／修改／停用／啟用工程師、改節點、改 owner email）都在同一個交易裡把 `revision` 加 1，並寫一筆稽核：`alloc.engineer_create`、`alloc.engineer_update`、`alloc.engineer_deactivate`、`alloc.engineer_reactivate`、`alloc.node_assign`（目標＝節點名；含確認旗標與待清理資訊）、`alloc.owner_update`，以及工程師自行更新公鑰的 `alloc.engineer_key_self_update`（actor＝工程師的帳號）；記錄匯出（`POST …/export/mark`）寫 `alloc.export`（目標 `revision:N`，不加版本號，`details.keyChanges` 列出這次匯出涵蓋的公鑰變更，`details.engineerKeyChanges` 是其中工程師自行送出的 `{username, from, to}`，`details.fingerprintsConfirmed` 記錄管理員是否勾選了指紋確認）。建立／解除工程師登入帳號（`alloc.engineer_account_create`、`alloc.engineer_account_unlink`）不影響匯出檔，所以**不加版本號**，但同樣寫稽核。與現值相同的寫入不算變更，不寫稽核。公鑰在稽核裡只記 SHA256 指紋（`from`→`to`），臨時密碼與公鑰原文都不會進稽核。
- **並行保護**：每個寫入都可帶 `expected_revision`（後台一律帶）；與目前版本不同時回 409 `revision_conflict`「資料已被其他管理員更新，請重新整理」。寫入在資料庫寫鎖內會重新確認呼叫者仍是啟用中的管理員。

### 規則（API 與後台相同）

- 帳號（username）沿用 `render.py` 的規則：`^[a-z_][a-z0-9_-]{0,31}$`（兩個字元的 `ll` 合法），保留字 `root`、`tku`、`bastion99`、`ubuntu`、`admin`、`daemon`、`bin`、`sys`、`sync`、`nobody`、`sshd`、`www-data`、`b300eng` 不可用。帳號是 Linux 使用者名稱，**建立後不可改**（要改就停用再新增）。email 存小寫、不可重複。新增時後台預設帳號＝email 的 local part。
- SSH 公鑰：一行 OpenSSH 公鑰（ssh-ed25519、ecdsa-sha2-nistp256/384/521、3072 位元以上的 ssh-rsa），不能有 `from=` 等選項前綴；同一把公鑰不能給兩個人。存好後只能替換、不能清空（要收回權限請停用）。後台顯示 SHA256 指紋與正規化後的公鑰。
- **不讓模板進 ansible**：匯出的文字最後會變成 ansible 變數，ansible 會解析 `{{ }}`。因此 email 必須符合 `^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$`（存小寫）；顯示名稱最多 64 字，以文字或數字開頭（同 render.py 的 NAME_RE），只能用文字（含中日韓文字）、數字、空白與 `. - _`（`{ } % # : , " ' \` 與控制字元一律拒絕）；公鑰註解只保留 `[A-Za-z0-9@._+-]`，其他註解在儲存時直接拿掉。`note` 不會匯出，但同樣拒絕 `{{`、`{%`、`{#`。
- 工程師節點必須指定一位**啟用中**的工程師；還有節點的工程師不能停用（409 `engineer_has_nodes`，先把節點改派）。
- **離開業務需明確確認**：把業務節點改成其他角色時，API 要求 `confirm_selling_change: true`，否則回 409 `selling_change_unconfirmed`；後台會先跳確認視窗。只改業務節點的備註不需要確認。
- **工程師節點不能直接改成業務**（409 `engineer_to_selling`「請先改為保留並完成節點同步，再改為業務」）：ansible 永遠不碰業務節點，所以帳號必須在節點還是「保留」時移除。完整流程：
  1. 把節點改成「保留」。portal 記下這次變更的版本（`pending_cleanup_revision`）與原工程師，節點標成「待清理」（後台的待清理清單、匯出回應的 `pendingCleanup`、檔頭註解都會列出）。
  2. 匯出 `engineers.yaml`（版本 ≥ 該版本；後台下載時會自動 `POST …/export/mark` 記錄）。
  3. 在 cluster repo 執行節點同步（runbook 4.7）。依 cluster 端正在進行的修改，node play 會對所有非業務節點執行並移除不再分配的 b300eng 帳號；**這個修改上線前，保留節點上的帳號要手動確認或移除**。
  4. 回到後台編輯該節點，選「業務」，勾選「我已依手冊 4.7 執行節點同步，且確認該節點已無工程師帳號」後儲存（API：`confirm_node_synced: true`）。最後匯出版本小於待清理版本時回 409 `node_cleanup_pending`；沒勾確認回 409 `node_sync_unconfirmed`。成功後清掉待清理標記並寫稽核。
  5. 再匯出、同步一次，讓 `selling.nodes` 生效。
  
  待清理的保留節點改派給工程師時，待清理標記會清除（node play 會重新管理它）。從來沒有工程師的保留節點可直接改成業務。

### 匯出 `engineers.yaml`

按「匯出 engineers.yaml」下載的檔案結構與 `~/github/b300-cluster/access/engineers.yaml` 相同（`selling.nodes`／`selling.vllm_ports`、`owner.email`、`engineer_vllm_ports`、`engineers[]` 的 `id`、`username`、`name`、`email`、`ssh_pubkey`、`nodes`、`state`）。種子狀態匯出後解析出來的內容與 2026-10-20 的檔案完全相等（測試釘住）。註解由 portal 產生（檔頭寫 `revision` 與 `generated_at`），手寫註解（例如 vLLM 埠的來源說明）不會保留。

- **沒有公鑰的工程師照樣匯出，`ssh_pubkey` 是 `"ssh-ed25519 AAAA... CHANGE_ME"`**，回應帶警告與 `missingKeys`。這是 render.py（2026-10-21 版）的規則：這樣的工程師是 **pending**——`check` 通過但印出警告（`pending, no SSH key yet`），他的節點仍歸他，監控照常包含他，`bastion-tsv`／`ansible-vars`／playbook 不為他建立任何帳號或公鑰，其他人照常同步。舊的「任何人缺公鑰就整個拒絕」改成 `check --require-all-keys`。回應的 `renderReady`＝`render.py check` 會過（有可匯出的工程師且 owner email 已設），`monitoringReady` 目前與它相同，`missingKeys` 是 pending 的人。
- **上次匯出後公鑰有變更**（管理員或工程師自己改的）的工程師列在回應的 `keyChanges`（`username`、`fingerprint`、`updatedBy`、`revision`）並帶一則警告：新公鑰要等這個檔案跑完跳板機（4.6）與節點（4.7）同步才會生效。記錄匯出後就不再是待同步。
- **停用的工程師**匯出為 `state: absent`，`nodes` 是他曾經被分配過的全部節點（`node_history`），讓 playbook 移除帳號；已變成業務的節點會被略過（render.py 禁止），回應會提醒要手動清除。沒有任何可列節點的停用工程師不匯出。
- 啟用中、沒有節點**也還沒有公鑰**的工程師不匯出，列在 `excluded`（原因「尚未提供公鑰」）與檔頭註解：他不可能有過帳號（存好的公鑰不能清空），沒有東西要建立或移除，匯出只會多一則 pending 警告。
- 啟用中、沒有節點但**有公鑰**的工程師照樣匯出（`nodes: []`、`state: present`）：render.py 接受，同步後會移除其跳板機帳號與節點帳號，只留 Grafana 登入。匯出回應會帶警告「此工程師目前沒有節點，同步後會移除其跳板機帳號與節點帳號」，節點還在待清理時一併列出。
- `owner.email`（Grafana Admin、Cloudflare Access）在匯出面板修改；清空時檔案帶 `CHANGE_ME@your-mail-domain`，render.py 會拒絕。
- `selling.vllm_ports` 與 `engineer_vllm_ports` 是 ops 擁有的設定，portal 用 `server/allocation.py` 裡的常數（抄自 2026-10-20 的 engineers.yaml）。cluster repo 改了這些埠，要同步改常數。
- API：`GET /api/portal/admin/allocation/export` 是唯讀的，回 JSON（`filename`、`yaml`、`revision`、`generatedAt`、`warnings`、`excluded`、`missingKeys`、`pendingCleanup`、`keyChanges`、`renderReady`、`monitoringReady`），後台據此下載成 `engineers.yaml`，接著呼叫 `POST /api/portal/admin/allocation/export/mark`（`{revision}`）記錄「已匯出到哪個版本」並寫 `alloc.export`；記錄只會往前，不會被較舊的版本蓋回去。在 portal 容器內直接打服務可加 `?format=yaml` 拿純文字（`Content-Disposition: attachment; filename="engineers.yaml"`）；BFF 不轉送這個參數。

### 同步到機器（runbook `docs/engineer-access-runbook.md`，2026-10-20 版）

在 Mac 上先備份 `~/github/b300-cluster/access/engineers.yaml`，用下載的檔案覆蓋，然後在 `~/github/b300-cluster` 一行一行執行（後台匯出面板列了同一組指令，另含 4.6 的 TSV 與 4.8 的 `ssh-config`）。缺公鑰的工程師在 `check` 會列為 pending 警告，4.6、4.7 會略過他們；runbook 標「生產・需 owner 核准」的步驟照 runbook 先取得核准。

```
python3 access/render.py check
```

```
python3 access/render.py access-emails
```

```
bash bin/b300-monitoring-update.sh check
```

```
bash bin/b300-monitoring-update.sh images
```

```
bash bin/b300-monitoring-update.sh apply
```

```
~/.venvs/ansible/bin/ansible-playbook -i ansible/inventory.ini ansible/engineer-access.yml --tags bastion -K
```

```
~/.venvs/ansible/bin/ansible-playbook -i ansible/inventory.ini ansible/engineer-access.yml --tags nodes -K
```

跳板機沒有 sudo 時改走 runbook 4.6 的 TSV 流程；新工程師用 `python3 access/render.py ssh-config --engineer <cluster id>` 產生他的 SSH 設定（4.8）。Cloudflare Access 名單（第 2 節）與 Grafana 使用者仍依 runbook 手動維護。runbook 的章節編號若再改，以 runbook 為準並同步更新 `components/admin-allocation-section.tsx` 的 `SYNC_STEPS`。

### 工程師自己提供 SSH 公鑰

公鑰會變成正式 GPU 節點與跳板機的 SSH 登入，所以身分必須可靠。入口網站的註冊是開放的、不驗證 email，**「email 相同」不能當作身分證明**。因此只有管理員替工程師建立並連結的帳號，才能設定那位工程師的公鑰；新公鑰也要等管理員下次匯出並同步才會生效，這一步仍是人工把關。

1. 管理員在「機台分配」的工程師列表按「建立登入帳號」（`POST /admin/allocation/engineers/{id}/account`）。portal 以工程師的 email 建一個 `customer` 角色的帳號（不新增角色；客戶自助發 API 金鑰預設關閉，見 `PC_CUSTOMER_KEY_ISSUANCE`），並連結到這位工程師。伺服器產生的**臨時密碼只在這次回應顯示一次**（只存雜湊，不進稽核），後台跳出視窗可複製。該 email 已經有帳號時回 409 `account_exists`，**不會自動連結**（可能是別人搶先用這個 email 註冊）：請改用工程師另一個 email，或查明該帳號後再處理。停用中的工程師不能建帳號（409 `engineer_inactive`）；已連結的回 409 `account_linked`。
2. 管理員私下把 email 與臨時密碼交給工程師。臨時密碼建立時就帶有「必須變更密碼」標記（`users.password_change_required_at`）；管理員在「客戶」重設密碼時也會設這個標記。標記存在時 `POST /me/engineer/ssh-key` 一律回 403 `password_change_required`（在嘗試次數計數之前檢查，寫鎖內再確認一次），`/account/ssh-key` 的表單停用並提示先到「安全性」改密碼；`POST /password` 成功後清掉標記。也就是說，管理員知道的密碼永遠不能設定正式機器的公鑰。工程師登入後先到 `/account/security` 變更密碼，再到 `/account/ssh-key`（帳號導覽「SSH 公鑰」，只有已連結的帳號看得到）貼上公鑰、輸入目前密碼送出。頁面顯示他自己的節點、目前公鑰的指紋與狀態（尚未提供／待同步／已同步），不會顯示公鑰原文，也看不到其他工程師。
3. 送出時的檢查與管理員路徑相同（`parse_public_key`：ed25519、ecdsa、≥3072 位元 RSA，不接受 `sk-*`、選項前綴；同一把公鑰不能給兩個人，409 `engineer_conflict`），另外要重新驗證目前密碼（錯誤 400 `invalid_current_password`），每個帳號 15 分鐘內最多 5 次嘗試（429 `rate_limited`）。寫入在資料庫寫鎖內重新確認帳號未停用、仍連結、工程師仍啟用，加版本號，記 `key_updated_by='engineer'`，寫 `alloc.engineer_key_self_update`（指紋 from→to）。回應說明「管理員下次匯出並同步後才會生效」。
4. 後台該工程師的公鑰欄出現「工程師已更新公鑰，待匯出同步」，匯出面板列出待同步的公鑰（舊指紋 → 新指紋）。**匯出前要驗證送出的人真的是工程師本人**（帳號密碼可能外洩）：透過其他管道（電話／當面／公司通訊）請工程師唸出他電腦上 `ssh-keygen -lf ~/.ssh/id_ed25519.pub` 的指紋，與新指紋比對，然後勾選「已透過其他管道（電話／當面／公司通訊）向工程師確認新指紋」才能匯出。後端同樣把關：匯出範圍內有工程師送出的公鑰時，`POST …/export/mark` 必須帶 `fingerprintsConfirmed: true`，否則回 409 `fingerprint_confirmation_required`；只有管理員改的公鑰不需要確認。接著照平常跑 4.6、4.7；記錄匯出後狀態變成已同步。
5. 不寄通知信：入口網站目前沒有寄信功能，工程師或管理員都不會因公鑰變更收到 email。可列為後續改善（例如公鑰變更時通知工程師的信箱，讓帳號被盜用時本人會知道）。

「解除連結」（`…/account/unlink`）只拿掉連結，帳號本身不刪除也不停用（需要時到「客戶」停用），已存的公鑰與節點不變。臨時密碼遺失時，到「客戶」用管理員重設密碼（之後工程師要再改一次密碼才能送公鑰）。`parse_public_key` 拒絕註解含 `CHANGE_ME`（不分大小寫）的公鑰：render.py 會把這種公鑰當成「還沒有公鑰」的佔位。

已知限制（目前不處理）：

- **解除連結是單向的**：解除後那個 email 仍有入口網站帳號，「建立登入帳號」會回 409 `account_exists`，不會重新連結。誤解除時要改用工程師另一個沒有帳號的 email（先在「編輯」改工程師的 email，再建立帳號）。
- **「已同步」只表示「包含在最近一次記錄的匯出裡」**，不代表已經套用到機器：portal 不連機器，看不到 4.6、4.7 有沒有跑完。`POST …/export/mark` 也相信管理員送來的版本號（後台會送剛下載的那個版本）；手動呼叫時送錯版本，狀態就會不準。

### API（皆需管理員，非管理員 403、未登入 401）

| Route | 用途 |
| --- | --- |
| `GET /admin/allocation` | 版本、owner email、上次匯出、16 個節點、工程師（含 cluster id、指紋與節點）、摘要計數 |
| `POST /admin/allocation/engineers` | `{username, email, displayName?, sshPubkey?}`，201 |
| `POST /admin/allocation/engineers/{id}` | `{email?, displayName?, sshPubkey?}`；改 `username` 回 400 |
| `POST /admin/allocation/engineers/{id}/status` | `{active: true \| false}` |
| `POST /admin/allocation/engineers/{id}/account` | 建立並連結工程師的入口網站帳號，201，回應含一次性的 `temporaryPassword` 與 `account` |
| `POST /admin/allocation/engineers/{id}/account/unlink` | 解除連結（帳號保留） |
| `POST /admin/allocation/nodes/{name}` | `{role: "selling" \| "engineer" \| "reserved", engineerId?, note?, confirm_selling_change?, confirm_node_synced?}` |
| `POST /admin/allocation/owner` | `{ownerEmail}` |
| `GET /admin/allocation/export` | 唯讀，見上 |
| `POST /admin/allocation/export/mark` | `{revision, fingerprintsConfirmed?}`，記錄已匯出的版本；範圍內有工程師送出的公鑰時 `fingerprintsConfirmed` 必須是 `true`（否則 409 `fingerprint_confirmation_required`） |

寫入都可帶 `expected_revision`；成功都回傳完整的最新狀態（含新的 `revision`）。狀態裡每位工程師另有 `account`（`{userId, email, disabled}` 或 `null`）、`keyPendingSync`、`keyUpdatedBy`、`keyUpdatedRevision`、`keyPreviousFingerprint`；匯出回應的 `keyChanges` 也帶 `previousFingerprint`。

工程師自助（任何已登入帳號都可呼叫，但只有已連結的帳號會成功）：

| Route | 用途 |
| --- | --- |
| `GET /me/engineer` | 未連結回 404 `not_engineer`；已連結回自己的 `username`、`displayName`、`active`、`nodes`、`key`（`{type, bits, fingerprint}` 或 `null`）、`keyPendingSync`、`keyUpdatedBy`、`passwordChangeRequired` |
| `POST /me/engineer/ssh-key` | `{sshPubkey, currentPassword}`；密碼尚未變更時 403 `password_change_required`；見上節 |

### 回滾

- 只退工程師自助（`0004_engineer_accounts`）：舊映像不認得這個 revision，先用新映像把 schema 降到 `0003_node_allocation`（下面的指令把最後的版本換成 `'0003_node_allocation'`）。這只刪掉新欄位（帳號連結、公鑰變更紀錄、`users.password_change_required_at`），工程師、公鑰與已建立的入口網站帳號都保留。
- 只退程式：分配表不影響其他功能，但**舊映像不認得 revision `0003_node_allocation`**（啟動時會拋 `Can't locate revision '0003_node_allocation'` 並不斷重啟），必須先用新映像降級 schema。
- 降級 schema 到 `0002_users_disabled_at`（在 `powerchampion-portal` 容器的 Terminal，Bash）：

```sh
python -c "from alembic import command; from server.migrate import _config; from server.db import Database; from server.settings import Settings; command.downgrade(_config(Database(Settings.from_env().resolved_database_url).url), '0002_users_disabled_at')"
```

降級會刪掉三張 `alloc_*` 表（分配、工程師公鑰、版本號都會消失）與 `audit_events.details`（稽核列本身保留）。降級前先匯出一次 `engineers.yaml` 留底。再次升級會重建種子分配（不是降級前的資料）。

## 工程師（唯讀）

`/admin/engineers`（後台導覽「工程師」，在「機台分配」之後）每位工程師一列：分配到的節點與 SSH 金鑰狀態、最後互動式登入、目前 GPU 用量（張數與顯存）、與他本人或他的節點有關且正在 firing 的告警、最近 10 筆部署標記（閘道只取 14 天內），以及已用他的名字篩好的 Grafana 連結。**這一頁不顯示指令紀錄**：指令紀錄留在節點上，用 `sudo b300-activity` 查。頁面沒有任何寫入動作，讀取也不寫稽核。

資料流：

```
瀏覽器（admin）
  │  same-origin cookie pc_portal_session
  ▼
BFF  app/api/portal/[...path]/route.ts      GET /api/portal/admin/engineers（regex 白名單，只放 GET、不轉送 query）
  ▼
portal FastAPI  server/admin_engineers.py   管理員限定
  │   ├─ DB：alloc_engineers / alloc_nodes / alloc_meta（名冊、節點、金鑰狀態；不帶公鑰原文、email、帳號）
  │  HTTPS + X-Admin-Token（PC_GATEWAY_ADMIN_TOKEN）
  ▼
閘道 sell-panel  GET /api/engineers/activity   30 s 快取；Grafana Viewer token（B300_GRAFANA_READ_TOKEN）
  ▼
b300-grafana-tunnel → Grafana（b300-31）→ Prometheus、annotations（b300-mark 的部署標記）
```

狀態與處理（名冊在每一種狀態下都會顯示）：

| 狀態 | 意義 | 處理 |
|---|---|---|
| 閘道尚未連線 | portal 沒有 `PC_GATEWAY_ADMIN_TOKEN`，不呼叫閘道 | 設定 portal 的閘道 token |
| 閘道版本尚未支援工程師活動 | 閘道回 404（`gateway_outdated`） | 先部署含 `/api/engineers/activity` 的閘道 |
| 無法從閘道取得工程師活動 | `gateway_error`；代碼 `gateway_auth_failed` 表示 portal 的閘道 token 被拒 | 依代碼檢查 portal 設定或閘道狀態 |
| 閘道尚未設定 Grafana 讀取權杖 | 閘道的 `B300_GRAFANA_READ_TOKEN` 為空 | 照 b300-cluster runbook §4.4b 建 Viewer token，加到 Dokploy 閘道的 Environment |
| Grafana 讀取權杖被拒 | token 過期或被撤銷（`grafana_auth_failed`） | 照 runbook §4.4b 輪換 token |
| 監控資料暫時無法取得 | Grafana／tunnel 連不到（`monitoring_unavailable`） | 檢查 b300-grafana-tunnel 與 Grafana |
| 部分監控資料無法取得 | `partial`：Prometheus 或 annotations 其中之一失敗（代碼不認得時顯示 `unknown`） | 失敗來源的欄位顯示「—」或「暫時無法取得」，其他照常 |
| 顯示 N 秒前的資料 | 這次刷新失敗，閘道回 300 s 內的舊資料（`status` 維持舊值，例如 ok，錯誤代碼另外顯示）；或資料超過 300 s | 監控恢復後自動更新；代碼是 `http_401` 時照 runbook §4.4b 輪換 token |
| 資料過多，已截斷 | 超過上限或有不合格的資料列被丟掉 | 被丟掉那一列所屬的節點顯示「—」而不是 0 |

欄位的意思：

- **SSH 金鑰「已同步」**＝在金鑰變更後，管理員已在「機台分配」標記過匯出。這**不代表**節點上的 `authorized_keys` 已逐台驗證過。「待同步」＝金鑰在上次標記匯出之後變更過；「未提供」＝沒有公鑰。
- **最後互動式登入**只計配了 pty 的 SSH 登入（讀節點的 `/var/log/lastlog`）。`ssh host cmd`、VS Code Remote、scp/sftp 不會更新；從未登入顯示「—」。
- **部署標記**依 relay 從來源 IP 推出的 `owner`（`engN`，等於工程師的 cluster id）歸屬；標記上的使用者是節點上的 `$USER`，可以自己宣稱，未驗證時加「未驗證」徽章。說明只取第一行，其中的 IP 位址與看起來像權杖或 `--key` 參數的字串會被遮成 `[address]`／`[redacted]`；模型名稱若像網址或位址則不顯示。部署標記要 relay 有 Editor token（b300-cluster runbook §4.4），在那之前清單是空的。
- **告警**取 Prometheus 正在 firing 的告警：帶 username 的歸給該工程師，帶 node 的歸給分配到該節點的工程師。販售節點由閘道先濾掉。
- **監控標籤與分配不一致**：Prometheus 的 `engineer` 標籤和這裡的分配不同，通常是匯出還沒套用到機器。
- 停用的工程師也列出，以灰色顯示。對不到名冊的資料（tku、root、`uid_N`、未分配節點的告警、對不到 owner 的部署）放在「未對應的資料」。
- Grafana 連結的網址由 `PC_GRAFANA_URL` 決定（預設 `https://grafana.powerchampion.ai`，設為空字串則不顯示連結）。

## 影片工作室（studio，S2 後端）

規格在 shortvideo-agent 的 `docs/studio-spec.md`（v3、§12、§13.2）。S2 只有後端與 BFF 白名單，畫面是 S3、Compose 服務是 S4；**在 S4 之前生產環境沒有 shortvideo-api，所以 `/studio/*` 一律回 503 `studio_unconfigured`**。

- **設定**：portal 需要 `PC_STUDIO_AGENT_URL`、`SHORTVIDEO_SERVICE_TOKEN`、`SHORTVIDEO_GRANT_SECRET`、`SHORTVIDEO_QUOTE_SECRET`（後三者與 shortvideo-api 相同；token 不可等於任一個 secret）。少一個就整個 studio 503。四個值只放 Dokploy 的 Environment，不寫進 compose。
- **Demo 模式（只開給名單）**：Dokploy Environment 設 `PC_STUDIO_ALLOWED_EMAILS=a@example.com,b@example.com`（逗號分隔，前後空白與大小寫不影響），重新部署 portal 後只有名單上的帳號與所有管理員能用 `/studio`；其他登入帳號在每個 studio 路由都回 403 `studio_not_open`，畫面顯示跟未接 agent 時一樣的「影片工作室尚未開放」，帳戶頁頂端也不顯示「影片工作室 ↗」按鈕（`GET /session` 的 `studio_access`）。發點數等管理員路由不受影響，可以先發點數再把人加進名單。設為空或不設＝對所有登入帳號開放（原行為）。
- **點數**：1 點＝NT$1 牌價。`POST /api/portal/admin/studio/credits/grant` `{user_id, credits, note?, plan?, period_end?}`（管理員限定，寫稽核 `admin.studio_credits_grant`；負數＝扣回，稽核 `admin.studio_credits_expire`，不能扣到可用餘額以下）。`plan` 是 `creator|merchant|agency`，決定 agent 端每日花費上限；第一次發點數沒給就用 `creator`。月初重置目前手動。
- **用量**：`GET /api/portal/admin/studio/usage?month=YYYY-MM`：每位使用者的扣點／退點（portal 帳本）對照 agent 的牌價成本與 GPU 秒數。`est_gpu_usd` 是估算（D-V8 之前閘道仍以牌價計費）。agent 連不到時仍回 portal 的部分，`agent_status` 不是 `ok`。
- **扣點流程**：報價（agent 簽章）→ portal 本地驗章 → 一個資料庫交易裡預扣（同時檢查冪等鍵、每個專案 1 個、每人 2 個進行中的工作、餘額）→ 送 agent。agent 回 4xx 立即退點；逾時或 5xx 進 `unknown`，由每 10 秒的 sweeper 向 agent 查詢後結算。portal 在預扣後當掉：120 秒後 agent 仍查無此工作就退點。失敗的工作只收已產出的部分（`produced_credits`）。
- **對帳**：每位使用者 `studio_accounts.balance` 等於 `studio_ledger.delta` 的總和，`reserved` 等於進行中工作的點數總和。
  ```sql
  SELECT a.user_id, a.balance, (SELECT COALESCE(SUM(delta),0) FROM studio_ledger l WHERE l.user_id=a.user_id) AS ledger,
         a.reserved, (SELECT COALESCE(SUM(credits),0) FROM studio_ops o WHERE o.user_id=a.user_id AND o.state IN ('reserved','submitted','unknown')) AS held
  FROM studio_accounts a;
  ```
- **卡住的工作**：`submitted` 但 agent 回 `studio_not_found`（agent 資料被清掉或還原）時，log 每 10 秒一行 `studio op … is submitted but unknown to the agent`；滿 6 小時自動退點（`error = lost_by_agent`，log 等級 ERROR）。agent 回沒有代碼的 404（路由錯了）一律不退點。
- **秘密外洩**：輪換 `SHORTVIDEO_SERVICE_TOKEN` 與 `SHORTVIDEO_GRANT_SECRET`（兩邊同時改、同時重啟）；外洩期間只有 agent 的全域每日上限擋得住（規格 §2.2）。
- **回滾（schema）**：migration `0005_studio` 只新增 5 張 `studio_*` 表，其他功能不受影響。**舊映像不認得 revision `0005_studio`**，退回前先用新映像在 `powerchampion-portal` 容器的 Terminal（Bash）降級（會刪掉 studio 的表與帳本，先 dump）：

  ```sh
  python -c "from alembic import command; from server.migrate import _config; from server.db import Database; from server.settings import Settings; command.downgrade(_config(Database(Settings.from_env().resolved_database_url).url), '0004_engineer_accounts')"
  ```

## 串接正式服務前

1. 為帳號服務配置獨立的 HTTPS 入口、持久資料庫和備份。前端設定 `PC_PORTAL_ORIGIN` 為該服務的 HTTPS origin，不包含路徑；開發時未設定此值會使用本機 `127.0.0.1:3020`。Cloudflare 部署請使用伺服器環境變數；本機的 `.dev.vars` 檔已排除版本控制。
2. 帳號服務設定 `PC_PORTAL_ENV=production`、`PC_PORTAL_SECURE_COOKIES=1` 及精確的 `PC_PORTAL_ALLOWED_ORIGINS`。限制服務只能由網站入口存取，並由可信任的邊緣入口執行 IP 請求限制。
3. 依上節「連接閘道（A2b）」設定 `PC_GATEWAY_ADMIN_TOKEN`。金鑰發放／停用與用量讀取會使用真正的閘道管理 API；前端不會取得此管理憑證。詳細環境設定見 [server/README.md](../server/README.md)。
4. 選定付款服務後，再接入付款確認、簽章 webhook、退款和閘道可用餘額。現在的儲值審核只儲存人工查核紀錄；核准本身不代表收款成功，也不會自動增加可花用餘額。

既有客戶金鑰需要明確確認並匯入歸屬，系統不會根據名稱或信箱猜測金鑰的擁有者。

## SEO 與宣傳

英文為預設。英文、繁中、簡中、日文與韓文共用完整的品牌首頁版型，包含立體主視覺、服務架構互動、模型篩選、應用情境、程式碼、計費工具、GPU、公司與 FAQ。四種區域語言另各有模型、價格、GPU 與公司頁，共 20 個區域頁面。

主導覽直接顯示目前語言，選單提供五語入口；主要公開頁切換語言時保留目前的頁面類別。英文標準網址固定呈現英文，不受先前瀏覽器語言偏好影響。模型詳情、開發工具、智能體建置器與帳號後台目前提供英文／繁中；工具頁切換這兩種語言會保留頁面與輸入，其他語言選項會清楚提示並前往對應品牌首頁。

結構化資料：首頁與各語言首頁、`/faq` 各自輸出 FAQPage（只描述該頁實際顯示、該語言的問題），模型頁在麵包屑之外再輸出 Product＋Offer（刊登費率與計費單位，可用性取自模型目錄）。

網站流量統計：在 Dokploy 設 `WEB_ANALYTICS_TOKEN` 為 Cloudflare Web Analytics 的 site token（Cloudflare 後台 → Web Analytics → 加入網站取得），只會在公開頁面載入；帳號、管理、登入、註冊與預覽環境不載入。不設 Cookie、不跨站追蹤，隱私頁已載明。值為空或格式不符時完全不輸出。

Google Search Console 驗證：在 Dokploy 為網站服務設 `SITE_VERIFICATION` 為 Search Console 給的 token（HTML 標籤法），重新部署後 `<meta name="google-site-verification">` 就會出現；值為空或格式不符時不輸出任何標籤，不需要改程式。驗證完成後在 Search Console 提交 `https://powerchampion.ai/sitemap.xml`。

sitemap 不放 lastmod：沒有可信的內容修訂時間，全部填同一個部署日期對爬蟲沒有意義，也可能誤導。

`npm run seo:sitemap` 會由路由與模型清單產生 45 個公開網址。正式 canonical 固定指向 `https://powerchampion.ai`；本機／預覽與帳號／管理頁禁止索引。新增公開頁面時需同步更新 `lib/seo.ts` 的路由清單。

分享卡為 `public/og-platform.png`，尺寸 1200×630；favicon 與網站標誌使用相同香檳金圖形。站點已加入多語對應網址、公司結構化資料與模型麵包屑。

上線後再依 [宣傳包](marketing/2026-09-launch-kit.md) 發文及寄送公告，並使用 [活動連結](marketing/campaign-links.csv)。目前沒有寄送郵件、發布社群、投放廣告或向搜尋引擎提交網址。

## 驗證指令

```sh
npm run lint
npx tsc --noEmit --incremental false
npm run test:unit
npm run test:backend
npm run build
node --test tests/rendered-html.test.mjs
```

後台自動化測試使用臨時資料庫及模擬閘道。`scripts/test_backend_postgres.sh` 可在 Postgres 上跑同一套測試。瀏覽器驗證使用清楚標記的臨時測試帳號與人工查核紀錄，驗證後會移除；沒有執行付費模型請求或真實付款。
