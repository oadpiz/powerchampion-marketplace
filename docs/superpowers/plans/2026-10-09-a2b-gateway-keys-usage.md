# A2b：閘道 admin token、金鑰／用量／閘道管理頁 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** portal 伺服器端持有閘道 admin token，管理員能在後台看全站金鑰與月用量、替客戶簽發**帶預付餘額**的金鑰、停用／啟用、調限額、加值，並能看閘道狀態、啟停模型、設維護訊息、對節點下 start/stop/restart/check 指令。客戶自助發 key 維持關閉。

**Architecture:** 三層不變：瀏覽器 → BFF 白名單 → FastAPI → 閘道（HTTPS，`X-Admin-Token`）。`server/gateway.py` 從 3 個方法擴成完整 adapter，錯誤模型保留閘道的 4xx 狀態（`GatewayError(code, status, detail)`），5xx／網路錯誤仍是 `unavailable`。所有管理動作是 FastAPI `/admin/*` 路由（`current_user(admin=True)`、審計）。金鑰歸屬以 `gateway_keys.gateway_key_id` 對閘道的 `key_id`；閘道上不屬於任何客戶的 key（env key、reviewer key、手動發的）以「未歸屬」顯示，唯讀。`/api/state` 代理時在伺服器端剔除 `gateway.api_key`。前端三個新 section 各自獨立檔案，避免 `admin-portal.tsx` 再長。

**Tech Stack:** 同 A2a。閘道契約以 sell-panel `origin/main` 的 `app.py`（2026-10-09 盤點）為準。

## Global Constraints

- 對應 spec §5.3（A2b 列）與 §5.1。A2a 已完成（殼層、帳號管理、密碼）。本計畫不做：Personas、fleet 工作流、`/api/control`、兌換碼——這些記為 **A2c**（Task 8 寫進 spec）。
- 基準：marketplace `main` = 196dd89；後端 200 個測試（SQLite 與 Postgres 各一次）；vitest 427。每個 Task 後數量不減、0 failed。
- 閘道契約（固定，寫進 adapter 測試）：
  - `POST /api/keys` body `label, daily_token_limit, rpm, max_inflight, prepaid_usd`（float，>=0；省略＝後付）；回 `key, key_id, label, balance_nano_usd, warning`。
  - `GET /api/keys` 回 `keys[]`（`key_id, prefix, label, daily_token_limit, rpm, max_inflight, prepaid_nano_usd, created_at, created_by, expires_at, disabled_at, last_used_at, model_ids[]`）與 `env_keys[]`（同形，`unmanaged: true`）。
  - `POST /api/keys/{id}/disable` `{disabled: bool}` → `{ok}`；404 不存在。`POST /api/keys/{id}/limits` `{daily_token_limit?, rpm?, max_inflight?}`（0..2^53-1 int）→ `{ok}`。`POST /api/keys/{id}/balance` `{add_usd}` 或 `{set_usd}` → `{ok, key_id, balance_nano_usd}`。
  - `GET /api/usage/report?month=YYYY-MM` → `keys[{key_id, label, requests, prompt_tokens, completion_tokens, cost_usd(字串，6 位小數), by_model[], by_day[]}], total_cost_usd, total_requests, unpriced_models[], amount_status, since, until, month`。
  - `GET /api/state` → `models[], nodes, gateway{public_base_url, api_key, …}`（**`api_key` 必須在伺服器端剔除**）。`POST /api/models/{id}/toggle` → `{id, enabled}`；`POST /api/models/{id}/maintenance` `{message}`（<=300，空＝清除）→ `{id, maintenance_message, maintenance_since}`。
  - `GET /api/nodes` → `nodes[{name, enabled, role, models[], reachable, state}], actions[]`；`POST /api/nodes/{name}/ops/{action}`（action ∈ start, stop, restart, check, backup, fw-status）→ agent 回應含 `job_id`；`GET /api/nodes/{name}/jobs/{job_id}`。
  - `GET /api/metrics` → `ts, gpu_source_up, vllm_source_up, gpus[], serving{}`。
  - view 等級路由接受 `X-Admin-Token`（`has_view_access` 明確接受）。
- 單位：閘道餘額是 nano-USD 整數（1 USD = 1e9）；用量 `cost_usd` 是字串。portal 對外一律用 USD 的 `Decimal` 轉字串或 `number`（API 回 `balanceUsd: string`，前端顯示兩位小數）。
- **金鑰政策**：管理員代發必須 `prepaidUsd > 0`（否則 422 `invalid_input`）；客戶自助 `POST /keys` 受 `settings.customer_key_issuance`（env `PC_CUSTOMER_KEY_ISSUANCE`，預設 `0`）控制，關閉時即使 token 已設定也回 503 `provider_not_configured`；開啟時客戶建的 key 以 `prepaid_usd = 0` 建立（餘額為 0，加值前 402）。
- 審計動作名固定：`admin.key_issued`、`admin.key_disabled`、`admin.key_enabled`、`admin.key_limits`、`admin.key_balance`、`admin.model_toggled`、`admin.model_maintenance`、`admin.node_op`、`key.revocation_needs_reconciliation`。
- 錯誤碼固定：`provider_not_configured`（503）、`gateway_unavailable`（503）、`gateway_rejected`（閘道 4xx 轉 400/404/409，帶 `detail`）、`key_not_found`（404）、`invalid_input`（400/422）、`unknown_action`（400）。
- `GatewayError` 永遠不把 admin token 帶進訊息；adapter 測試斷言回傳與例外文字都不含 token。
- 前端新 section 各自一檔：`components/admin-keys-section.tsx`、`admin-usage-section.tsx`、`admin-gateway-section.tsx`；`admin-portal.tsx` 只加型別、導覽與分派。BFF、`app/admin/[[...section]]/page.tsx` 的 section 白名單、`AdminSection`、`AdminShell` NAV 四處同步。
- Git：worktree `.worktrees/a2b-gateway`，分支 `a2b/gateway` 從 `main` 開；venv `.venv-portal`；agent 不 push／merge／碰 Dokploy／動生產；每個 git 指令一行；不用 `git stash`；不用 bare `git checkout <path>`；永遠不要 add `tsconfig.tsbuildinfo`。Commit 結尾 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`。
- 部署前置（Task 9）：確認閘道的 Dokploy app 有設 `SELL_PANEL_VIEW_TOKEN`（否則 `/api/control*` 等 view 路由無認證），取得閘道的 `SELL_PANEL_ADMIN_TOKEN` 值由**使用者**填進 marketplace 的 Dokploy env `PC_GATEWAY_ADMIN_TOKEN`；agent 不經手 token。

---

### Task 1: Settings、GatewayError 錯誤模型、adapter 全部方法

**Files:**
- Modify: `server/settings.py`（加 `customer_key_issuance: bool = False`，`from_env` 讀 `PC_CUSTOMER_KEY_ISSUANCE == "1"`）
- Modify: `server/gateway.py`（整檔改寫，介面如下）
- Modify: `server/test_portal.py:608-675`（`GatewayAdapterTests` 擴充）
- Modify: `server/test_settings.py`（加 1 測試）

**Interfaces:**
- `class GatewayError(Exception)`：屬性 `code: str`（`unconfigured`｜`unavailable`｜`rejected`｜`invalid_response`｜`response_limit`｜`invalid_identifier`｜`invalid_month`）、`status: int | None`（`rejected` 時為閘道狀態碼）、`detail: str`（閘道 JSON 的 `detail`／`error` 或空字串，長度 ≤ 300，不含 token）。`str(error) == code`。
- `GatewayAdapter(settings)`：
  - `create_key(label, prepaid_usd, limits=None) -> {"key_id", "prefix", "secret", "balance_nano_usd"}`；`prepaid_usd` 為 `Decimal|float|int >= 0`，一律送出；`limits` 是 `{"daily_token_limit","rpm","max_inflight"}` 的子集，省略者用 settings 預設。
  - `set_key_disabled(key_id, disabled: bool) -> None`；`revoke_key(key_id)` 保留為 `set_key_disabled(key_id, True)` 的別名。
  - `update_limits(key_id, limits: dict) -> None`（至少一個欄位，值為 0..2^53-1 int）。
  - `adjust_balance(key_id, *, add_usd=None, set_usd=None) -> int`（回 `balance_nano_usd`；恰好一個參數）。
  - `list_keys() -> {"keys": [...], "env_keys": [...]}`。
  - `usage_report(month) -> dict`（不變）。
  - `state() -> dict`：回閘道 `/api/state`，但 **`gateway` 子物件移除 `api_key`**，且遞迴移除任何鍵名含 `key`/`token`/`secret` 且值為字串的欄位（防禦）。
  - `nodes() -> dict`、`node_op(name, action) -> dict`（`action` 不在 `{"start","stop","restart","check","backup","fw-status"}` → `GatewayError("invalid_identifier")`；`name` 須符合 `[A-Za-z0-9._-]{1,64}`）、`node_job(name, job_id) -> dict`（`job_id` 符合 `[A-Za-z0-9._-]{1,128}`）。
  - `metrics() -> dict`、`toggle_model(model_id) -> dict`、`set_maintenance(model_id, message) -> dict`（`model_id` 符合 `[A-Za-z0-9._:/-]{1,128}`，`message` ≤ 300）。
- `_request(method, path, payload=None)`：2xx → dict；4xx → `GatewayError("rejected", status, detail)`；其他 → `unavailable`。

- [ ] **Step 1: worktree、venv、基準**

```bash
cd /Users/optyne/repository/b300/sell-panel/powerchampion-marketplace
git status --short | grep -v '^??' | head
git worktree add -b a2b/gateway .worktrees/a2b-gateway main
cd .worktrees/a2b-gateway
python3 -m venv .venv-portal
.venv-portal/bin/pip install -q -r server/requirements.txt
.venv-portal/bin/python -m unittest discover -s server -t . -p 'test_*.py' 2>&1 | tail -3
npm ci --silent 2>&1 | tail -1
npx vitest run 2>&1 | tail -4
```
Expected: `Ran 200 tests`、`OK`；vitest 427。

- [ ] **Step 2: 失敗的測試**

在 `server/test_settings.py` 的 `DatabaseUrlTests` 後加：

```python
class KeyIssuanceSettingTests(unittest.TestCase):
    def test_customer_key_issuance_defaults_off_and_reads_env(self):
        self.assertFalse(Settings().customer_key_issuance)
        with patch.dict(os.environ, {"PC_CUSTOMER_KEY_ISSUANCE": "1"}, clear=False):
            self.assertTrue(Settings.from_env().customer_key_issuance)
