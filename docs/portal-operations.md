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
- 繁中／簡中／日文／韓文公開頁：`/zh-Hant`、`/zh-Hans`、`/ja`、`/ko`

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

資料庫結構由 Alembic 管理，目前 head 為 `0002_users_disabled_at`（新增 `users.disabled_at`）。**在退回 A2a 之前的舊映像前，必須先用新映像把結構降回基線**：在 `powerchampion-portal` 容器的 Terminal（Bash）執行：

```sh
python -c "from alembic import command; from server.migrate import _config; from server.db import Database; from server.settings import Settings; command.downgrade(_config(Database(Settings.from_env().resolved_database_url).url), '0001_baseline')"
```

沒做的話，舊映像的 `Store()` 啟動時會拋出 `Can't locate revision '0002_users_disabled_at'` 並不斷重啟。降級會刪除 `users.disabled_at` 欄位，**所有被停用的帳號會因此恢復為啟用**；回滾後如需維持停用，要自行處理（例如重設密碼）。再次升級到新映像時，啟動會自動回到 head。

登入限制目前只有帳號層級（每帳號 15 分鐘 5 次失敗、註冊每帳號每小時 10 次）。建議另在邊緣（Cloudflare 或 Traefik）對 `/api/portal/auth/*` 設定以來源 IP 計的速率限制。

## 連接閘道（A2b）

A2b 讓管理後台透過閘道的 admin token 管理金鑰、用量與模型／節點。未設定 `PC_GATEWAY_ADMIN_TOKEN` 時，`/admin/keys`、`/admin/usage`、`/admin/gateway` 顯示「閘道尚未連線（PC_GATEWAY_ADMIN_TOKEN 未設定）」，客戶與帳號功能不受影響。後台導覽順序：總覽、客戶、金鑰、用量、閘道、儲值申請、操作紀錄。

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
- **停用模型要確認**：`/admin/gateway` 按模型的「停用」會先跳出確認視窗（停用後客戶會收到 404），確認後才送出；「啟用」仍是一鍵。
- 金鑰相關審計事件：`admin.key_issued`、`admin.key_disabled`、`admin.key_enabled`、`admin.key_limits`、`admin.key_balance`、`key.created`（客戶自助）、`key.revoked`；閘道操作為 `admin.model_toggled`、`admin.model_maintenance`、`admin.node_op`。事件不含密鑰內容。

### 回滾

把 Dokploy 的 `PC_GATEWAY_ADMIN_TOKEN` 拿掉並重新部署：後台三個頁面回到「未連線」，客戶資料、帳號與已發出的金鑰不受影響（金鑰留在閘道）。此版沒有新增資料庫結構，不需要降級 schema。

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
