# 統一管理後台設計（總後台／模型控制台／雙官網整合）

日期：2026-10-08
狀態：設計已獲使用者口頭核准；已通過一輪獨立 read-back 審查並修正（見 §11）；待使用者審閱
範圍：本檔是總體設計（program-level），定義分期、架構邊界與每期的驗收條件。
每一子期開工前另寫該子期的實作計畫（`docs/superpowers/plans/`）。

## 1. 背景與問題

2026-10-08 盤點（三個 Explore agent，結果摘要於本節）得出目前有四個「後台面」：

| 面 | Repo／分支 | 技術 | 現狀 |
|---|---|---|---|
| b300.powerchampion.ai 閘道 `/admin` | `sell-panel`，生產分支 `glm53-gateway` | Python FastAPI 單檔 `app.py`，HTML 內嵌 | 成熟：API key、預付餘額、用量月報、模型啟停、維護模式、節點 start/stop、fleet 工作流 API。認證只有 admin／viewer 兩個密碼，無帳號表 |
| powerchampion.ai 帳號後台（portal） | `powerchampion-marketplace` `main` | Vinext（React 19）BFF ＋ 私有 FastAPI／SQLite | 客戶自助：註冊、金鑰、用量、儲值申請、agents、tasks。admin 只有 4 個唯讀頁＋儲值審核。生產刻意不設閘道 admin token，金鑰自助發放關閉 |
| powerchampion.org 公司官網 | `powerchampion-website` `main` | React／Vite 靜態站，Vercel | 純行銷（HGX 叢集租賃、B2B 人工報價），無後台、無 API，唯一動態功能是 EmailJS 聯絡表單 |
| Go 版閘道重寫 | `sell-panel` `origin/main` 的 `cmd/`、`internal/` | Go | 未上線；已有 modelrepo／fleet／billing／alerts 路由 |

模型下載目前是半自動：節點 agent `node_agent.py` 有 `/control/lifecycle`
（動作限 `LIFECYCLE_ACTIONS`：download、verify、warm、activate、drain、rollback、quarantine，
含磁碟檢查與 safetensors 驗證），但只認寫死在 `CONTROL_RECIPES` 的 4 個模型，vLLM 啟動指令藏在
recipe 的 `serve_command` 由 `activate` 執行；下載腳本一模型一支（`scripts/download_*.sh`，
aria2c 雙鏡像或 ModelScope）。沒有「輸入 repo id 就下載並上架」的通用機制。

兩個與本設計直接相關的既有事實：
- 閘道的 `config.yaml` 在每次容器啟動時被 compose 的 `install /app/config.yaml /data/config.yaml`
  覆蓋（`docker-compose.production.yml`），所以任何在執行期寫回 `config.yaml` 的改動（包含現有的
  `/api/models/{id}/toggle`）重啟後都會消失。
- portal 的 `server/settings.py` 強制 `PC_GATEWAY_ORIGIN` 為 HTTPS origin；GPU 節點在機房，經 tunnel
  由閘道存取，portal 與節點之間沒有網路路徑。

使用者的判斷：「太多個後台了」。本設計的核心是收斂成一個。

## 2. 已定決策（2026-10-08 使用者確認）

1. **portal 長成總後台。** 它是唯一有帳號、角色、session 的面；所有新功能加在它的 `/admin`。
2. **閘道只留 API。** `app.py` 內嵌的 HTML 管理頁分期退場（§5.5）；**既有 `/api/*` 契約不變**，
   可新增路由。admin token 只存在 portal 伺服器端。
3. **Go 版封存。** 不在其上蓋後台；其 modelrepo manifest 與 checksum 設計可參考。
4. **powerchampion.org 收進同一個 Vinext 站**，以 Host 分流。Vercel 專案退場。
5. **官網整合程度：共用資料，文案留在程式碼。** 後台管「會變的資料」（模型目錄與價格、租賃報價表、
   聯絡表單收件、公告），頁面文案與版面仍用 git 改。不做完整 CMS。
6. **模型控制台管到底：** 下載→驗證→啟動 vLLM→上架閘道。
7. **閘道分支先收斂：** `glm53-gateway` 合進 `origin/main`，之後所有閘道與節點改動落在合併後的 `main`。