```

在 `server/test_portal.py` 的 `GatewayAdapterTests` 加（沿用該類的 `self.transport(...)` helper 與 `self.requests`）：

```python
    async def test_create_key_sends_prepaid_and_returns_balance(self):
        with self.transport(lambda _: httpx.Response(200, json={"key": "sk-local-test-customer-secret", "key_id": "key-123", "label": "x", "balance_nano_usd": 5000000000})):
            result = await self.gateway.create_key("x", prepaid_usd=5)
        payload = json.loads(self.requests[0].content)
        self.assertEqual(payload["prepaid_usd"], 5)
        self.assertEqual(result["balance_nano_usd"], 5000000000)

    async def test_rejected_responses_keep_status_and_detail_without_token(self):
        with self.transport(lambda _: httpx.Response(404, json={"error": "not_found", "detail": "Key not found"})):
            with self.assertRaises(GatewayError) as caught:
                await self.gateway.set_key_disabled("key-404", True)
        self.assertEqual(caught.exception.code, "rejected")
        self.assertEqual(caught.exception.status, 404)
        self.assertEqual(caught.exception.detail, "Key not found")
        self.assertNotIn("adapter-test-admin-token", repr(caught.exception))

    async def test_server_errors_are_unavailable(self):
        with self.transport(lambda _: httpx.Response(502, text="bad gateway")):
            with self.assertRaises(GatewayError) as caught:
                await self.gateway.list_keys()
        self.assertEqual(caught.exception.code, "unavailable")

    async def test_state_strips_secrets(self):
        with self.transport(lambda _: httpx.Response(200, json={"models": [], "gateway": {"public_base_url": "https://x", "api_key": "sk-env-secret", "nested": {"admin_token": "t"}}})):
            value = await self.gateway.state()
        self.assertNotIn("api_key", value["gateway"])
        self.assertNotIn("admin_token", value["gateway"]["nested"])
        self.assertEqual(value["gateway"]["public_base_url"], "https://x")
        self.assertNotIn("sk-env-secret", json.dumps(value))

    async def test_node_op_validates_action_and_name(self):
        with self.assertRaises(GatewayError):
            await self.gateway.node_op("b300-14", "rm-rf")
        with self.assertRaises(GatewayError):
            await self.gateway.node_op("../x", "check")
        with self.transport(lambda _: httpx.Response(200, json={"job_id": "j1"})):
            value = await self.gateway.node_op("b300-14", "check")
        self.assertEqual(self.requests[0].url.path, "/api/nodes/b300-14/ops/check")
        self.assertEqual(value["job_id"], "j1")

    async def test_balance_and_limits_contracts(self):
        with self.transport(lambda _: httpx.Response(200, json={"ok": True, "key_id": "k", "balance_nano_usd": 7000000000})):
            balance = await self.gateway.adjust_balance("k", add_usd=7)
        self.assertEqual(balance, 7000000000)
        self.assertEqual(json.loads(self.requests[0].content), {"add_usd": 7})
        with self.assertRaises(ValueError):
            await self.gateway.adjust_balance("k", add_usd=1, set_usd=2)
        with self.transport(lambda _: httpx.Response(200, json={"ok": True})):
            await self.gateway.update_limits("k", {"rpm": 10})
        self.assertEqual(json.loads(self.requests[-1].content), {"rpm": 10})
        with self.assertRaises(ValueError):
            await self.gateway.update_limits("k", {})
```

```bash
cd /Users/optyne/repository/b300/sell-panel/powerchampion-marketplace/.worktrees/a2b-gateway
.venv-portal/bin/python -m unittest server.test_settings server.test_portal.GatewayAdapterTests 2>&1 | tail -5
```
Expected: 新測試失敗（AttributeError／TypeError）。

- [ ] **Step 3: 實作 `server/gateway.py`**

```python
"""Adapter to the verified Python gateway routes; admin scope is server-only.

Error model: 2xx -> dict; gateway 4xx -> GatewayError("rejected", status, detail);
anything else (5xx, network, bad JSON) -> GatewayError("unavailable"). The admin
token never appears in exceptions or return values.
"""
import json
import re
from decimal import Decimal

import httpx

KEY_ID = re.compile(r"[A-Za-z0-9_-]{1,128}")
NODE_NAME = re.compile(r"[A-Za-z0-9._-]{1,64}")
JOB_ID = re.compile(r"[A-Za-z0-9._-]{1,128}")
MODEL_ID = re.compile(r"[A-Za-z0-9._:/-]{1,128}")
NODE_ACTIONS = frozenset({"start", "stop", "restart", "check", "backup", "fw-status"})
LIMIT_FIELDS = ("daily_token_limit", "rpm", "max_inflight")
MAX_SAFE = 2 ** 53 - 1
SECRET_KEY_HINTS = ("key", "token", "secret", "password")


class GatewayError(Exception):
    def __init__(self, code, status=None, detail=""):
        super().__init__(code)
        self.code = code
        self.status = status
        self.detail = (detail or "")[:300]


def _strip_secrets(value):
    if isinstance(value, dict):
        return {k: _strip_secrets(v) for k, v in value.items()
                if not (isinstance(v, str) and any(h in k.lower() for h in SECRET_KEY_HINTS))}
    if isinstance(value, list):
        return [_strip_secrets(v) for v in value]
    return value


