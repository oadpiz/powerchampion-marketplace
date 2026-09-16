# Power Champion 帳號後台與上線交接

目前版本提供可持續儲存的客戶帳號與管理後台，並隨 powerchampion.ai 一起部署（見下方「正式環境（Dokploy）」）。既有推論服務及正式付款流程未變更；閘道金鑰自助發放與匿名試用維持關閉。

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

帳號資料保存在被版本控制排除的 `.local/portal.sqlite3`。正式環境必須配置持久磁碟與備份。服務初次啟動不會自動建立管理員，也不會將第一個註冊的人變成管理員。

## 品牌官網與模型工具

- `/`：模型 API／Agent 建置／GPU 品牌官網。立體主視覺可切換推理、視覺與創作模型並前往對應模型頁；三項服務可切換架構示意與詳細入口。加入游標互動、分層光影、捲動進場與按鈕回饋；可暫停並遵循減少動態偏好，鍵盤可操作模型及服務分頁。
- `/chat`：選用的多輪文字聊天、助理切換、取消等待、複製回覆和匯出對話。三組立即可看的內容清楚標為預寫範例，不會冒充模型生成。
- `/agents`：四種可搜尋的助理範本、指令預覽，以及企業 Agent 建置服務。需求表先產生使用者可檢視的郵件草稿，不會自動寄信。
- `/agents/build`：設定名稱、用途、模型、指令、語氣、參考資料與測試問題；可主動儲存／還原／刪除瀏覽器草稿、複製指令與匯出 JSON。測試設定使用 sessionStorage，30 分鐘內可重新載入；聊天的「返回編輯」會帶回同一設定。
- `/solutions`：保留可用的品牌首頁別名，canonical 指向 `/`。既有工具、帳戶與後台網址仍可使用。

內建助理是指令範本，沒有自動連接外部工具、搜尋引擎或客戶系統。企業服務可由需求確認、知識整理、工具串接、測試與交付另行建置。

聊天使用 `POST /api/chat`，僅接受兩個文字模型，並將請求轉送至固定閘道。客戶金鑰只保留在頁面記憶體；開啟其他頁面或重新載入後須再連接。對話不會儲存於帳戶，匯出檔也不包含金鑰。

截至 2026-09-11，公開閘道狀態仍回報中斷。本機預覽已驗證 `/api/chat/config` 回傳 `trialAvailable: false`，無金鑰請求回傳 `503 trial_unavailable`，沒有執行付費模型請求。真實對話需要可用閘道及有效客戶金鑰；免金鑰試用則另需營運者啟用以下設定。

### 選用公開試用

帳號服務必須同時設定 `PC_TRIAL_ENABLED=1`、專用 `PC_TRIAL_API_KEY` 與正數 `PC_TRIAL_DAILY_REQUEST_LIMIT`。預設關閉；金鑰不得放入前端公開變數。完整設定見 [server/README.md](../server/README.md#anonymous-chat-trial)。

每次試用先在 SQLite 保留全站與該瀏覽器當日名額，失敗／逾時／取消也占名額；重設 Cookie 無法重設全站上限。每次輸出上限 512 tokens，對話歷史上限 8,000 字元，最多 24 則訊息。這是次數與單次內容限制，不是美元花費上限，仍須替專用閘道金鑰設定適合的額度。公開入口另需可信任的邊緣請求限制。

## 建立管理員

由操作人員在本機執行以下命令，將範例信箱替換為自己的信箱，再於隱藏輸入提示中設定密碼：

```sh
python3 -m server.manage create-admin --email you@example.com
```

接著在 `/login` 登入並選擇 Open administration。此命令不會將已存在的一般客戶提升權限。需要復原帳號時，管理員先確認帳號擁有者，再執行：

```sh
python3 -m server.manage reset-password --email you@example.com
```

重設密碼會登出該帳號的所有工作階段。系統目前不會寄送驗證信或密碼重設信。

## 正式環境（Dokploy）

`docker-compose.dokploy.yml` 同時啟動網站與帳號服務（`server/Dockerfile`）：

- 帳號服務容器 `powerchampion-portal` 只在 Compose 內部網路，沒有對外 port、沒有 Traefik 路由，也不在 `dokploy-network`；網站以 `PC_PORTAL_ORIGIN=http://powerchampion-portal:3020` 連線。BFF 只允許單段主機名（Compose 服務名）使用 http，其他明文位址一律拒絕。
- 資料庫在具名 volume `portal-data`（容器內 `/data/portal.sqlite3`），重新部署不會清除。備份需另外在 Dokploy 設定 Volume Backup。
- 已設定 `PC_PORTAL_ENV=production`、`PC_PORTAL_SECURE_COOKIES=1`、`PC_PORTAL_ALLOWED_ORIGINS=https://powerchampion.ai`。網站需 `VINEXT_TRUST_PROXY=1`，否則 TLS 在 Traefik 終止後同源檢查會失敗、全站會被標為 noindex。
- **刻意未設定** `PC_GATEWAY_ADMIN_TOKEN`：sell-panel 以此 API 建立的金鑰不帶預付餘額，閘道會視為後付且無花費上限。客戶按「建立金鑰」會看到尚未開通；金鑰仍由營運者在 sell-panel 手動發放。要開放自助發放，需先讓閘道對新金鑰強制預付。
- 匿名試用關閉（`PC_TRIAL_ENABLED=0`、無 `PC_TRIAL_API_KEY`）。

建立第一個管理員：在 Dokploy 開啟 `powerchampion-portal` 容器的 Terminal，執行

```sh
python -m server.manage create-admin --email you@example.com
```

登入限制目前只有帳號層級（每帳號 15 分鐘 5 次失敗、註冊每帳號每小時 10 次）。建議另在邊緣（Cloudflare 或 Traefik）對 `/api/portal/auth/*` 設定以來源 IP 計的速率限制。

## 串接正式服務前

1. 為帳號服務配置獨立的 HTTPS 入口、持久資料庫和備份。前端設定 `PC_PORTAL_ORIGIN` 為該服務的 HTTPS origin，不包含路徑；開發時未設定此值會使用本機 `127.0.0.1:3020`。Cloudflare 部署請使用伺服器環境變數；本機的 `.dev.vars` 檔已排除版本控制。
2. 帳號服務設定 `PC_PORTAL_ENV=production`、`PC_PORTAL_SECURE_COOKIES=1` 及精確的 `PC_PORTAL_ALLOWED_ORIGINS`。限制服務只能由網站入口存取，並由可信任的邊緣入口執行 IP 請求限制。
3. 確認實際生產閘道契約後，才將 `PC_GATEWAY_ADMIN_TOKEN` 設定在帳號服務。金鑰發放／停用與用量讀取會使用真正的閘道管理 API；前端不會取得此管理憑證。詳細環境設定見 [server/README.md](../server/README.md)。
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

後台自動化測試使用臨時資料庫及模擬閘道。瀏覽器驗證使用清楚標記的臨時測試帳號與人工查核紀錄，驗證後會移除；沒有執行付費模型請求或真實付款。