## 3. 分期

| 期 | 子期 | 內容 | 依賴 |
|---|---|---|---|
| 0 前置 | 0 | 閘道分支收斂，Dokploy 改部署 `main` | 無 |
| A 總後台骨架 | A1 | portal 換 Postgres（含遷移、備份、回滾） | 0 |
| | A2 | 接閘道 admin token、代理路由、admin 客戶／金鑰／用量／閘道／personas 頁 | A1 |
| | A3 | 閘道 HTML 管理頁退場切換 | A2 |
| B 模型控制台 | B1 | 節點 agent：通用下載、serve 模板、recipe 推送、離線 stub 測試 | 0 |
| | B2 | 閘道：模型 CRUD 與持久化疊加層、recipe 推送路由 | B1 |
| | B3 | portal：模型表、上架精靈、job 進度 | A2、B2 |
| C 雙官網整合 | C1 | .org 頁面搬進 Vinext、Host 分流、DNS 切換 | 無（可與 A 並行） |
| | C2 | 租賃報價表、收件匣、公告（portal 資料表與 admin 頁） | A1 |

每個子期各自一份實作計畫、獨立可部署、獨立可回滾。B1 不依賴 A，可提早開工。

## 4. 第 0 期：閘道分支收斂

**目標**：生產只有一條線。

**作法**
- 在 `sell-panel` 開 worktree，從 `origin/main` 建 `merge/glm53-into-main`，merge `glm53-gateway`。
- 衝突預期集中在 `app.py`（兩邊都改過 keys 與 docs 路由）、`config.yaml`（GLM-5.3 條目與定價）、
  `docker-compose.production.yml`（tunnel 設定）。實際衝突清單以 merge 當下為準。
- 合併後跑 `python3 -m unittest discover -s tests -q`。
- 合併分支以 PR 進 `origin/main`（push 與 merge 由使用者執行；LESSONS 2026-08-10：subagent 不得 push）。
- 部署前記錄數值錨點：`/catalog.json` 的模型 id 清單與價格、`/status.json` 的 ready 模型、
  `/openrouter/models` 的容量數字；並查 Dokploy 有無 `config.yaml` 的 Patch 覆蓋層（LESSONS 2026-08-05）。
- Dokploy 的 `b300-sell-panel` 改追 `main` 並部署。

**驗收**
- `git log glm53-gateway ^origin/main` 為空。
- 全量測試 0 failed，通過數 ≥ max(合併前 `origin/main` 通過數, 合併前 `glm53-gateway` 通過數)。
- 生產映像內的 `.deploy-sha`（或等價檔）等於合併 commit。
- 部署後錨點與部署前比對：差異只能來自 `origin/main` 比 `glm53-gateway` 多的 4 個 commit，每一筆差異
  要能指到對應 commit；`glm-5.3-flash-uncensored` 仍 ready，`/api/nodes/b300-14/ops/check` 仍通。

**風險**：GLM-5.3 的啟停腳本 `~/glm53_ops.sh` 不在 repo，合併不會動到它。

## 5. 第 A 期：總後台骨架

**目標**：portal 成為唯一登入與唯一 admin 面，能做閘道 `/admin`、`/keys`、`/usage`、`/personas`
今天能做的所有事；`/monitor` 與 `/alloc` 留到第 B 期之後（§5.5）。

### 5.1 架構

維持兩層：Vinext BFF（`app/api/portal/[...path]/route.ts` 的 allowlist）→ 私有 FastAPI
（`server/`）。FastAPI 是唯一授權來源，所有 admin 路由走 `current_user(admin=True)`。
瀏覽器永遠拿不到閘道 admin token。

網路路徑只有兩條：瀏覽器 → BFF → FastAPI 走 Docker 內網；FastAPI → 閘道走 HTTPS 公開 origin
（`PC_GATEWAY_ORIGIN`，維持 `settings.py` 的 HTTPS 限制）並帶 `X-Admin-Token`。
**portal 永遠不直接連節點**，節點相關操作一律經閘道 `/api/nodes/*`。

### 5.2 A1：SQLite → Postgres