class GatewayAdapter:
    def __init__(self, settings):
        self.settings = settings
        self.configured = bool(settings.gateway_admin_token)

    async def _request(self, method, path, payload=None):
        if not self.configured:
            raise GatewayError("unconfigured")
        try:
            async with httpx.AsyncClient(timeout=15, follow_redirects=False, trust_env=False) as client:
                async with client.stream(method, self.settings.gateway_origin.rstrip("/") + path, json=payload,
                                         headers={"X-Admin-Token": self.settings.gateway_admin_token, "Accept": "application/json"}) as response:
                    data = bytearray()
                    async for chunk in response.aiter_bytes():
                        if len(data) + len(chunk) > 4 * 1024 * 1024:
                            raise GatewayError("response_limit")
                        data.extend(chunk)
                    if 400 <= response.status_code < 500:
                        detail = ""
                        try:
                            body = json.loads(data)
                            if isinstance(body, dict):
                                detail = str(body.get("detail") or body.get("error") or "")
                        except ValueError:
                            pass
                        raise GatewayError("rejected", response.status_code, detail)
                    if not response.is_success:
                        raise GatewayError("unavailable")
                    value = json.loads(data)
                    if not isinstance(value, dict):
                        raise GatewayError("invalid_response")
                    return value
        except GatewayError:
            raise
        except (httpx.HTTPError, ValueError, TypeError):
            raise GatewayError("unavailable") from None

    @staticmethod
    def _key_id(key_id):
        if not isinstance(key_id, str) or not KEY_ID.fullmatch(key_id):
            raise GatewayError("invalid_identifier")
        return key_id

    async def create_key(self, label, prepaid_usd, limits=None):
        amount = Decimal(str(prepaid_usd))
        if amount < 0:
            raise ValueError("prepaid_usd must be >= 0")
        payload = {"label": label, "prepaid_usd": float(amount),
                   "daily_token_limit": self.settings.gateway_daily_token_limit,
                   "rpm": self.settings.gateway_rpm, "max_inflight": self.settings.gateway_max_inflight}
        for name, value in (limits or {}).items():
            if name not in LIMIT_FIELDS or not isinstance(value, int) or isinstance(value, bool) or not 0 <= value <= MAX_SAFE:
                raise ValueError("invalid limit " + str(name))
            payload[name] = value
        value = await self._request("POST", "/api/keys", payload)
        secret, key_id = value.get("key"), value.get("key_id")
        if not isinstance(secret, str) or not re.fullmatch(r"[\x21-\x7e]{8,512}", secret) or not isinstance(key_id, str) or not KEY_ID.fullmatch(key_id):
            raise GatewayError("invalid_response")
        balance = value.get("balance_nano_usd")
        return {"key_id": key_id, "prefix": secret[:16], "secret": secret,
                "balance_nano_usd": balance if isinstance(balance, int) and not isinstance(balance, bool) else None}

    async def set_key_disabled(self, key_id, disabled):
        value = await self._request("POST", "/api/keys/" + self._key_id(key_id) + "/disable", {"disabled": bool(disabled)})
        if value.get("ok") is not True:
            raise GatewayError("invalid_response")

    async def revoke_key(self, key_id):
        await self.set_key_disabled(key_id, True)

    async def update_limits(self, key_id, limits):
        payload = {}
        for name, value in (limits or {}).items():
            if name not in LIMIT_FIELDS or not isinstance(value, int) or isinstance(value, bool) or not 0 <= value <= MAX_SAFE:
                raise ValueError("invalid limit " + str(name))
            payload[name] = value
        if not payload:
            raise ValueError("no limits given")
        value = await self._request("POST", "/api/keys/" + self._key_id(key_id) + "/limits", payload)
        if value.get("ok") is not True:
            raise GatewayError("invalid_response")

    async def adjust_balance(self, key_id, *, add_usd=None, set_usd=None):
        if (add_usd is None) == (set_usd is None):
            raise ValueError("give exactly one of add_usd or set_usd")
        amount = Decimal(str(add_usd if add_usd is not None else set_usd))
        if amount < 0:
            raise ValueError("amount must be >= 0")
        payload = {"add_usd": float(amount)} if add_usd is not None else {"set_usd": float(amount)}
        value = await self._request("POST", "/api/keys/" + self._key_id(key_id) + "/balance", payload)
        balance = value.get("balance_nano_usd")
        if value.get("ok") is not True or not isinstance(balance, int) or isinstance(balance, bool):
            raise GatewayError("invalid_response")
        return balance

    async def list_keys(self):
        value = await self._request("GET", "/api/keys")
        keys, env_keys = value.get("keys"), value.get("env_keys", [])
        if not isinstance(keys, list) or not isinstance(env_keys, list):
            raise GatewayError("invalid_response")
        return {"keys": [k for k in keys if isinstance(k, dict)], "env_keys": [k for k in env_keys if isinstance(k, dict)]}

    async def usage_report(self, month):
        if not re.fullmatch(r"\d{4}-\d{2}", month):
            raise GatewayError("invalid_month")
        return await self._request("GET", "/api/usage/report?month=" + month)

    async def state(self):
        return _strip_secrets(await self._request("GET", "/api/state"))

    async def nodes(self):
        return await self._request("GET", "/api/nodes")

    async def node_op(self, name, action):
        if not isinstance(name, str) or not NODE_NAME.fullmatch(name) or action not in NODE_ACTIONS:
            raise GatewayError("invalid_identifier")
        return await self._request("POST", "/api/nodes/" + name + "/ops/" + action)

    async def node_job(self, name, job_id):
        if not isinstance(name, str) or not NODE_NAME.fullmatch(name) or not isinstance(job_id, str) or not JOB_ID.fullmatch(job_id):
            raise GatewayError("invalid_identifier")
        return await self._request("GET", "/api/nodes/" + name + "/jobs/" + job_id)

    async def metrics(self):
        return await self._request("GET", "/api/metrics")

    async def toggle_model(self, model_id):
        if not isinstance(model_id, str) or not MODEL_ID.fullmatch(model_id):
            raise GatewayError("invalid_identifier")
        return await self._request("POST", "/api/models/" + model_id + "/toggle")

    async def set_maintenance(self, model_id, message):
        if not isinstance(model_id, str) or not MODEL_ID.fullmatch(model_id):
            raise GatewayError("invalid_identifier")
        if not isinstance(message, str) or len(message) > 300:
            raise ValueError("message too long")
        return await self._request("POST", "/api/models/" + model_id + "/maintenance", {"message": message})
```

`server/settings.py`：加欄位 `customer_key_issuance: bool = False`，`from_env` 加 `customer_key_issuance=os.environ.get("PC_CUSTOMER_KEY_ISSUANCE", "0") == "1"`。

既有的 `create_key("Application")` 呼叫（`app.py` 的客戶 `/keys` 與既有測試）在 Task 2 改；Task 1 先讓既有 adapter 測試 `test_create_key_translates_gateway_response_and_sets_explicit_limits` 改為 `create_key("Application", prepaid_usd=0)` 並多斷言 `payload["prepaid_usd"] == 0`。

- [ ] **Step 4: 測試通過**

```bash
cd /Users/optyne/repository/b300/sell-panel/powerchampion-marketplace/.worktrees/a2b-gateway
.venv-portal/bin/python -m unittest server.test_settings server.test_portal.GatewayAdapterTests -v 2>&1 | tail -12
.venv-portal/bin/python -m unittest discover -s server -t . -p 'test_*.py' 2>&1 | tail -3
```
Expected: adapter 測試全綠；全量會因 `app.py` 還用舊簽章 `create_key(label)` 而在 `/keys` 相關測試失敗——**這是預期的，Task 2 修**。若 Task 1 想獨立綠，可在 `app.py:279` 暫改為 `create_key(label, prepaid_usd=0)`，並在 Task 2 正式處理；二選一，報告寫明。

- [ ] **Step 5: commit**

```bash
cd /Users/optyne/repository/b300/sell-panel/powerchampion-marketplace/.worktrees/a2b-gateway
git add server/gateway.py server/settings.py server/test_settings.py server/test_portal.py server/app.py
git commit -m "portal: full gateway adapter with status-preserving errors, prepaid key issuance and ops endpoints

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: 金鑰政策：客戶自助受設定控制、管理員代發帶預付、停用客戶時撤銷金鑰

**Files:**
- Modify: `server/app.py`：`require_gateway()`（客戶路徑加 `settings.customer_key_issuance`）、客戶 `POST /keys`（`create_key(label, prepaid_usd=0)`）、新增 `POST /admin/customers/{user_id}/keys`、`admin_set_status` 的 disable 分支撤銷金鑰
- Modify: `server/store.py`（`key_json` 加 `gatewayKeyId`）
- Modify: `server/test_portal.py`（`FakeGateway` 擴充：`create_key(label, prepaid_usd, limits=None)` 記錄 prepaid；`set_key_disabled`、`update_limits`、`adjust_balance`、`list_keys`、`state`、`nodes`、`node_op`、`node_job`、`metrics`、`toggle_model`、`set_maintenance` 的可設定回傳；既有 `test_…unconfigured` 等測試改為「未開啟自助發放」）
- Modify: `server/test_accounts.py`（`AdminAccountTests` 加代發與撤銷測試）

**Interfaces:**
- `POST /admin/customers/{user_id}/keys` body `{label (<=80), prepaidUsd (number > 0, <= 100000, 最多 2 位小數), dailyTokenLimit?, rpm?, maxInflight?}` → 201 `{key: key_json, secret, balanceUsd}`；審計 `admin.key_issued`（actor admin，target 本地 key id）。失敗補償與客戶路徑相同。
- 客戶 `POST /keys`：`customer_key_issuance` 為 False → 503 `provider_not_configured`（即使 gateway 已 configured）；True 時 `create_key(label, prepaid_usd=0)`。
- `admin_set_status` disable：對該使用者所有 `status='active'` 的 `gateway_keys` 呼叫 `gateway.set_key_disabled(gid, True)`；成功者 UPDATE 為 `revoked`＋審計 `key.revoked`（actor admin）；失敗者保留 active 並審計 `key.revocation_needs_reconciliation`（target gateway_key_id）；帳號仍停用；回傳多 `keysRevoked: n, keysFailed: n`。gateway 未設定時 `keysFailed` = 全部 active 數。

- [ ] **Step 1: 失敗的測試**

`server/test_accounts.py` 的 `AdminAccountTests` 加（現況：`test_accounts.py:16` 有一個只含 `configured = False` 的 stub `FakeGateway`，`test_portal.py:31` 有完整版；把完整版搬到 `server/testsupport.py` 並擴充，刪掉 stub，兩個測試檔都從那裡 import。`_PortalCase.setUp` 改為 `self.gateway = FakeGateway(); self.app = create_app(self.settings, gateway=self.gateway)`。`AdminAccountTests.admin(self, email="admin@example.test")` 已存在（`test_accounts.py:71`），新類別可把它搬到 `_PortalCase` 共用，Task 3–5 的測試類就不必各自重定義）：

```python
    def test_admin_issues_prepaid_key_for_customer(self):
        admin = self.admin()
        user = self.register(self.client(), "a@example.test")
        r = self.post(admin, f"/admin/customers/{user['id']}/keys", {"label": "Prod", "prepaidUsd": 25})
        self.assertEqual(r.status_code, 201, r.text)
        body = r.json()
        self.assertEqual(body["key"]["label"], "Prod")
        self.assertTrue(body["secret"].startswith("sk-test-secret"))
        self.assertEqual(body["balanceUsd"], "25.00")
        self.assertEqual(self.gateway.issued[-1]["prepaid_usd"], 25)
        self.assertEqual(rows(self.store, "gateway_keys")[0]["user_id"], user["id"])
        self.assertIn("admin.key_issued", [e["action"] for e in rows(self.store, "audit_events")])
        for bad in ({"label": "x"}, {"label": "x", "prepaidUsd": 0}, {"label": "x", "prepaidUsd": -1}, {"label": "x", "prepaidUsd": "ten"}):
            self.assertEqual(self.post(admin, f"/admin/customers/{user['id']}/keys", bad).status_code, 422, bad)

    def test_customer_self_service_stays_closed_unless_enabled(self):
        client = self.client()
        self.register(client, "a@example.test")
        r = self.post(client, "/keys", {"label": "mine"})
        self.assertEqual(r.status_code, 503)
        self.assertEqual(r.json()["error"], "provider_not_configured")
        self.assertEqual(self.gateway.issued, [])

    def test_disabling_customer_revokes_their_keys(self):
        admin = self.admin()
        user = self.register(self.client(), "a@example.test")
        self.assertEqual(self.post(admin, f"/admin/customers/{user['id']}/keys", {"label": "A", "prepaidUsd": 5}).status_code, 201)
        self.assertEqual(self.post(admin, f"/admin/customers/{user['id']}/keys", {"label": "B", "prepaidUsd": 5}).status_code, 201)
        r = self.post(admin, f"/admin/customers/{user['id']}/status", {"action": "disable"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["keysRevoked"], 2)
        self.assertEqual(sorted(self.gateway.disabled), sorted(k["key_id"] for k in self.gateway.issued))
        self.assertEqual({k["status"] for k in rows(self.store, "gateway_keys")}, {"revoked"})

    def test_disable_still_succeeds_when_gateway_is_down(self):
        admin = self.admin()
        user = self.register(self.client(), "a@example.test")
        self.assertEqual(self.post(admin, f"/admin/customers/{user['id']}/keys", {"label": "A", "prepaidUsd": 5}).status_code, 201)
        self.gateway.fail = True
        r = self.post(admin, f"/admin/customers/{user['id']}/status", {"action": "disable"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["keysFailed"], 1)
        self.assertEqual(r.json()["customer"]["status"], "disabled")
        self.assertIn("key.revocation_needs_reconciliation", [e["action"] for e in rows(self.store, "audit_events")])
```

`server/testsupport.py` 的 `FakeGateway`（從 test_portal 搬來後擴充）：

```python
class FakeGateway:
    configured = True

    def __init__(self):
        self.issued, self.disabled, self.enabled, self.limits, self.balances = [], [], [], [], []
        self.report = {"keys": [], "total_cost_usd": "0.000000", "total_requests": 0, "unpriced_models": [], "amount_status": "confirmed"}
        self.listing = {"keys": [], "env_keys": []}
        self.state_value = {"models": [], "nodes": [], "gateway": {"public_base_url": "https://gateway.example"}}
        self.nodes_value = {"nodes": [], "actions": ["start", "stop", "restart", "check"]}
        self.metrics_value = {"ts": 0, "gpu_source_up": False, "vllm_source_up": False, "gpus": [], "serving": {}}
        self.ops, self.toggled, self.maintenance = [], [], []
        self.months = []
        self.fail = False
        self.create_delay = 0
        self.issue_lock = threading.Lock()

    def _maybe_fail(self):
        if self.fail:
            raise GatewayError("unavailable")

    async def create_key(self, label, prepaid_usd, limits=None):
        if self.create_delay:
            await asyncio.sleep(self.create_delay)
        self._maybe_fail()
        with self.issue_lock:
            number = len(self.issued) + 1
            result = {"key_id": "gateway-key-%d" % number, "prefix": "sk-test-%d" % number,
                      "secret": "sk-test-secret-unique-%d" % number, "balance_nano_usd": int(round(float(prepaid_usd) * 1e9))}
            self.issued.append({"label": label, "prepaid_usd": prepaid_usd, "limits": limits or {}, **result})
        return result

    async def set_key_disabled(self, key_id, disabled):
        self._maybe_fail()
        (self.disabled if disabled else self.enabled).append(key_id)

    async def revoke_key(self, key_id):
        await self.set_key_disabled(key_id, True)

    async def update_limits(self, key_id, limits):
        self._maybe_fail()
        self.limits.append((key_id, dict(limits)))

    async def adjust_balance(self, key_id, *, add_usd=None, set_usd=None):
        self._maybe_fail()
        self.balances.append((key_id, add_usd, set_usd))
        return int(round(float(set_usd if set_usd is not None else add_usd) * 1e9))

    async def list_keys(self):
        self._maybe_fail()
        return self.listing

    async def usage_report(self, month):
        self._maybe_fail()
        self.months.append(month)
        return self.report

    async def state(self):
        self._maybe_fail(); return self.state_value

    async def nodes(self):
        self._maybe_fail(); return self.nodes_value

    async def node_op(self, name, action):
        self._maybe_fail(); self.ops.append((name, action)); return {"job_id": "job-%d" % len(self.ops)}

    async def node_job(self, name, job_id):
        self._maybe_fail(); return {"job_id": job_id, "state": "done"}

    async def metrics(self):
        self._maybe_fail(); return self.metrics_value

    async def toggle_model(self, model_id):
        self._maybe_fail(); self.toggled.append(model_id); return {"id": model_id, "enabled": True}

    async def set_maintenance(self, model_id, message):
        self._maybe_fail(); self.maintenance.append((model_id, message)); return {"id": model_id, "maintenance_message": message or None}
```