- Dokploy 開一個 Postgres 服務（內網，不開 port），`PC_PORTAL_DB` 改為 Postgres DSN。
- `server/store.py` 與 `server/runtime_store.py` 的手寫 SQL 改走 SQLAlchemy Core ＋ Alembic 遷移。
  不引入 ORM 模型層，store 函式的簽章不變。
- 遷移腳本匯入全部現有資料表：`users`、`sessions`、`gateway_keys`、`key_reservations`、`credit_requests`、
  `audit_events`、`login_attempts`、`trial_sessions`、`trial_requests`、`agents`、`agent_versions`、
  `runtime_tasks`、`runtime_references`、`runtime_events`、`runtime_instructions`、`runtime_approvals`、
  `runtime_artifacts`。`sessions` 與 `login_attempts` 可不匯入（切換時全員重新登入），其餘必須匯入。
- 切換步驟：停 portal → 複製 `portal.sqlite3` 為 `portal.sqlite3.pre-pg-<date>`（唯讀備份，保留 90 天）
  → 匯入 → 起 portal 指向 Postgres。回滾 = 改回 SQLite DSN 重啟；**切換後新寫入的資料在回滾時會遺失**，
  此為接受的代價。
- 理由：SQLite 單寫入者，B3 的 job 輪詢與 C2 的表單收件都是多寫入來源。

**驗收**
- 乾淨 Postgres 上 Alembic 從零升到 head，再從既有 SQLite 匯入，兩種情境 `npm run test:backend`
  （unittest）全綠。
- 匯入後每張表的列數等於 SQLite 來源（`sessions`、`login_attempts` 除外），用腳本列出比對。
- 既有客戶用舊密碼能登入、看得到自己的金鑰與 agents。

### 5.3 A2：接閘道 admin token、代理路由、admin 頁

**安全閘門**：生產設定 `PC_GATEWAY_ADMIN_TOKEN`。原本不設的顧慮是「API 發的 key 沒有預付餘額，
變成無花費上限的後付」。規則：
- portal 發 key **必須帶 `prepaid_usd > 0`**（閘道 `POST /api/keys` 已支援），`daily_token_limit`
  只是附加限制，**不得單獨放行**。缺 `prepaid_usd` 或 ≤ 0 回 422。
- **客戶自助發 key 維持關閉**，只有 admin 能發（線上收款接上前不開放；Airwallex 另有 spec）。
- 匿名試用維持關閉。

`server/gateway.py` 擴充代理：`/api/state`、`/api/models/{id}/toggle`、`/api/models/{id}/maintenance`、
`/api/nodes`、`/api/nodes/{name}/ops/{action}`、`/api/nodes/{name}/jobs/{id}`、`/api/keys`（list）、
`/api/keys/{id}/limits`、`/api/keys/{id}/balance`、`/api/usage/report`、`/api/metrics`、
`/api/personas*`、`/api/fleet/*`。每條在 BFF allowlist 加一行，在 FastAPI 加對應 `/admin/*` 路由。

admin 新增頁（`app/admin/[[...section]]`）：

| 頁 | 功能 | 寫入動作 |
|---|---|---|
| 客戶 | 搜尋、停用／啟用、改角色、看其全部金鑰、撤銷金鑰、加值預付餘額 | 全部寫 `audit_events` |
| 金鑰 | 全站金鑰清單、發 key（帶 `prepaid_usd`）、限額、停用 | 同上 |
| 用量 | 全站月報（代理 `/api/usage/report`），依客戶與模型彙總 | 無 |
| 閘道 | 模型啟停、維護訊息、節點 start/stop/restart/check、GPU 指標、fleet 的 freeze/resume/candidate/approve/drain/rollback | 同上 |
| Personas | 代理 `/api/personas*`：清單、建立、revisions、activate、try | 同上 |
| 收件匣 | C2 才啟用 | |
| 模型 | B3 才啟用 | |

角色維持 `customer`／`admin` 兩種。不做細粒度權限。

**驗收**
- 客戶自行註冊 → admin 在「金鑰」頁為該客戶發 key（`prepaid_usd` 5）→ 客戶用該 key 打
  `/v1/chat/completions` 成功 → 「用量」頁看到該筆 → admin 撤銷 → 再打回 401。