（`import asyncio, threading` 與 `from server.gateway import GatewayError` 放在 testsupport 頂部。`test_portal.py` 既有測試改成 `from server.testsupport import FakeGateway`；它用到的 `self.gateway.revoked` 改讀 `self.gateway.disabled`。`_PortalCase.setUp` 改為 `self.gateway = FakeGateway(); self.app = create_app(self.settings, gateway=self.gateway)`。）

- [ ] **Step 2: 實作**

`server/app.py`：
- `require_gateway(customer=False)`：`if not gateway.configured or (customer and not settings.customer_key_issuance): fail("provider_not_configured", ..., 503)`；客戶 `POST /keys` 呼叫 `require_gateway(customer=True)`，`create_key("portal:" + ..., prepaid_usd=0)`。
- 把客戶路徑的「建 key → 寫 gateway_keys → 補償」抽成 `async def provision_key(owner_id, label, prepaid_usd, limits, actor_id, audit_action)`，回 `(row, created)`；客戶與管理員兩條路由共用（客戶 audit `key.created` actor=本人；管理員 `admin.key_issued` actor=admin）。`key_reservations` 仍以 owner 計。
- 新路由：

```python
    @application.post(PREFIX + "/admin/customers/{user_id}/keys")
    async def admin_issue_key(user_id: str, request: Request):
        admin = current_user(request, admin=True)
        body = await body_json(request)
        label = text_value(body.get("label"), "key label", 80)
        try:
            prepaid = Decimal(str(body.get("prepaidUsd")))
            if not prepaid.is_finite() or prepaid <= 0 or prepaid > 100000 or prepaid != prepaid.quantize(Decimal("0.01")):
                raise ValueError
        except (InvalidOperation, ValueError, TypeError):
            fail("invalid_input", "Enter a prepaid amount above 0 USD with at most two decimals.", 422)
        limits = {}
        for field, name in (("dailyTokenLimit", "daily_token_limit"), ("rpm", "rpm"), ("maxInflight", "max_inflight")):
            if field in body and body[field] is not None:
                value = body[field]
                if not isinstance(value, int) or isinstance(value, bool) or not 0 <= value <= 2 ** 53 - 1:
                    fail("invalid_input", "Limits must be non-negative integers.", 422)
                limits[name] = value
        with store.connect() as con:
            target = con.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        if not target:
            fail("customer_not_found", "Account not found.", 404)
        if target["disabled_at"]:
            fail("invalid_input", "This account is disabled.", 409)
        require_gateway()
        row, created = await provision_key(user_id, label, prepaid, limits, admin["id"], "admin.key_issued")
        balance = created.get("balance_nano_usd")
        balance_usd = f"{Decimal(balance) / Decimal(10**9):.2f}" if isinstance(balance, int) else f"{prepaid:.2f}"
        return JSONResponse({"key": key_json(row), "secret": created["secret"], "balanceUsd": balance_usd}, status_code=201)
```

- `admin_set_status` 的 disable 分支（在 `BEGIN IMMEDIATE` 交易**之外**先做閘道呼叫，再進交易更新）：

```python
        revoked, failed = 0, 0
        if action == "disable":
            with store.connect() as con:
                active = con.execute("SELECT id, gateway_key_id FROM gateway_keys WHERE user_id=? AND status='active'", (user_id,)).fetchall()
            for key in active:
                try:
                    if not gateway.configured:
                        raise GatewayError("unconfigured")
                    await gateway.set_key_disabled(key["gateway_key_id"], True)
                except GatewayError:
                    failed += 1
                    with store.connect() as con:
                        store.audit(con, "key.revocation_needs_reconciliation", admin["id"], key["gateway_key_id"])
                    continue
                with store.connect() as con:
                    con.execute("UPDATE gateway_keys SET status='revoked',revoked_at=? WHERE id=? AND status='active'", (int(time.time()), key["id"]))
                    store.audit(con, "key.revoked", admin["id"], key["id"])
                revoked += 1
```
回傳 `{"customer": user_json(row), "keysRevoked": revoked, "keysFailed": failed}`（enable 時兩者為 0）。注意 `admin_target` 仍在交易內做自我檢查；撤銷迴圈放在交易前，順序：驗 body → 先用一次交易做 `admin_target` 檢查（不改資料）→ 撤銷迴圈 → 再開交易做停用。寫法以可讀為準，測試會驗行為。

`server/store.py` `key_json` 加 `"gatewayKeyId": row["gateway_key_id"]`。

- [ ] **Step 3: 測試通過（兩種後端）**

```bash
cd /Users/optyne/repository/b300/sell-panel/powerchampion-marketplace/.worktrees/a2b-gateway
.venv-portal/bin/python -m unittest server.test_accounts server.test_portal -v 2>&1 | tail -8
.venv-portal/bin/python -m unittest discover -s server -t . -p 'test_*.py' 2>&1 | tail -3
scripts/test_backend_postgres.sh 2>&1 | tail -3
```
Expected: 全綠；數量 = Task 1 後 + 4。

- [ ] **Step 4: commit**