- 發 key 不帶 `prepaid_usd` 或帶 0 回 422；客戶在自己的 `/account/keys` 按發放仍回 503
  `provider_not_configured`（自助關閉未被打開）。
- 「閘道」頁對 `glm-5.3-flash-uncensored` 設維護訊息後，客戶請求回 503 且訊息相同；清除後恢復 200。
- 每個寫入動作在「稽核」頁出現一筆，含操作者與目標。

### 5.4 A3：閘道 HTML 管理頁退場

- `app.py` 新增環境變數 `SELL_PANEL_LEGACY_ADMIN_UI`（預設 `1`）。設為 `0` 時 `/admin`、`/keys`、
  `/usage`、`/personas` **不論登入狀態**一律 302，`Location` 為 `https://powerchampion.ai/admin`
  的對應 section；閘道 `/login` 頁保留給 `/monitor`、`/alloc` 使用。
- `/monitor`（GPU 指標）與 `/alloc`（allocctl 看板，`static/alloc.html`）本期**不退場**，待 B3 的模型頁
  吸收 fleet 與指標後再評估。
- 退場前 `grep -rn` `monitoring/`、`scripts/`、`.github/`、`docker-compose*` 對這四個路徑的引用
  （LESSONS 2026-09-10），有消費者先改消費者。
- 保留程式碼一個月再刪。

**驗收**
- `SELL_PANEL_LEGACY_ADMIN_UI=0` 時，以 admin session 與未登入兩種身分 `curl -I /admin`，
  皆 302 且 `Location` 開頭為 `https://powerchampion.ai/admin`（現況未登入是 302 到 `/login`，
  所以必須斷言 Location）。
- 同時 `/api/state` 帶 admin token 仍 200，`/monitor` 仍回 HTML。
- 設回 `1` 後 `/admin` 行為與退場前相同。

## 6. 第 B 期：模型控制台

**目標**：admin 在 portal 輸入 HuggingFace 或 ModelScope 的 repo id，選節點與啟動模板，
系統完成下載、驗證、啟動 vLLM、上架閘道、出現在官網目錄。

### 6.1 原則

- **節點永遠不執行使用者提供的任意指令。** 節點只收結構化參數，指令由節點端模板組出。
- 呼叫鏈固定為 portal → 閘道（HTTPS，admin token）→ tunnel → 節點（`X-Agent-Token`）。
  portal 不持有節點 token。
- 磁碟配額：下載前 `_ensure_download_capacity` 檢查；並發 job 上限 1（沿用 `ACTIVE_CONTROL_JOB_STATES`）。
- 每個已上架模型可 rollback 到前一個 serving 版本（沿用 fleet 的 rollback）。

### 6.2 B1：節點 agent（`node_agent.py`）

- `download` 動作改收結構化參數：`source`（`hf`｜`modelscope`）、`repo_id`、`revision`（預設 `main`）、
  `target_dir`（必須在 `/data/models/` 或 `/data/hf-cache/` 底下，拒絕 `..` 與符號連結逃逸）、
  `include`／`exclude` glob、`expected_bytes`（可選，用於磁碟檢查）。
- 新增 `scripts/download_model.sh`：把 `download_glm52.sh`／`download_minimax.sh`／
  `download_qwen3_*.sh` 的 aria2c 雙鏡像（hf-mirror.com 主、huggingface.co 備）與 `ms download`
  邏輯收成一支通用腳本，參數即上列欄位。限速預設 `--max-overall-download-limit=40M`
  （LESSONS 2026-08-05）。HF token 由節點環境變數 `HF_TOKEN` 提供，請求不帶。
- 下載完成後驗證：`scripts/check_safetensors_complete.py` ＋ `config.json` 存在 ＋ shard 數
  與 `model.safetensors.index.json` 一致。驗證結果寫入 job。
- **新增 `serve` 動作**（加入 `LIFECYCLE_ACTIONS`），收：`template_id`、`model_dir`、`served_name`、
  `port`、`gpus`、`tp`、`max_model_len`、`gpu_memory_utilization`、`max_num_seqs`、`extra`
  （只允許模板白名單內的鍵）。`activate` 之後改以 `serve` 的結果為 serving 目標；既有 recipe 的
  `serve_command` 路徑保留相容。