```bash
cd /Users/optyne/repository/b300/sell-panel/powerchampion-marketplace/.worktrees/a2b-gateway
git add server/app.py server/store.py server/testsupport.py server/test_portal.py server/test_accounts.py
git commit -m "portal: admin issues prepaid keys; customer issuance gated by PC_CUSTOMER_KEY_ISSUANCE; disabling revokes gateway keys

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: 管理員金鑰路由（清單、停用／啟用、限額、加值）

**Files:**
- Modify: `server/app.py`（四條新路由）
- Modify: `server/test_accounts.py`（新增 `AdminKeysTests(_PortalCase)`）

**Interfaces:**
- `GET /admin/keys` → `{"keys": [...], "envKeys": [...], "gatewayConfigured": bool}`。每筆：`gatewayKeyId, prefix, label, dailyTokenLimit, rpm, maxInflight, balanceUsd (string|null，null＝後付), createdAt, expiresAt, disabledAt, lastUsedAt, modelIds[], owner: {id, email, name} | null, portalKeyId: string|null, portalStatus: "active"|"revoked"|null`。歸屬以 `gateway_keys.gateway_key_id = key_id` 對應。gateway 未設定 → 200 `{"keys": [], "envKeys": [], "gatewayConfigured": false}`。
- `POST /admin/keys/{gateway_key_id}/disable` `{disabled: bool}` → `{ok: true}`；若有對應 `gateway_keys` 列，同步 `status`（disabled→revoked、enabled→active）；審計 `admin.key_disabled`／`admin.key_enabled`（target gateway_key_id）。
- `POST /admin/keys/{gateway_key_id}/limits` `{dailyTokenLimit?, rpm?, maxInflight?}` → `{ok: true}`；審計 `admin.key_limits`。
- `POST /admin/keys/{gateway_key_id}/balance` `{addUsd}` 或 `{setUsd}`（> 0 加值、>= 0 設定、2 位小數、<= 100000）→ `{ok: true, balanceUsd}`；審計 `admin.key_balance`。
- 閘道 4xx → `fail("gateway_rejected", detail or "The gateway rejected the request.", status if status in (400, 404, 409) else 400)`；5xx → 503 `gateway_unavailable`。
- `gateway_key_id` 路徑參數須符合 `[A-Za-z0-9_-]{1,128}`，否則 404 `key_not_found`。

- [ ] **Step 1: 失敗的測試**

```python
class AdminKeysTests(_PortalCase):
    def admin(self):
        self.store.create_user("admin@example.test", "Admin", PASSWORD, role="admin")
        client = self.client()
        self.assertEqual(self.post(client, "/auth/login", {"email": "admin@example.test", "password": PASSWORD}).status_code, 200)
        return client

    def test_list_merges_ownership(self):
        admin = self.admin()
        user = self.register(self.client(), "a@example.test")
        issued = self.post(admin, f"/admin/customers/{user['id']}/keys", {"label": "A", "prepaidUsd": 5}).json()
        self.gateway.listing = {"keys": [
            {"key_id": issued["key"]["gatewayKeyId"], "prefix": "sk-test-1", "label": "portal:x:A", "daily_token_limit": 1000000, "rpm": 60, "max_inflight": 2, "prepaid_nano_usd": 5000000000, "created_at": 1700000000, "expires_at": None, "disabled_at": None, "last_used_at": None, "model_ids": []},
            {"key_id": "manual-key", "prefix": "sk-man", "label": "ops", "daily_token_limit": 0, "rpm": 0, "max_inflight": 0, "prepaid_nano_usd": None, "created_at": 1700000000, "expires_at": None, "disabled_at": None, "last_used_at": None, "model_ids": []},
        ], "env_keys": [{"key_id": "env-1", "prefix": "sk-env", "label": "environment", "unmanaged": True}]}
        body = admin.get(BASE + "/admin/keys").json()
        by_id = {k["gatewayKeyId"]: k for k in body["keys"]}
        self.assertEqual(by_id[issued["key"]["gatewayKeyId"]]["owner"]["email"], "a@example.test")
        self.assertEqual(by_id[issued["key"]["gatewayKeyId"]]["balanceUsd"], "5.00")
        self.assertIsNone(by_id["manual-key"]["owner"])
        self.assertIsNone(by_id["manual-key"]["balanceUsd"])
        self.assertEqual(body["envKeys"][0]["gatewayKeyId"], "env-1")
        self.assertNotIn("sk-test-secret", json.dumps(body))

    def test_disable_enable_limits_balance(self):
        admin = self.admin()
        user = self.register(self.client(), "a@example.test")
        issued = self.post(admin, f"/admin/customers/{user['id']}/keys", {"label": "A", "prepaidUsd": 5}).json()
        gid = issued["key"]["gatewayKeyId"]
        self.assertEqual(self.post(admin, f"/admin/keys/{gid}/disable", {"disabled": True}).status_code, 200)
        self.assertEqual(rows(self.store, "gateway_keys")[0]["status"], "revoked")
        self.assertEqual(self.post(admin, f"/admin/keys/{gid}/disable", {"disabled": False}).status_code, 200)
        self.assertEqual(rows(self.store, "gateway_keys")[0]["status"], "active")
        self.assertEqual(self.post(admin, f"/admin/keys/{gid}/limits", {"rpm": 10}).status_code, 200)
        self.assertEqual(self.gateway.limits[-1], (gid, {"rpm": 10}))
        self.assertEqual(self.post(admin, f"/admin/keys/{gid}/limits", {"rpm": -1}).status_code, 422)
        r = self.post(admin, f"/admin/keys/{gid}/balance", {"addUsd": 2.5})
        self.assertEqual(r.json()["balanceUsd"], "2.50")
        self.assertEqual(self.post(admin, f"/admin/keys/{gid}/balance", {"addUsd": 1, "setUsd": 2}).status_code, 422)
        actions = [e["action"] for e in rows(self.store, "audit_events")]
        for name in ("admin.key_disabled", "admin.key_enabled", "admin.key_limits", "admin.key_balance"):
            self.assertIn(name, actions)

    def test_gateway_rejections_surface_status(self):
        admin = self.admin()
        self.gateway.reject = GatewayError("rejected", 404, "Key not found")
        r = self.post(admin, "/admin/keys/nope/disable", {"disabled": True})
        self.assertEqual(r.status_code, 404)
        self.assertEqual(r.json()["error"], "gateway_rejected")
        self.assertEqual(self.post(admin, "/admin/keys/bad id/disable", {"disabled": True}).status_code, 404)

    def test_customer_forbidden(self):
        client = self.client()
        self.register(client, "a@example.test")
        self.assertEqual(client.get(BASE + "/admin/keys").status_code, 403)
        self.assertEqual(self.post(client, "/admin/keys/x/balance", {"addUsd": 1}).status_code, 403)
```

（`FakeGateway` 加屬性 `self.reject = None`，`_maybe_fail` 若 `self.reject` 非 None 就 raise 它。）

- [ ] **Step 2: 實作**

共用 helper：

```python
    def gateway_fail(error):
        if error.code == "rejected":
            status = error.status if error.status in (400, 404, 409) else 400
            fail("gateway_rejected", error.detail or "The gateway rejected the request.", status)
        if error.code == "unconfigured":
            fail("provider_not_configured", "The gateway is not connected.", 503)
        fail("gateway_unavailable", "The API gateway is unavailable.", 503)

    def usd_from_nano(value):
        return None if not isinstance(value, int) or isinstance(value, bool) else f"{Decimal(value) / Decimal(10**9):.2f}"

    def gateway_key_json(item, owner_row=None):
        return {"gatewayKeyId": item.get("key_id"), "prefix": item.get("prefix"), "label": item.get("label"),
                "dailyTokenLimit": item.get("daily_token_limit"), "rpm": item.get("rpm"), "maxInflight": item.get("max_inflight"),
                "balanceUsd": usd_from_nano(item.get("prepaid_nano_usd")), "createdAt": iso(item.get("created_at")),
                "expiresAt": iso(item.get("expires_at")), "disabledAt": iso(item.get("disabled_at")), "lastUsedAt": iso(item.get("last_used_at")),
                "modelIds": [m for m in item.get("model_ids", []) if isinstance(m, str)],
                "owner": {"id": owner_row["user_id"], "email": owner_row["email"], "name": owner_row["name"]} if owner_row else None,
                "portalKeyId": owner_row["id"] if owner_row else None, "portalStatus": owner_row["status"] if owner_row else None}
```

路由（擇要）：`GET /admin/keys` 先 `list_keys()`，再一次 SQL `SELECT k.id, k.user_id, k.gateway_key_id, k.status, u.email, u.name FROM gateway_keys k JOIN users u ON u.id=k.user_id` 建 dict 對應；`envKeys` 用 `gateway_key_json(item)`。寫入路由：驗 id 格式（否則 404 `key_not_found`）→ 驗 body（422）→ 呼叫 adapter（`GatewayError` → `gateway_fail`）→ 交易內同步 `gateway_keys.status`（若存在）＋審計。`balance` 的金額驗證與 Task 2 的 prepaid 相同（`addUsd > 0`、`setUsd >= 0`）。`iso()` 已在 `store.py`，對 `None` 回 `None`，但閘道的 `created_at` 可能是 float，`iso` 接受 int/float。

- [ ] **Step 3: 測試通過（兩種後端）＋ commit**

```bash
cd /Users/optyne/repository/b300/sell-panel/powerchampion-marketplace/.worktrees/a2b-gateway
.venv-portal/bin/python -m unittest server.test_accounts -v 2>&1 | tail -8
.venv-portal/bin/python -m unittest discover -s server -t . -p 'test_*.py' 2>&1 | tail -3
scripts/test_backend_postgres.sh 2>&1 | tail -3
git add server/app.py server/testsupport.py server/test_accounts.py
git commit -m "portal: admin key directory with ownership, disable/enable, limits and top-up

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: 全站用量 `GET /admin/usage?month=`

**Files:**
- Modify: `server/app.py`
- Modify: `server/test_accounts.py`（`AdminUsageTests`）

**Interfaces:**
- `GET /admin/usage?month=YYYY-MM`（預設當月 UTC；格式與年份檢查同客戶 `/usage`）→
  `{"month", "source": "gateway"|"unconfigured", "totals": {"requests": int, "costUsd": string}, "amountStatus", "unpricedModels": [], "keys": [{gatewayKeyId, label, owner: {...}|null, requests, inputTokens, outputTokens, costUsd: string, byModel: [{model, requests, inputTokens, outputTokens, costUsd}]}], "byCustomer": [{owner|null, requests, costUsd}], "updatedAt"}`。
- `cost_usd` 字串原樣轉傳（不做浮點），`byCustomer` 的加總用 `Decimal`。
- 閘道失敗 → 503 `gateway_unavailable`（不要回零）。

- [ ] **Step 1: 失敗的測試**