- 新增 `serve_templates/*.yaml`：每個模板定義 vLLM 參數預設值、允許覆寫的鍵、必要環境變數
  （如 FP8 MoE 要 `CUDA_HOME=/usr/local/cuda`，LESSONS 2026-07-29）。把 `scripts/run_*.sh`
  的調參 know-how 搬進模板預設值與註解，`run_*.sh` 保留但標為 legacy。
- `CONTROL_RECIPES` 改為可由閘道推送：新增 `PUT /control/recipes`（驗 `X-Agent-Token`，與其他
  control 路由相同），節點存於本機 JSON；現有 4 個 recipe 轉成初始資料。
- `verify`、`warm`、`activate`、`drain`、`rollback`、`quarantine` 介面不改。

**驗收（離線 stub 測試，不需 GPU）**
- `extra` 帶模板白名單外的鍵回 400；`target_dir` 為 `/etc/x` 或含 `..` 回 400。
- 模板渲染出的指令字串不含請求方提供的任何原始字串（repo_id 與 served_name 經 shell 安全引號）。
- `PUT /control/recipes` 缺 token 回 401；推送後 `/control/status` 列出新 recipe。
- 現有 4 個 recipe 經轉換後，`/control/status` 輸出與轉換前相同。

### 6.3 B2：閘道（`app.py`）

- **模型註冊的持久來源是疊加層 `/data/models.d/<model_id>.yaml`**（在 `/data` volume，不受
  compose 的 `install` 覆蓋）。閘道載入順序：`config.yaml` 的 `models[]` → 疊加 `models.d/*.yaml`
  （同 id 以疊加層為準）。所有執行期寫入（新增、更新、toggle、maintenance）**一律寫疊加層**，
  不再寫回 `config.yaml`；寫入前後 `yaml.safe_load` 驗證，寫入為原子替換。
- 新增 `POST /api/models`（建立）、`PUT /api/models/{id}`（更新定價、描述、modalities 等）、
  `DELETE /api/models/{id}`：只允許 `enabled: false` 且 `usage.jsonl` 最近 24 小時無該 model id 的紀錄。
- 新增 `PUT /api/nodes/{name}/recipes`：把 portal 的 serve profile 轉成節點 recipe 推送（閘道持有節點 token）。
- `/api/fleet/{model_id}/candidate`→`approve` 沿用，模型需 `control_managed: true`。

**驗收**
- 以 `POST /api/models` 建一個模型，`docker restart` 閘道容器後 `/api/state` 仍列出它
  （這是本期存在的理由：現況 toggle 的改動重啟即消失）。
- 對疊加層模型 toggle 後重啟仍保持；對 `config.yaml` 原生模型 toggle 後重啟仍保持（因為也寫疊加層）。
- `DELETE` 對 `enabled: true` 的模型回 409；對 24 小時內有用量的回 409。
- 閘道全量測試 0 failed，通過數 ≥ 第 0 期基準。

### 6.4 B3：portal

資料表（Postgres）：
- `models`：id、display_name、source、repo_id、revision、node、target_dir、status
  （`registered`→`downloading`→`verified`→`serving`→`listed`→`retired`，另有 `failed`）、
  gateway_model_id、created_by、timestamps。
- `model_jobs`：id、model_id、kind（download／verify／serve／activate／rollback）、gateway_job_ref
  （節點名＋node job id）、status、progress_pct、bytes_done、log_tail、started_at、finished_at、error。
- `serve_profiles`：id、model_id、template_id、params JSON、version、is_active。

背景工作：FastAPI lifespan 內的單一 asyncio task，每 10 秒對進行中的 job 經閘道
`GET /api/nodes/{name}/jobs/{id}` 輪詢；portal 只跑一個 replica，以 Postgres advisory lock 防止
誤起多實例時重複輪詢。前端用 SSE 推進度與 log 尾端。

admin「模型」頁：
- 清單：狀態、節點、GPU 佔用、對外價格、最近 job。
- 新增精靈四步：(1) 來源與 repo id，呼叫 HF／ModelScope 公開 API 預覽檔案大小與 license；
  (2) 節點與 GPU，顯示該節點 `/inventory`（經閘道 `/api/nodes`）的剩餘磁碟與閒置 GPU；
  (3) 啟動模板與參數；(4) 定價、描述、是否 `openrouter_expose`、是否立即 `enabled`。
- 每個 job 可取消（下載中）或 rollback（啟動後）。

**驗收**
- 從空節點開始，在 portal 新增一個小模型（例如 Qwen3-0.6B）走完四步，`/catalog.json` 出現該模型，
  客戶用 key 打 `/v1/chat/completions` 指定該模型成功，powerchampion.ai 模型卡片列出它。
- 故意給錯 repo id：job 進 `failed`，錯誤訊息含上游 HTTP 狀態，節點無殘留目錄。
- 磁碟不足：下載前被拒，`model_jobs` 不建立紀錄。
- 殺掉 portal 再起：進行中的 job 自動恢復輪詢，狀態不倒退。

### 6.5 非目標

- 不做模型倉（registry server）。節點間分發沿用 `scripts/pull_model_from_seed.sh`，`docs/model-relay.md`
  的判準不變。
- 不做量化、轉檔。只部署 repo 裡現成的權重。
- 不做非 vLLM 後端（TTS、ASR、diffusers）的通用啟動；它們維持現有 `run_*.sh`。

## 7. 第 C 期：雙官網整合

**目標**：powerchampion.org 與 powerchampion.ai 由同一個 Vinext 站服務，共用品牌、導航、法律頁、
登入；後台管「會變的資料」。

### 7.1 C1：Host 分流與搬遷

- 生產跑 `vinext start`（Dockerfile），不是 Cloudflare Worker，所以 Host 分流寫在 **`middleware.ts`**
  （它已經在設 `x-pc-*` 標頭）；`worker/index.ts` 做同樣的事以保持 Cloudflare 預覽一致。
- middleware 依 `Host` 設 `x-pc-site: org|ai`，並把 `.org` 的請求**內部 rewrite** 到 `/org/<path>`
  （瀏覽器網址不變），避免與 `.ai` 既有的 `/`、`/pricing`、`/contact` 同路徑衝突。
- `.org` 六頁（`/`、`/architecture`、`/services`、`/about`、`/pricing`、`/contact`）從
  `powerchampion-website/src/pages/*.jsx` 改寫成 TypeScript 元件放 `app/org/`。舊路徑全保留，不需轉址。
- 兩站共用 `components/` 的品牌、頁尾、`/privacy`、`/terms`、`/trust` 與 `/login`；
  `/data-retention` 維持在閘道，兩站頁尾連過去。
- `docker-compose.dokploy.yml` 的 Traefik 標籤加第二個 Host；`.org` DNS 指到 Dokploy。
  **DNS 切換後 Vercel 專案保留 30 天**再停用，repo 封存（README 標明已遷移）。

**驗收**
- 在實際 `vinext start` 下：`curl -H 'Host: powerchampion.org' /` 回應含 `x-pc-site: org` 且 body
  含 .org 專屬字串（例如 "HGX"）；`Host: powerchampion.ai` 回 `x-pc-site: ai` 且 body 不含該字串。
  六個 .org 路徑都要過這條（因為 `/`、`/pricing`、`/contact` 在 .ai 本來就 200，只看狀態碼是空驗證）。
- 兩個 Host 的 `/privacy` body 相同。
- DNS 切換後 `dig powerchampion.org` 解析到 Dokploy IP；`curl -I https://powerchampion.org/` 回應
  **不含** `server: Vercel` 與 `x-vercel-id`。
- Lighthouse 可及性不低於舊站。

### 7.2 C2：共用資料（portal 新資料表與 admin 頁）