```python
class AdminUsageTests(_PortalCase):
    def test_month_report_with_ownership_and_totals(self):
        self.store.create_user("admin@example.test", "Admin", PASSWORD, role="admin")
        admin = self.client()
        self.assertEqual(self.post(admin, "/auth/login", {"email": "admin@example.test", "password": PASSWORD}).status_code, 200)
        user = self.register(self.client(), "a@example.test")
        issued = self.post(admin, f"/admin/customers/{user['id']}/keys", {"label": "A", "prepaidUsd": 5}).json()
        gid = issued["key"]["gatewayKeyId"]
        self.gateway.report = {"month": "2026-10", "keys": [
            {"key_id": gid, "label": "portal:x:A", "requests": 3, "prompt_tokens": 10, "completion_tokens": 20, "cost_usd": "0.123456", "by_model": [{"model": "m", "requests": 3, "prompt_tokens": 10, "completion_tokens": 20, "cost_usd": "0.123456"}], "by_day": []},
            {"key_id": "manual-key", "label": "ops", "requests": 1, "prompt_tokens": 1, "completion_tokens": 1, "cost_usd": "0.000001", "by_model": [], "by_day": []},
        ], "total_cost_usd": "0.123457", "total_requests": 4, "unpriced_models": [], "amount_status": "confirmed", "since": 0, "until": 0}
        body = admin.get(BASE + "/admin/usage?month=2026-10").json()
        self.assertEqual(body["totals"], {"requests": 4, "costUsd": "0.123457"})
        owned = next(k for k in body["keys"] if k["gatewayKeyId"] == gid)
        self.assertEqual(owned["owner"]["email"], "a@example.test")
        self.assertEqual(owned["costUsd"], "0.123456")
        self.assertEqual([c for c in body["byCustomer"] if c["owner"] and c["owner"]["email"] == "a@example.test"][0]["requests"], 3)
        self.assertEqual(self.gateway.months[-1], "2026-10")
        self.assertEqual(admin.get(BASE + "/admin/usage?month=2026-13").status_code, 400)
        self.gateway.fail = True
        self.assertEqual(admin.get(BASE + "/admin/usage?month=2026-10").status_code, 503)
```

- [ ] **Step 2: 實作**（沿用客戶 `/usage` 的 month 驗證與整數檢查；owner 對應同 Task 3；`byCustomer` 以 owner id 聚合、`None` 一組）。

- [ ] **Step 3: 測試通過（兩種後端）＋ commit**（訊息 `portal: site-wide monthly usage report for administrators`）。

---

### Task 5: 閘道狀態與操作 `GET /admin/gateway`、模型啟停／維護、節點 ops、job 查詢

**Files:**
- Modify: `server/app.py`
- Modify: `server/test_accounts.py`（`AdminGatewayTests`）

**Interfaces:**
- `GET /admin/gateway` → `{"gatewayConfigured": bool, "state": dict|null, "nodes": dict|null, "metrics": dict|null, "errors": {"state": code|null, "nodes": code|null, "metrics": code|null}}`：三個閘道呼叫各自獨立（`asyncio.gather(..., return_exceptions=True)`），任何一個失敗不影響其他；`state` 已由 adapter 去除秘密。未設定 → 全部 null，`errors.*="unconfigured"`。
- `POST /admin/gateway/models/{model_id}/toggle` → 閘道回傳原樣（`{id, enabled}`）；審計 `admin.model_toggled`（target model_id）。
- `POST /admin/gateway/models/{model_id}/maintenance` `{message}`（≤300；空＝清除）→ 原樣；審計 `admin.model_maintenance`。
- `POST /admin/gateway/nodes/{name}/ops/{action}` → 原樣（含 `job_id`）；action 不在白名單 → 400 `unknown_action`；審計 `admin.node_op`（target `name:action`）。
- `GET /admin/gateway/nodes/{name}/jobs/{job_id}` → 原樣。
- 錯誤轉換同 `gateway_fail`。

- [ ] **Step 1: 失敗的測試**

```python
class AdminGatewayTests(_PortalCase):
    def admin(self):
        self.store.create_user("admin@example.test", "Admin", PASSWORD, role="admin")
        client = self.client()
        self.assertEqual(self.post(client, "/auth/login", {"email": "admin@example.test", "password": PASSWORD}).status_code, 200)
        return client

    def test_overview_isolates_failures(self):
        admin = self.admin()
        body = admin.get(BASE + "/admin/gateway").json()
        self.assertTrue(body["gatewayConfigured"])
        self.assertEqual(body["state"]["gateway"]["public_base_url"], "https://gateway.example")
        self.assertEqual(body["errors"], {"state": None, "nodes": None, "metrics": None})
        self.gateway.fail = True
        body = admin.get(BASE + "/admin/gateway").json()
        self.assertIsNone(body["state"])
        self.assertEqual(body["errors"]["state"], "unavailable")

    def test_model_and_node_actions_are_audited(self):
        admin = self.admin()
        self.assertEqual(self.post(admin, "/admin/gateway/models/glm-5.3/toggle", {}).json()["enabled"], True)
        self.assertEqual(self.post(admin, "/admin/gateway/models/glm-5.3/maintenance", {"message": "down for 10 min"}).status_code, 200)
        self.assertEqual(self.post(admin, "/admin/gateway/models/glm-5.3/maintenance", {"message": "x" * 301}).status_code, 422)
        r = self.post(admin, "/admin/gateway/nodes/b300-14/ops/check", {})
        self.assertEqual(r.json()["job_id"], "job-1")
        self.assertEqual(self.post(admin, "/admin/gateway/nodes/b300-14/ops/format", {}).status_code, 400)
        self.assertEqual(admin.get(BASE + "/admin/gateway/nodes/b300-14/jobs/job-1").json()["state"], "done")
        actions = [e["action"] for e in rows(self.store, "audit_events")]
        for name in ("admin.model_toggled", "admin.model_maintenance", "admin.node_op"):
            self.assertIn(name, actions)
        self.assertEqual(self.gateway.ops, [("b300-14", "check")])

    def test_customer_forbidden(self):
        client = self.client()
        self.register(client, "a@example.test")
        self.assertEqual(client.get(BASE + "/admin/gateway").status_code, 403)
        self.assertEqual(self.post(client, "/admin/gateway/nodes/b300-14/ops/stop", {}).status_code, 403)
```

- [ ] **Step 2: 實作**（路徑參數先用 adapter 的 regex 驗證；`GatewayError("invalid_identifier")` → 400 `invalid_input`；`unknown_action` 對 action 不在 `NODE_ACTIONS` 時由路由先檢查）。

- [ ] **Step 3: 測試通過（兩種後端）＋ commit**（訊息 `portal: gateway overview, model toggle/maintenance and node operations for administrators`）。

---

### Task 6: BFF 白名單、錯誤文案、proxy 測試

**Files:**
- Modify: `app/api/portal/[...path]/route.ts`（GET：`/admin/(keys|usage|gateway)`、`/admin/gateway/nodes/<name>/jobs/<id>`；POST：`/admin/customers/<32hex>/keys`、`/admin/keys/<keyid>/(disable|limits|balance)`、`/admin/gateway/models/<model>/(toggle|maintenance)`、`/admin/gateway/nodes/<name>/ops/(start|stop|restart|check|backup|fw-status)`；`<keyid>` = `[A-Za-z0-9_-]{1,128}`，`<model>` = `[A-Za-z0-9._:%-]{1,160}`（URL 編碼後的 `/` 是 `%2F`，故允許 `%`），`<name>` = `[A-Za-z0-9._-]{1,64}`）
- Modify: `lib/portal-client.ts`（`gateway_rejected` → 顯示 server 給的 `detail`；`unknown_action`）
- Modify: `tests/portal-proxy.test.ts`

- [ ] **Step 1: 測試**：允許清單中每條各一個 200 案例（fetch 被呼叫），拒絕：`/admin/gateway/nodes/x/ops/rm`、`/admin/keys//disable`、`/admin/gateway/models/../toggle`（經 `%2e%2e`）、`DELETE /admin/keys/x`。
- [ ] **Step 2: 實作**；`portalErrorText`：`if (code === "gateway_rejected") return detail ?? (zh ? "閘道拒絕了這個請求。" : "The gateway rejected the request.")`（`PortalError` 已帶 `detail`，確認型別上可讀）。
- [ ] **Step 3: vitest／tsc 通過＋ commit**（`portal: proxy the gateway administration routes`）。