| 資料 | 來源 | 兩站怎麼用 |
|---|---|---|
| 模型目錄與價格 | 閘道 `/catalog.json`（B 期上架即更新） | `.ai` 模型卡片（已有）；`.org` 服務頁列「可用推論模型」 |
| 租賃報價表 | 新表 `rental_quotes`（GPU 型號、期別、月費區間、幣別、生效日） | `.org` 定價頁；admin 可改 |
| 聯絡表單 | 新表 `contact_messages`（site、subject、name、email、body、ip_hash、status） | 兩站表單 POST `/api/portal/contact`；admin「收件匣」可標已處理、可回覆（mailto） |
| 公告 | 新表 `announcements`（site、title、body、starts_at、ends_at） | 兩站頂部橫幅 |

公開端點 `/contact` 的防濫用：每 IP 每小時 5 筆（FastAPI 端）、honeypot 欄位、body 上限 4000 字、
BFF allowlist 只放 POST、沿用現有 origin check。EmailJS 與其環境變數移除；收件後若有 SMTP 設定則通知，
沒有就只進收件匣。

**驗收**
- 在 .org 送出聯絡表單，admin 收件匣立即看到，`ip_hash` 不是明文 IP；第 6 筆同 IP 回 429；
  honeypot 有值回 200 但不入庫。
- admin 改租賃報價表後，.org 定價頁下一次請求反映新值。
- `package.json` 無 `@emailjs/browser`，環境變數清單無 `VITE_EMAILJS_*`。

### 7.3 待使用者確認

- 聯絡信箱統一為 `@powerchampion.ai`（.org 信箱轉寄）還是維持 `info@powerchampion.org`。
  這是文案決定，不影響架構。
- `.org` 舊版 README 的 Serverless／FlashBoot／SOC 2 宣稱是否保留；盤點時判斷是模板文案。

## 8. 跨切面

- **測試**：portal 的 `npm run test:backend`（unittest）與 Vitest 全綠為每子期門檻；閘道全量測試
  0 failed 且通過數不低於第 0 期合併後的基準；節點 agent 新增離線 stub 測試。
- **安全**：admin token 永不下瀏覽器；portal 不持有節點 token；節點只收 allowlist 動作與白名單參數；
  所有 admin 寫入進 `audit_events`；瀏覽器 → BFF → FastAPI 走 Docker 內網，FastAPI → 閘道走 HTTPS。
- **部署**：每子期各自一次 Dokploy 部署；部署前記錄數值錨點，部署後比對；查 Patch 覆蓋層。
  生產動作一律先問使用者（全域硬規則 6）。
- **回滾**：第 0 期靠 Dokploy 回前一個 image（§4）；A1 靠 SQLite 備份切回（§5.2）；A3 靠
  `SELL_PANEL_LEGACY_ADMIN_UI=1`（§5.4）；B 靠 fleet rollback 與刪除疊加層檔案（§6.3）；
  C1 靠 DNS 切回 Vercel（30 天保留期內，§7.1）。
- **文件**：每子期結束更新 `docs/portal-operations.md`、`server/README.md`、
  `sell-panel/docs/prod-ops-runbook.md`；A3 完成時把 `docs/平台管理後台操作手冊_2026-07-10.md` 標為 legacy。

## 9. 不做的事

- 不做完整 CMS、不做多租戶／組織、不做細粒度權限、不做線上收款（Airwallex 另有 spec）。
- 不在 Go 版上做任何功能；不遷移到 Go。
- 不重構 `app.py` 的非 admin 部分。

## 10. 盤點來源

2026-10-08 三個 Explore agent 報告（sell-panel 閘道與節點、marketplace portal、
powerchampion-website）。行號與路由清單以報告當下的 `.wt-glm53`、marketplace `main`（0ff456c）、
powerchampion-website `main`（673c4ca）為準。

## 11. 審查紀錄

- 2026-10-08：一個 fresh-context sonnet agent 做 read-back（路徑存在性實際 ls／grep、空驗證判斷、
  歧義與範圍）。回報 9 條（4 高），全部修正：模型 CRUD 改寫疊加層而非 `config.yaml`；
  三條空驗證改為生效後才成立的斷言；網路路徑統一為 portal→閘道→節點；發 key 閘門改為必帶
  `prepaid_usd`；A、B、C 各拆成子期；補 Postgres 遷移表清單與回滾資料策略；補收件匣防濫用；
  `/data-retention`、`serve` 為新動作、`middleware.ts`、unittest 等事實修正。