---

### Task 7: 後台頁面：金鑰、用量、閘道

**Files:**
- Create: `components/admin-keys-section.tsx`、`components/admin-usage-section.tsx`、`components/admin-gateway-section.tsx`
- Modify: `components/admin-portal.tsx`（`AdminSection` 加 `"keys"|"usage"|"gateway"`；`navigation` 加三項；分派）、`components/admin-shell.tsx`（NAV 加三項，順序：總覽、客戶、金鑰、用量、閘道、儲值申請、操作紀錄）、`app/admin/[[...section]]/page.tsx`（白名單）
- Modify: `app/portal.css`（如需新 class，前綴 `portal-`）
- Modify: `tests/portal-ui.test.tsx`

**Interfaces／UI 契約：**
- **金鑰**（`AdminKeysSection`）：表格欄位：前綴、標籤、持有人（email 或「未歸屬」）、餘額（`balanceUsd` 或「後付」）、限額（`rpm`／`dailyTokenLimit`／`maxInflight`，0 顯示「不限」）、狀態（啟用／停用，依 `disabledAt`）、最後使用；列動作：停用／啟用、調限額（對話框三欄）、加值（對話框：金額，`addUsd`）。頂部：「為客戶簽發金鑰」按鈕 → 對話框：客戶（下拉，來自 `/admin/customers`，只列 active）、標籤、預付金額（USD，必填 > 0）、可選限額 → 成功後顯示 secret 一次（複製鈕、「我已交付給客戶」關閉）。環境金鑰另列一小表（唯讀）。未設定時顯示 `portal-note`：「閘道尚未連線（PC_GATEWAY_ADMIN_TOKEN 未設定）」。
- **用量**（`AdminUsageSection`）：`<input type="month">`，總計 tile（請求數、費用 USD），`amountStatus !== "confirmed"` 與 `unpricedModels.length > 0` 顯示警示；表一「依客戶」（持有人、請求、費用）、表二「依金鑰」（前綴／標籤、持有人、請求、輸入／輸出 token、費用，展開列出 byModel）。
- **閘道**（`AdminGatewaySection`）：三區塊獨立載入／錯誤：(1) 模型表（`state.models[]`：id、enabled、maintenance_message、node）＋「啟用／停用」與「維護訊息」按鈕（對話框，含清除）；(2) 節點表（`nodes.nodes[]`：name、role、reachable、state、models）＋ 動作按鈕（`nodes.actions` 交集白名單；`stop`／`restart` 需確認對話框）；按下後顯示 job id 並每 5 秒輪詢 `/admin/gateway/nodes/{name}/jobs/{id}` 直到 `state` 為終態（`done`/`error`/`failed`，最多 60 次）；(3) GPU 指標（`metrics.gpus[]` 每卡 util／mem／temp／power 與 `serving` 的 running／waiting）。「重新整理」按鈕。
- 所有對話框沿用 `AccountActionDialog` 的模式（抽一個 `components/admin-dialog.tsx` 共用殼：title、children、confirm/cancel、inFlight、Esc、focus trap——Task 7 可以順手把 A2a 的 `AccountActionDialog` 改用它，但不強制）。
- 測試（vitest，每個 section 至少 2 條）：金鑰：列表渲染持有人與未歸屬；簽發對話框送出 body `{label, prepaidUsd}` 並顯示 secret 一次。用量：總計與未定價警示；月份變更重抓。閘道：三區塊其中一個 503 時其他照常；節點 ops 送出到正確路徑並開始輪詢。

- [ ] **Step 1: 測試先寫（RED）**；**Step 2: 實作**；**Step 3: `npx vitest run`、`npx tsc --noEmit`、`npm run lint`、`npm test`**；**Step 4: 本地 `npm run start` 看 `/admin/keys`、`/admin/usage`、`/admin/gateway` 200 且各含對應 section 標題**；**Step 5: commit**（`admin: keys, usage and gateway sections`）。

---

### Task 8: 文件、spec、compose

**Files:**
- Modify: `docker-compose.dokploy.yml`：portal env 加 `PC_GATEWAY_ADMIN_TOKEN: ${PC_GATEWAY_ADMIN_TOKEN:-}`、`PC_CUSTOMER_KEY_ISSUANCE: ${PC_CUSTOMER_KEY_ISSUANCE:-0}`，並把「Key self-service stays disconnected on purpose」註解改寫為新政策；`tests/deploy-config.test.ts:75-79` 目前斷言 `PC_GATEWAY_ADMIN_TOKEN` **不在** compose 裡（測試名 "leaves gateway key self-service and the anonymous trial disconnected"）——改成斷言 portal 服務有 `PC_GATEWAY_ADMIN_TOKEN: ${PC_GATEWAY_ADMIN_TOKEN:-}` 與 `PC_CUSTOMER_KEY_ISSUANCE: ${PC_CUSTOMER_KEY_ISSUANCE:-0}`（值取自 env、預設空／0，且 compose 不得寫死任何 token），`PC_TRIAL_*` 兩條斷言保留。
- Modify: `docs/portal-operations.md`（「連接閘道」runbook：前置檢查 `SELL_PANEL_VIEW_TOKEN`、取得 `SELL_PANEL_ADMIN_TOKEN`、設 env、部署、驗證 `/admin/keys`；金鑰政策；停用即撤銷；`PC_CUSTOMER_KEY_ISSUANCE`）、`server/README.md`（路由、env、審計名）、`docs/superpowers/specs/2026-10-08-unified-admin-platform-design.md`（§3 加 A2c 列：Personas、fleet、`/api/control`、兌換碼；§5.3 補「客戶自助發放由 `PC_CUSTOMER_KEY_ISSUANCE` 控制」與「停用即撤銷閘道金鑰」）。
- commit（`docs: gateway connection runbook, key policy, spec A2c split`）。

---

### Task 9: 【使用者執行】部署與驗收

- [ ] **Step 1: 前置（Dokploy，使用者）**：閘道 app「B300 Selling Platform」的 Environment 有 `SELL_PANEL_VIEW_TOKEN` 與 `SELL_PANEL_ADMIN_TOKEN`（沒有 VIEW_TOKEN 就先補）；複製 `SELL_PANEL_ADMIN_TOKEN` 的值。
- [ ] **Step 2: 【使用者執行】** marketplace compose Environment 加 `PC_GATEWAY_ADMIN_TOKEN=<該值>`（`PC_CUSTOMER_KEY_ISSUANCE` 不加，預設 0）。**先設 env 再 merge**（Autodeploy 開著）。
- [ ] **Step 3: 【使用者執行】** push、PR、CI 綠後 merge。
- [ ] **Step 4: agent 驗證**：`/admin/keys` 頁面 HTML 含 section 標題；用 db 容器終端查 audit；請使用者登入後台：金鑰頁列出閘道上的 key（含 env key）、用量頁有當月數字、閘道頁模型與節點可見。**不在生產做 stop/restart；只做一次 `check`** 當驗收。
- [ ] **Step 5: 【使用者執行，可選】** 替 Roy 簽發一把預付 1 USD 的測試金鑰，確認 secret 只顯示一次、金鑰頁餘額 1.00。

---

## 自我檢查

- spec §5.3「必帶 `prepaid_usd`」→ Task 2（admin 路徑 422 守門）；「客戶自助維持關閉」→ `PC_CUSTOMER_KEY_ISSUANCE`（Task 1/2/8）。
- spec 代理清單：state／models toggle／maintenance／nodes／ops／jobs／keys list／limits／balance／usage report／metrics → Task 1、3、4、5；personas／fleet → A2c（Task 8 寫 spec）。
- 審計：每個寫入動作都有固定名稱 → Task 2、3、5。
- A2a 留下的「停用不撤銷金鑰」→ Task 2。
- `/api/state` 的明文 key → adapter 剔除＋測試（Task 1）。
- 四處同步（BFF／page 白名單／AdminSection／AdminShell NAV）→ Task 6、7。
