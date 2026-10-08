# A2a：後台殼層、帳號管理、密碼重設 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** powerchampion.ai 的 `/admin` 擁有自己的後台殼層（沒有行銷頁首、沒有客戶工作區側欄），管理員能停用／啟用帳號、改角色、替使用者重設密碼，使用者能自助改密碼。

**Architecture:** 殼層只在前端動：`SiteShell` 對 `/admin*` 直接回傳 children，新的 `app/admin/layout.tsx` 套 `components/admin-shell.tsx`（側欄＋頂列），`AdminPortal` 只剩內容。帳號狀態靠一個新欄位 `users.disabled_at`（Alembic `0002`），`session_user` 與登入同時檢查，停用即刻生效。所有寫入都是 FastAPI 的 `/admin/*` POST 路由（`current_user(admin=True)`、`BEGIN IMMEDIATE`、`store.audit`），BFF 白名單逐條放行。自助改密碼是 `POST /password`，驗舊密碼、換新雜湊、踢掉其他 session、保留當前 session。

**Tech Stack:** Vinext（Next.js 相容 app router）＋ React 19 ＋ TypeScript ＋ Vitest／Testing Library；FastAPI ＋ `server/db.py` adapter（SQLite 測試／Postgres 生產）＋ Alembic；`unittest`。

## Global Constraints

- 對應 spec：`docs/superpowers/specs/2026-10-08-unified-admin-platform-design.md` §5.3（A2）。本計畫是 **A2a**；閘道 admin token、代理路由、金鑰／用量／閘道／Personas 頁是 **A2b**（另一份計畫）。Task 8 會把這個拆分與新增需求（殼層、密碼重設）寫回 spec。
- 使用者決定（2026-10-09）：殼層採「選項 A：獨立後台殼」。不用 route group、不動根 layout 的 `html/body/LocaleProvider`。
- 基準：marketplace `main` = fcc293d。後端 `npm run test:backend` 184 個測試（SQLite）；Postgres 同套測試用 `scripts/test_backend_postgres.sh`（需 Docker Desktop）。前端 `npm run test:unit`（vitest）目前綠；`npm test` 會跑 build ＋ rendered-html。
- 每個 Task 結束：後端 SQLite 0 failed 且數量不減；前端 vitest 0 failed；Task 1、2、3 另外跑 Postgres。
- SQL 必須同時跑 SQLite 與 Postgres：`?` 佔位符、`BEGIN IMMEDIATE`、INTEGER epoch 欄位、不用 BOOLEAN、不用 RETURNING。
- 角色仍只有 `customer`／`admin`；狀態只有 `active`／`disabled`（由 `disabled_at IS NULL` 推得）。
- 審計動作名稱固定：`admin.account_disabled`、`admin.account_enabled`、`admin.role_changed`、`admin.password_reset`、`account.password_changed`。
- 錯誤碼固定：`account_disabled`（403）、`customer_not_found`（404）、`self_target`（409）、`invalid_current_password`（400）、`invalid_input`（400）。（不做「最後一個 admin」守門：操作者本人必須是啟用中的 admin 才能進到這些路由，而本人又被 `self_target` 擋住，所以「目標是最後一個啟用 admin」的情況不可達。）
- 後端測試數：基準 184 → Task 1 後 186 → Task 2 後 192 → Task 3 後 194。
- 密碼規則沿用 `validate_password`：12 到 128 字。
- i18n 沿用 inline `zh ? "中文" : "English"`（admin／account 既有慣例）。
- BFF 只有 GET／POST／DELETE，所有寫入用 POST。新路由同時加 `tests/portal-proxy.test.ts` 的允許／拒絕案例。
- Git：worktree `.worktrees/a2a-admin-shell`，分支 `a2a/admin-shell` 從 `main` 開。**agent 不 push、不 merge、不碰 Dokploy、不動生產**；標 `【使用者執行】` 的步驟停下回報。每個 git 指令單獨一行；不用 `git stash`；不用 bare `git checkout <path>`；**永遠不要 add `tsconfig.tsbuildinfo`**。
- Python 指令用 `.venv-portal/bin/python`（在 worktree 內建 venv：`python3 -m venv .venv-portal && .venv-portal/bin/pip install -q -r server/requirements.txt`）。
- Commit 訊息結尾：`Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`。
- 已知環境事實：Dokploy 網頁終端裡 Python `getpass` 收不到輸入，所以 `manage.py` 的互動式密碼在生產不可用——這也是本計畫把密碼重設做進後台的原因。

---

### Task 1: `users.disabled_at` migration、store 與登入的停用檢查

**Files:**
- Create: `server/migrations/versions/0002_users_disabled_at.py`
- Modify: `server/store.py:19-20`（`user_json`）、`:51-59`（`create_user` 改具名欄位）、`:75-80`（`session_user` 排除停用）
- Modify: `server/app.py:186-206`（登入拒絕停用帳號）
- Modify: `server/test_migrations.py:43,64`（版本與索引數）、`server/test_runtime_store.py:22`（具名欄位）
- Create: `server/test_accounts.py`

**Interfaces:**
- Produces: `users.disabled_at INTEGER NULL`；`user_json(row)` 多 `status`（`"active"`｜`"disabled"`）與 `disabledAt`（ISO 或 `None`）；`store.session_user` 對停用帳號回 `None`；`POST /auth/login` 對停用帳號回 403 `account_disabled`（密碼正確時才回，避免帳號枚舉）。

- [ ] **Step 1: worktree 與 venv**

```bash
cd /Users/optyne/repository/b300/sell-panel/powerchampion-marketplace
git status --short | grep -v '^??' | head
git worktree add -b a2a/admin-shell .worktrees/a2a-admin-shell main
cd .worktrees/a2a-admin-shell
python3 -m venv .venv-portal
.venv-portal/bin/pip install -q -r server/requirements.txt
.venv-portal/bin/python -m unittest discover -s server -t . -p 'test_*.py' 2>&1 | tail -3
npm ci --silent 2>&1 | tail -1
npx vitest run 2>&1 | tail -4
```
Expected: 後端 `Ran 184 tests`、`OK`；vitest 全綠（記下測試數當基準）。

- [ ] **Step 2: 失敗的測試**

`server/test_accounts.py`：

```python
import tempfile
import unittest

from fastapi.testclient import TestClient

from server.app import create_app
from server.settings import Settings
from server.testsupport import fresh_database, rows

ORIGIN = "http://localhost:3010"
BASE = "/api/portal"
PASSWORD = "customer-test-password-123!"


class FakeGateway:
    configured = False


class _PortalCase(unittest.TestCase):
    """Shared fixture; holds no tests so subclasses do not re-run each other's cases."""

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.settings = Settings(db_path=fresh_database(self.directory.name), allowed_origins=(ORIGIN,))
        self.app = create_app(self.settings, gateway=FakeGateway())
        self.store = self.app.state.store
        self.clients = []

    def tearDown(self):
        for client in self.clients:
            client.close()
        self.directory.cleanup()

    def client(self):
        client = TestClient(self.app, base_url=ORIGIN)
        self.clients.append(client)
        return client

    def post(self, client, path, data):
        return client.post(BASE + path, json=data, headers={"Origin": ORIGIN})

    def register(self, client, email):
        response = self.post(client, "/auth/register", {"email": email, "name": "Test", "password": PASSWORD})
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()["user"]


class AccountStatusTests(_PortalCase):
    def test_new_users_are_active(self):
        user = self.register(self.client(), "a@example.test")
        self.assertEqual(user["status"], "active")
        self.assertIsNone(user["disabledAt"])
        self.assertIsNone(rows(self.store, "users")[0]["disabled_at"])

    def test_disabled_user_cannot_log_in_or_keep_a_session(self):
        client = self.client()
        user = self.register(client, "a@example.test")
        self.assertEqual(client.get(BASE + "/session").status_code, 200)
        with self.store.connect() as con:
            con.execute("UPDATE users SET disabled_at=? WHERE id=?", (1700000000, user["id"]))
        self.assertEqual(client.get(BASE + "/session").status_code, 401)
        login = self.post(self.client(), "/auth/login", {"email": "a@example.test", "password": PASSWORD})
        self.assertEqual(login.status_code, 403)
        self.assertEqual(login.json()["error"], "account_disabled")
        wrong = self.post(self.client(), "/auth/login", {"email": "a@example.test", "password": "definitely-wrong-password"})
        self.assertEqual(wrong.status_code, 401, "a wrong password must not reveal the disabled state")


if __name__ == "__main__":
    unittest.main()
```

```bash
cd /Users/optyne/repository/b300/sell-panel/powerchampion-marketplace/.worktrees/a2a-admin-shell
.venv-portal/bin/python -m unittest server.test_accounts 2>&1 | tail -5
```
Expected: 2 個失敗（`status` KeyError、停用後 session 仍 200）。

- [ ] **Step 3: migration**

`server/migrations/versions/0002_users_disabled_at.py`：

```python
"""users.disabled_at: epoch seconds when an administrator disabled the account; NULL = active

Revision ID: 0002_users_disabled_at
Revises: 0001_baseline
Create Date: 2026-10-09
"""
import sqlalchemy as sa
from alembic import op

revision = "0002_users_disabled_at"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("disabled_at", sa.Integer(), nullable=True))


def downgrade():
    op.drop_column("users", "disabled_at")
```

- [ ] **Step 4: store 與登入**

`server/store.py`：
- `user_json`：

```python
def user_json(row):
    disabled_at = row["disabled_at"] if "disabled_at" in row.keys() else None
    return {"id": row["id"], "email": row["email"], "name": row["name"], "role": row["role"],
            "createdAt": iso(row["created_at"]), "status": "disabled" if disabled_at else "active",
            "disabledAt": iso(disabled_at)}
```
- `create_user` 的 INSERT 改成具名欄位：`"INSERT INTO users (id,email,name,password_hash,role,created_at) VALUES (?,?,?,?,?,?)"`。
- `session_user` 的 SQL 加 `AND u.disabled_at IS NULL`：
  `"SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>? AND u.disabled_at IS NULL"`。

`server/app.py` 登入（`:199-206` 附近）：在 `if not row or not valid:` 之後、`store.clear_attempts(scope)` 之前加：

```python
        if row["disabled_at"]:
            fail("account_disabled", "This account has been disabled. Contact support.", 403)
```

`server/test_runtime_store.py:22` 與其他 `INSERT INTO users VALUES (?,?,?,?,?,?)` 的測試（grep `INSERT INTO users VALUES` 於 `server/test_*.py`，`test_migrations.py` 的 legacy 測試**除外**，它刻意用舊 schema）改成 `INSERT INTO users (id,email,name,password_hash,role,created_at) VALUES (?,?,?,?,?,?)`。

`server/test_migrations.py`：`:64` 的 `["0001_baseline"]` 改 `["0002_users_disabled_at"]`；`EXPECTED_TABLES` 不變；索引數 13 不變。

- [ ] **Step 5: 測試通過（兩種後端）**

```bash
cd /Users/optyne/repository/b300/sell-panel/powerchampion-marketplace/.worktrees/a2a-admin-shell
.venv-portal/bin/python -m unittest server.test_accounts server.test_migrations -v 2>&1 | tail -10
.venv-portal/bin/python -m unittest discover -s server -t . -p 'test_*.py' 2>&1 | tail -3
scripts/test_backend_postgres.sh 2>&1 | tail -3
```
Expected: 全綠；SQLite `Ran 186 tests`；Postgres `Ran 186`（skipped=3）。

- [ ] **Step 6: commit**

```bash
cd /Users/optyne/repository/b300/sell-panel/powerchampion-marketplace/.worktrees/a2a-admin-shell
git add server/migrations/versions/0002_users_disabled_at.py server/store.py server/app.py server/test_accounts.py server/test_migrations.py server/test_runtime_store.py
git status --short
git commit -m "portal: users.disabled_at — disabled accounts cannot sign in or keep a session

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
（`git status --short` 若列出其他改過的測試檔，一併 add。）

---

### Task 2: 管理員的帳號管理路由

**Files:**
- Modify: `server/app.py:438-443`（`/admin/customers` 改列全部帳號）、在 `/admin/audit` 之前新增三條 POST 路由
- Modify: `server/test_portal.py:280-288`（`test_customer_cannot_access_any_admin_route` 加新路徑）
- Modify: `server/test_accounts.py`（新增 `AdminAccountTests`）

**Interfaces:**
- Produces:
  - `GET /admin/customers` → `{"customers": [user_json + keyCount]}`，**含 admin**（之前只列 customer）；`overview` 的 `customerCount` 不變。
  - `POST /admin/customers/{user_id}/status` body `{"action": "disable"|"enable"}` → `{"customer": user_json}`。
  - `POST /admin/customers/{user_id}/role` body `{"role": "customer"|"admin"}` → `{"customer": user_json}`。
  - `POST /admin/customers/{user_id}/reset-password` body `{"newPassword": str}` → `{"ok": true}`；刪該使用者全部 sessions 與 login_attempts。
  - 守門：操作自己 → 409 `self_target`；不存在 → 404 `customer_not_found`。全部冪等（已是目標狀態就直接回）。

- [ ] **Step 1: 失敗的測試**

在 `server/test_accounts.py` 加：

```python
class AdminAccountTests(_PortalCase):
    def admin(self, email="admin@example.test"):
        self.store.create_user(email, "Admin", PASSWORD, role="admin")
        client = self.client()
        self.assertEqual(self.post(client, "/auth/login", {"email": email, "password": PASSWORD}).status_code, 200)
        return client

    def test_customer_list_includes_admins_with_role_and_status(self):
        admin = self.admin()
        self.register(self.client(), "a@example.test")
        listing = admin.get(BASE + "/admin/customers").json()["customers"]
        self.assertEqual({(u["email"], u["role"], u["status"]) for u in listing},
                         {("admin@example.test", "admin", "active"), ("a@example.test", "customer", "active")})

    def test_disable_kicks_sessions_and_enable_restores(self):
        admin = self.admin()
        victim = self.client()
        user = self.register(victim, "a@example.test")
        r = self.post(admin, f"/admin/customers/{user['id']}/status", {"action": "disable"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["customer"]["status"], "disabled")
        self.assertEqual(victim.get(BASE + "/session").status_code, 401)
        again = self.post(admin, f"/admin/customers/{user['id']}/status", {"action": "disable"})
        self.assertEqual(again.status_code, 200, "idempotent")
        r = self.post(admin, f"/admin/customers/{user['id']}/status", {"action": "enable"})
        self.assertEqual(r.json()["customer"]["status"], "active")
        self.assertEqual(self.post(self.client(), "/auth/login", {"email": "a@example.test", "password": PASSWORD}).status_code, 200)
        actions = [e["action"] for e in rows(self.store, "audit_events")]
        self.assertIn("admin.account_disabled", actions)
        self.assertIn("admin.account_enabled", actions)

    def test_admin_cannot_target_self(self):
        admin = self.admin()
        me = admin.get(BASE + "/session").json()["user"]
        for path, body in ((f"/admin/customers/{me['id']}/status", {"action": "disable"}),
                           (f"/admin/customers/{me['id']}/role", {"role": "customer"}),
                           (f"/admin/customers/{me['id']}/reset-password", {"newPassword": "x" * 12})):
            response = self.post(admin, path, body)
            self.assertEqual(response.status_code, 409, path)
            self.assertEqual(response.json()["error"], "self_target")
        self.assertEqual(admin.get(BASE + "/session").status_code, 200, "the admin is untouched")

    def test_role_change_and_unknown_user(self):
        admin = self.admin()
        user = self.register(self.client(), "a@example.test")
        r = self.post(admin, f"/admin/customers/{user['id']}/role", {"role": "admin"})
        self.assertEqual(r.json()["customer"]["role"], "admin")
        self.assertEqual(self.post(admin, f"/admin/customers/{user['id']}/role", {"role": "owner"}).status_code, 400)
        self.assertEqual(self.post(admin, "/admin/customers/" + "0" * 32 + "/role", {"role": "admin"}).status_code, 404)
        self.assertIn("admin.role_changed", [e["action"] for e in rows(self.store, "audit_events")])

    def test_admin_password_reset_revokes_sessions(self):
        admin = self.admin()
        victim = self.client()
        user = self.register(victim, "a@example.test")
        r = self.post(admin, f"/admin/customers/{user['id']}/reset-password", {"newPassword": "brand-new-password-987!"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(victim.get(BASE + "/session").status_code, 401)
        self.assertEqual(self.post(self.client(), "/auth/login", {"email": "a@example.test", "password": PASSWORD}).status_code, 401)
        self.assertEqual(self.post(self.client(), "/auth/login", {"email": "a@example.test", "password": "brand-new-password-987!"}).status_code, 200)
        self.assertEqual(self.post(admin, f"/admin/customers/{user['id']}/reset-password", {"newPassword": "short"}).status_code, 400)
        self.assertIn("admin.password_reset", [e["action"] for e in rows(self.store, "audit_events")])

    def test_customer_is_forbidden(self):
        client = self.client()
        user = self.register(client, "a@example.test")
        for path, body in ((f"/admin/customers/{user['id']}/status", {"action": "disable"}),
                           (f"/admin/customers/{user['id']}/role", {"role": "admin"}),
                           (f"/admin/customers/{user['id']}/reset-password", {"newPassword": "x" * 12})):
            self.assertEqual(self.post(client, path, body).status_code, 403, path)
```

```bash
cd /Users/optyne/repository/b300/sell-panel/powerchampion-marketplace/.worktrees/a2a-admin-shell
.venv-portal/bin/python -m unittest server.test_accounts 2>&1 | tail -5
```
Expected: 新測試 404（路由不存在）而失敗。

- [ ] **Step 2: 實作**

`server/app.py`：
- `/admin/customers` 的 SQL 去掉 `WHERE role='customer'`（保留 ORDER／LIMIT）。
- 在 `/admin/audit` 路由前加：

```python
    def admin_target(con, user_id, admin):
        if user_id == admin["id"]:
            fail("self_target", "Use your own account page for your own account.", 409)
        row = con.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        if not row:
            fail("customer_not_found", "Account not found.", 404)
        return row

    @application.post(PREFIX + "/admin/customers/{user_id}/status")
    async def admin_set_status(user_id: str, request: Request):
        admin = current_user(request, admin=True)
        body = await body_json(request)
        action = body.get("action")
        if action not in ("disable", "enable"):
            fail("invalid_input", "Choose disable or enable.")
        with store.connect() as con:
            con.execute("BEGIN IMMEDIATE")
            row = admin_target(con, user_id, admin)
            if action == "disable" and row["disabled_at"] is None:
                con.execute("UPDATE users SET disabled_at=? WHERE id=?", (int(time.time()), user_id))
                con.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))
                store.audit(con, "admin.account_disabled", admin["id"], user_id)
            elif action == "enable" and row["disabled_at"] is not None:
                con.execute("UPDATE users SET disabled_at=NULL WHERE id=?", (user_id,))
                store.audit(con, "admin.account_enabled", admin["id"], user_id)
            row = con.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        return {"customer": user_json(row)}

    @application.post(PREFIX + "/admin/customers/{user_id}/role")
    async def admin_set_role(user_id: str, request: Request):
        admin = current_user(request, admin=True)
        body = await body_json(request)
        role = body.get("role")
        if role not in ("customer", "admin"):
            fail("invalid_input", "Choose customer or admin.")
        with store.connect() as con:
            con.execute("BEGIN IMMEDIATE")
            row = admin_target(con, user_id, admin)
            if row["role"] != role:
                con.execute("UPDATE users SET role=? WHERE id=?", (role, user_id))
                store.audit(con, "admin.role_changed", admin["id"], user_id)
            row = con.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        return {"customer": user_json(row)}

    @application.post(PREFIX + "/admin/customers/{user_id}/reset-password")
    async def admin_reset_password(user_id: str, request: Request):
        admin = current_user(request, admin=True)
        body = await body_json(request)
        try:
            password = validate_password(body.get("newPassword"))
        except ValueError as error:
            fail("invalid_input", str(error))
        encoded = await run_in_threadpool(password_hash, password)
        with store.connect() as con:
            con.execute("BEGIN IMMEDIATE")
            row = admin_target(con, user_id, admin)
            con.execute("UPDATE users SET password_hash=? WHERE id=?", (encoded, user_id))
            con.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))
            con.execute("DELETE FROM login_attempts WHERE scope=?", ("login:" + digest_token(row["email"]),))
            store.audit(con, "admin.password_reset", admin["id"], user_id)
        return {"ok": True}
```

確認 `app.py` 頂部已 import `password_hash`、`validate_password`、`digest_token`、`run_in_threadpool`（登入／註冊已在用，缺的補上）。

`server/test_portal.py:280-288`：`test_customer_cannot_access_any_admin_route` 的迴圈後加三個 POST（路徑同上、body 任意）都要 403。

- [ ] **Step 3: 測試通過（兩種後端）**

```bash
cd /Users/optyne/repository/b300/sell-panel/powerchampion-marketplace/.worktrees/a2a-admin-shell
.venv-portal/bin/python -m unittest server.test_accounts server.test_portal -v 2>&1 | tail -8
.venv-portal/bin/python -m unittest discover -s server -t . -p 'test_*.py' 2>&1 | tail -3
scripts/test_backend_postgres.sh 2>&1 | tail -3
```
Expected: 全綠；數量比 Task 1 多 6（含精簡後的 self_target 測試）。

- [ ] **Step 4: commit**

```bash
cd /Users/optyne/repository/b300/sell-panel/powerchampion-marketplace/.worktrees/a2a-admin-shell
git add server/app.py server/test_accounts.py server/test_portal.py
git commit -m "portal: admin can disable/enable accounts, change roles and reset passwords

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: 使用者自助改密碼 `POST /password`

**Files:**
- Modify: `server/app.py`（在 `/overview` 路由附近新增）
- Modify: `server/test_accounts.py`（新增 `SelfServicePasswordTests`）

**Interfaces:**
- Produces: `POST /password` body `{"currentPassword": str, "newPassword": str}` → `{"ok": true}`。錯舊密碼 → 400 `invalid_current_password`；新密碼不合規 → 400 `invalid_input`；成功後**其他** session 全部失效、當前 session 保留；審計 `account.password_changed`（actor＝本人）。

- [ ] **Step 1: 失敗的測試**

```python
class SelfServicePasswordTests(_PortalCase):
    def test_change_password_keeps_current_session_and_drops_others(self):
        me = self.client()
        self.register(me, "a@example.test")
        other = self.client()
        self.assertEqual(self.post(other, "/auth/login", {"email": "a@example.test", "password": PASSWORD}).status_code, 200)
        bad = self.post(me, "/password", {"currentPassword": "not-the-password-1", "newPassword": "brand-new-password-987!"})
        self.assertEqual(bad.status_code, 400)
        self.assertEqual(bad.json()["error"], "invalid_current_password")
        weak = self.post(me, "/password", {"currentPassword": PASSWORD, "newPassword": "short"})
        self.assertEqual(weak.json()["error"], "invalid_input")
        ok = self.post(me, "/password", {"currentPassword": PASSWORD, "newPassword": "brand-new-password-987!"})
        self.assertEqual(ok.status_code, 200, ok.text)
        self.assertEqual(me.get(BASE + "/session").status_code, 200, "current session survives")
        self.assertEqual(other.get(BASE + "/session").status_code, 401, "other sessions are revoked")
        self.assertEqual(self.post(self.client(), "/auth/login", {"email": "a@example.test", "password": "brand-new-password-987!"}).status_code, 200)
        self.assertIn("account.password_changed", [e["action"] for e in rows(self.store, "audit_events")])

    def test_change_password_requires_session(self):
        self.assertEqual(self.post(self.client(), "/password", {"currentPassword": PASSWORD, "newPassword": "x" * 12}).status_code, 401)
```

- [ ] **Step 2: 實作**

`server/app.py`，放在 `/overview` 路由前：

```python
    @application.post(PREFIX + "/password")
    async def change_password(request: Request):
        user = current_user(request)
        body = await body_json(request)
        current = body.get("currentPassword")
        if not isinstance(current, str) or not 1 <= len(current) <= 128:
            fail("invalid_current_password", "The current password is incorrect.")
        try:
            password = validate_password(body.get("newPassword"))
        except ValueError as error:
            fail("invalid_input", str(error))
        row = store.find_user(user["email"])
        valid = await run_in_threadpool(verify_password, current, row["password_hash"])
        if not valid:
            fail("invalid_current_password", "The current password is incorrect.")
        encoded = await run_in_threadpool(password_hash, password)
        keep = digest_token(request.cookies.get(COOKIE_NAME, ""))
        with store.connect() as con:
            con.execute("BEGIN IMMEDIATE")
            con.execute("UPDATE users SET password_hash=? WHERE id=?", (encoded, user["id"]))
            con.execute("DELETE FROM sessions WHERE user_id=? AND token_hash<>?", (user["id"], keep))
            store.audit(con, "account.password_changed", user["id"], user["id"])
        return {"ok": True}
```

- [ ] **Step 3: 測試通過（兩種後端）**

```bash
cd /Users/optyne/repository/b300/sell-panel/powerchampion-marketplace/.worktrees/a2a-admin-shell
.venv-portal/bin/python -m unittest server.test_accounts -v 2>&1 | tail -6
.venv-portal/bin/python -m unittest discover -s server -t . -p 'test_*.py' 2>&1 | tail -3
scripts/test_backend_postgres.sh 2>&1 | tail -3
```
Expected: 全綠；數量比 Task 2 多 2。

- [ ] **Step 4: commit**

```bash
cd /Users/optyne/repository/b300/sell-panel/powerchampion-marketplace/.worktrees/a2a-admin-shell
git add server/app.py server/test_accounts.py
git commit -m "portal: customers can change their own password

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: BFF 白名單、錯誤文案、登入後導向

**Files:**
- Modify: `app/api/portal/[...path]/route.ts:16`（POST 白名單）
- Modify: `lib/portal-client.ts:56-98`（錯誤碼文案）、`:100-110`（`safeAccountReturn` 允許 `/admin*`）
- Modify: `tests/portal-proxy.test.ts`（允許／拒絕案例）、`tests/portal-ui.test.tsx:76`（`/admin` 導向期望）

**Interfaces:**
- Produces: BFF 放行 `POST /password`、`POST /admin/customers/<32hex>/(status|role|reset-password)`；`portalErrorText` 認得 `account_disabled`、`invalid_current_password`、`self_target`；`safeAccountReturn("/admin")` 回 `/admin`（以及 `/admin/customers|credits|audit`）。

- [ ] **Step 1: 失敗的測試**

`tests/portal-proxy.test.ts`：在既有「blocks cross-origin mutations…」測試旁加一個 `it`：

```ts
  it("allows the account-management and password routes and nothing adjacent", async () => {
    vi.stubEnv("PC_PORTAL_ORIGIN", "https://portal.internal.example");
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const id = "a".repeat(32);
    for (const allowed of ["/password", `/admin/customers/${id}/status`, `/admin/customers/${id}/role`, `/admin/customers/${id}/reset-password`]) {
      expect((await POST(request(allowed, "POST", {}))).status).toBe(200);
    }
    expect(fetchMock.mock.calls.length).toBe(4);
    for (const blocked of [`/admin/customers/${id}/delete`, "/admin/customers/not-hex/status", `/admin/customers/${id}`, "/password/reset"]) {
      expect((await POST(request(blocked, "POST", {}))).status).toBe(404);
    }
    expect(fetchMock.mock.calls.length).toBe(4);
  });
```
（`request`、`POST` 等 helper 沿用該檔既有定義。）

`tests/portal-ui.test.tsx:76` 附近那條斷言 `/admin` 會落回 `/account` 的測試，改成期望 `/admin` 原樣回傳；另加 `expect(safeAccountReturn("/admin/customers")).toBe("/admin/customers")` 與 `expect(safeAccountReturn("/admin/anything")).toBe("/account")`。

```bash
cd /Users/optyne/repository/b300/sell-panel/powerchampion-marketplace/.worktrees/a2a-admin-shell
npx vitest run tests/portal-proxy.test.ts tests/portal-ui.test.tsx 2>&1 | tail -8
```
Expected: 新案例失敗。

- [ ] **Step 2: 實作**

`route.ts` POST 陣列加：`/^\/password$/`、`new RegExp(`^/admin/customers/${AGENT}/(status|role|reset-password)$`)`（`AGENT` 已是 `[a-f0-9]{32}`）。

`lib/portal-client.ts` 的 `portalErrorText` 在 `invalid_credentials` 之後加：

```ts
  if (code === "account_disabled")
    return locale === "zh" ? "此帳號已被停用，請聯繫支援。" : "This account has been disabled. Contact support.";
  if (code === "invalid_current_password")
    return locale === "zh" ? "目前的密碼不正確。" : "The current password is incorrect.";
  if (code === "self_target")
    return locale === "zh" ? "請到「我的帳戶」管理自己的帳號。" : "Manage your own account from the account page.";
```

`safeAccountReturn` 的 regex 加一段：`|\/admin(?:\/(?:customers|credits|audit))?`（放在 `\/tasks` 之前）。

- [ ] **Step 3: 測試通過**

```bash
cd /Users/optyne/repository/b300/sell-panel/powerchampion-marketplace/.worktrees/a2a-admin-shell
npx vitest run 2>&1 | tail -4
npx tsc --noEmit 2>&1 | tail -3
```
Expected: 全綠；tsc 無錯。

- [ ] **Step 4: commit**

```bash
cd /Users/optyne/repository/b300/sell-panel/powerchampion-marketplace/.worktrees/a2a-admin-shell
git add 'app/api/portal/[...path]/route.ts' lib/portal-client.ts tests/portal-proxy.test.ts tests/portal-ui.test.tsx
git commit -m "portal: proxy the account-management and password routes; admin return paths

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: 獨立後台殼層

**Files:**
- Create: `components/admin-shell.tsx`、`app/admin/layout.tsx`、`app/admin.css`
- Modify: `app/layout.tsx:9-29`（import `./admin.css`）
- Modify: `components/site-shell.tsx:218`（`/admin*` 直接回 children）
- Modify: `components/platform-frame.tsx:82-85,99-101,205`（移除 `/admin` 特例）
- Modify: `components/admin-portal.tsx:770-887`（移除 header、nav、「我的帳戶」連結；保留狀態處理與 section 切換；根元素改 `<div className="admin-content">`）
- Modify: `tests/portal-ui.test.tsx`（殼層測試；既有 admin 測試若依賴被移除的標題文字要改）

**Interfaces:**
- Produces: `AdminShell({ pathname, children })`（client component）：左側欄 4 個連結（總覽／客戶／儲值申請／操作紀錄，`aria-current="page"` 標當前）、頂列「← 回官網」（`/`）、「我的帳戶」（`/account`）、「登出」按鈕（`POST /auth/logout` 後 `window.location.assign("/login")`）。`app/admin/layout.tsx` 把 `AdminShell` 套在 `/admin/*` 所有頁面外。
- `/admin*` 不再出現行銷頁首、頁尾、客戶側欄。

- [ ] **Step 1: 失敗的測試**

`tests/portal-ui.test.tsx` 加：

```tsx
import { AdminShell } from "../components/admin-shell";

describe("AdminShell", () => {
  it("renders the admin navigation with the current section marked", () => {
    wrap(<AdminShell pathname="/admin/customers"><p>content</p></AdminShell>);
    const nav = screen.getByRole("navigation", { name: /administration/i });
    expect(nav).toBeVisible();
    expect(screen.getByRole("link", { name: "Customers" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Overview" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: /back to site/i })).toHaveAttribute("href", "/");
    expect(screen.getByText("content")).toBeVisible();
  });

  it("signs out through the portal and leaves for the login page", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    wrap(<AdminShell pathname="/admin"><p>content</p></AdminShell>);
    await user.click(screen.getByRole("button", { name: /sign out/i }));
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/api\/portal\/auth\/logout$/);
    expect(assign).toHaveBeenCalledWith("/login");
  });
});
```
（`userEvent`、`wrap`、`screen` 沿用該檔既有 import。若 `vi.stubGlobal("location", …)` 在 jsdom 下不可寫，改成把 `assign` 以 prop 注入：`AdminShell` 接受可選的 `onSignedOut?: () => void`，預設 `() => window.location.assign("/login")`，測試傳 mock。）

```bash
cd /Users/optyne/repository/b300/sell-panel/powerchampion-marketplace/.worktrees/a2a-admin-shell
npx vitest run tests/portal-ui.test.tsx 2>&1 | tail -6
```
Expected: 找不到模組 `../components/admin-shell`。

- [ ] **Step 2: 實作殼層**

`components/admin-shell.tsx`：

```tsx
"use client";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useLocale } from "./locale-provider";
import { portalRequest } from "../lib/portal-client";

const NAV = [
  { href: "/admin", en: "Overview", zh: "總覽" },
  { href: "/admin/customers", en: "Customers", zh: "客戶" },
  { href: "/admin/credits", en: "Credit requests", zh: "儲值申請" },
  { href: "/admin/audit", en: "Audit log", zh: "操作紀錄" },
] as const;

export function AdminShell({
  pathname,
  children,
  onSignedOut = () => window.location.assign("/login"),
}: {
  pathname: string;
  children: ReactNode;
  onSignedOut?: () => void;
}) {
  const zh = useLocale().locale === "zh";
  const [signingOut, setSigningOut] = useState(false);
  const current = NAV.find((item) => item.href === pathname)?.href ?? "/admin";
  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await portalRequest("/auth/logout", { method: "POST" });
    } catch {
      // A failed logout still leaves the page; the cookie is HttpOnly and expires server-side.
    }
    onSignedOut();
  }
  return (
    <div className="admin-shell">
      <a className="sr-only" href="#main-content">{zh ? "跳到主要內容" : "Skip to content"}</a>
      <aside className="admin-shell-sidebar">
        <p className="admin-shell-brand">Power Champion<span>{zh ? "管理後台" : "Administration"}</span></p>
        <nav aria-label={zh ? "管理後台導覽" : "Administration navigation"}>
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} aria-current={current === item.href ? "page" : undefined}>
              {zh ? item.zh : item.en}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="admin-shell-main">
        <header className="admin-shell-topbar">
          <Link href="/">← {zh ? "回官網" : "Back to site"}</Link>
          <div className="admin-shell-topbar-actions">
            <Link href="/account">{zh ? "我的帳戶" : "My account"}</Link>
            <button type="button" onClick={signOut} disabled={signingOut}>
              {zh ? "登出" : "Sign out"}
            </button>
          </div>
        </header>
        <main id="main-content" className="admin-shell-content">{children}</main>
      </div>
    </div>
  );
}
```

`app/admin/layout.tsx`：

```tsx
import type { ReactNode } from "react";
import { AdminShellRoute } from "../../components/admin-shell-route";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminShellRoute>{children}</AdminShellRoute>;
}
```

`components/admin-shell-route.tsx`（client，只為了拿 pathname）：

```tsx
"use client";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AdminShell } from "./admin-shell";

export function AdminShellRoute({ children }: { children: ReactNode }) {
  return <AdminShell pathname={usePathname() ?? "/admin"}>{children}</AdminShell>;
}
```

`app/admin.css`（在 `app/layout.tsx` 的 CSS import 清單最後加 `import "./admin.css";`）：

```css
.admin-shell { min-height: 100vh; display: grid; grid-template-columns: 240px 1fr; background: var(--ground); color: var(--ink); }
.admin-shell-sidebar { border-right: 1px solid var(--line); padding: 24px 16px; display: flex; flex-direction: column; gap: 24px; background: var(--surface); }
.admin-shell-brand { margin: 0; font-weight: 600; letter-spacing: 0.04em; }
.admin-shell-brand span { display: block; font-size: 0.8rem; font-weight: 400; color: var(--muted); }
.admin-shell-sidebar nav { display: flex; flex-direction: column; gap: 4px; }
.admin-shell-sidebar nav a { padding: 10px 12px; border-radius: 8px; color: var(--ink); text-decoration: none; }
.admin-shell-sidebar nav a:hover { background: var(--surface-raised); }
.admin-shell-sidebar nav a[aria-current="page"] { background: var(--surface-raised); font-weight: 600; box-shadow: inset 3px 0 0 var(--cyan); }
.admin-shell-main { display: flex; flex-direction: column; min-width: 0; }
.admin-shell-topbar { display: flex; justify-content: space-between; align-items: center; padding: 12px 24px; border-bottom: 1px solid var(--line); }
.admin-shell-topbar a, .admin-shell-topbar button { color: var(--ink); background: none; border: 1px solid transparent; padding: 6px 10px; border-radius: 6px; cursor: pointer; font: inherit; text-decoration: none; }
.admin-shell-topbar button:hover, .admin-shell-topbar a:hover { border-color: var(--line); }
.admin-shell-topbar-actions { display: flex; gap: 8px; }
.admin-shell-content { padding: 24px; max-width: 1200px; width: 100%; }
@media (max-width: 800px) {
  .admin-shell { grid-template-columns: 1fr; }
  .admin-shell-sidebar { border-right: 0; border-bottom: 1px solid var(--line); flex-direction: row; align-items: center; justify-content: space-between; }
  .admin-shell-sidebar nav { flex-direction: row; flex-wrap: wrap; }
}
```

- [ ] **Step 3: 拆掉舊殼層**

- `components/site-shell.tsx:218`：在 `if (getInternationalRoute(pathname)) return children;` 之後加 `if (pathname === "/admin" || pathname.startsWith("/admin/")) return children;`。
- `components/platform-frame.tsx`：`isPlatformPath` 去掉 `pathname === "/admin" || pathname.startsWith("/admin/") ||`；`current` 的 `/admin` 三元運算去掉，只剩 `destinations.find(...)`（找不到時保留原本的 fallback 行為，看該函式既有寫法）；`:205` 的 `/admin` option 刪除。
- `components/admin-portal.tsx:770-887`：`AdminPortal` 的回傳改成：根元素 `<div className="admin-content">`；刪掉 `<header className="portal-header">…</header>` 整段；刪掉 `<nav className="portal-nav">…</nav>` 整段（含「我的帳戶 ↗」）；其餘 loading／signedOut／forbidden／error／section 分支原樣保留。`navigation` 陣列仍需保留給 signedOut 的 `next=` 連結用。

- [ ] **Step 4: 測試、型別、建置**

```bash
cd /Users/optyne/repository/b300/sell-panel/powerchampion-marketplace/.worktrees/a2a-admin-shell
npx vitest run 2>&1 | tail -4
npx tsc --noEmit 2>&1 | tail -3
npm run lint 2>&1 | tail -3
npm test 2>&1 | tail -8
```
Expected: vitest 全綠（既有 admin 測試若斷言被刪除的標題「Checking administrator access…」以外的 header 文字，更新期望）；tsc／lint 乾淨；`npm test` 的 rendered-html 對 `/admin` 仍是 noindex、無 analytics。

- [ ] **Step 5: 本地實跑看畫面**

```bash
cd /Users/optyne/repository/b300/sell-panel/powerchampion-marketplace/.worktrees/a2a-admin-shell
(PORT=3978 npm run start >/tmp/a2a-start.log 2>&1 &) ; sleep 8
curl -s http://localhost:3978/admin | grep -o 'admin-shell-sidebar\|site-header-wrapper\|platform-sidebar' | sort | uniq -c
pkill -f "vinext[ ]start" || true
```
Expected: 有 `admin-shell-sidebar`，**沒有** `site-header-wrapper`、沒有 `platform-sidebar`（class 名以實際 CSS 為準，看 `app/platform.css`）。

- [ ] **Step 6: commit**

```bash
cd /Users/optyne/repository/b300/sell-panel/powerchampion-marketplace/.worktrees/a2a-admin-shell
git add components/admin-shell.tsx components/admin-shell-route.tsx app/admin/layout.tsx app/admin.css app/layout.tsx components/site-shell.tsx components/platform-frame.tsx components/admin-portal.tsx tests/portal-ui.test.tsx
git commit -m "admin: standalone administration shell (own sidebar/topbar, no marketing or workspace chrome)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: 客戶頁的管理動作（停用／啟用、改角色、重設密碼）

**Files:**
- Modify: `components/admin-portal.tsx`（`Customer` 型別加 `role`、`status`；`CustomersSection` 表格加欄位與動作；新增 `AccountActionDialog`）
- Modify: `tests/portal-ui.test.tsx`

**Interfaces:**
- Consumes: Task 2 的三條 POST 路由、Task 4 的 BFF 放行與錯誤文案。
- Produces: 客戶表格多「角色」「狀態」欄；每列三個按鈕：停用／啟用（依狀態）、改角色（customer↔admin）、重設密碼（開對話框輸入新密碼兩次）。對話框元件 `AccountActionDialog({ action, customer, onClose, onDone })`，`action` ∈ `"disable"|"enable"|"role"|"reset-password"`，沿用 `ReviewDialog` 的 `useModalIsolation`、focus trap、Esc、`inFlightRef`。

- [ ] **Step 1: 失敗的測試**

`tests/portal-ui.test.tsx` 加（沿用既有 credit review 測試的 `fetchMock.mockImplementation((url, init) => …)` 寫法）：

```tsx
it("disables a customer after confirmation and reflects the new status", async () => {
  const user = userEvent.setup();
  const customers = [{ id: "b".repeat(32), email: "roy@example.test", name: "Roy", role: "customer", status: "active", createdAt: "2026-09-25T00:00:00Z", keyCount: 0 }];
  const fetchMock = vi.fn().mockImplementation((url, init) => {
    const u = String(url);
    if (u.endsWith("/session")) return Promise.resolve(Response.json({ user: { ...customer, role: "admin" } }));
    if (u.endsWith("/admin/customers") && !init?.method) return Promise.resolve(Response.json({ customers }));
    if (u.endsWith("/status") && init?.method === "POST") {
      customers[0].status = "disabled";
      return Promise.resolve(Response.json({ customer: customers[0] }));
    }
    return Promise.resolve(Response.json({ error: "unexpected" }, { status: 500 }));
  });
  vi.stubGlobal("fetch", fetchMock);
  wrap(<AdminPortal section="customers" />);
  await user.click(await screen.findByRole("button", { name: /disable/i }));
  await user.click(screen.getByRole("button", { name: /confirm/i }));
  expect(await screen.findByText("disabled", { exact: false })).toBeVisible();
  const call = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
  expect(String(call?.[0])).toMatch(/\/admin\/customers\/b{32}\/status$/);
  expect(JSON.parse(String(call?.[1]?.body))).toEqual({ action: "disable" });
});

it("resets a customer password only when both entries match", async () => {
  const user = userEvent.setup();
  const customers = [{ id: "b".repeat(32), email: "roy@example.test", name: "Roy", role: "customer", status: "active", createdAt: "2026-09-25T00:00:00Z", keyCount: 0 }];
  const fetchMock = vi.fn().mockImplementation((url, init) => {
    const u = String(url);
    if (u.endsWith("/session")) return Promise.resolve(Response.json({ user: { ...customer, role: "admin" } }));
    if (u.endsWith("/admin/customers") && !init?.method) return Promise.resolve(Response.json({ customers }));
    if (u.endsWith("/reset-password")) return Promise.resolve(Response.json({ ok: true }));
    return Promise.resolve(Response.json({ error: "unexpected" }, { status: 500 }));
  });
  vi.stubGlobal("fetch", fetchMock);
  wrap(<AdminPortal section="customers" />);
  await user.click(await screen.findByRole("button", { name: /reset password/i }));
  await user.type(screen.getByLabelText(/new password/i), "brand-new-password-987!");
  await user.type(screen.getByLabelText(/confirm/i), "different-password-000!");
  await user.click(screen.getByRole("button", { name: /confirm/i }));
  expect(screen.getByText(/do not match/i)).toBeVisible();
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  await user.clear(screen.getByLabelText(/confirm/i));
  await user.type(screen.getByLabelText(/confirm/i), "brand-new-password-987!");
  await user.click(screen.getByRole("button", { name: /confirm/i }));
  const call = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
  expect(JSON.parse(String(call?.[1]?.body))).toEqual({ newPassword: "brand-new-password-987!" });
  expect(await screen.findByText(/password was reset/i)).toBeVisible();
});
```

- [ ] **Step 2: 實作**

`components/admin-portal.tsx`：
- `Customer` 加 `role: "customer" | "admin"; status: "active" | "disabled";`。
- `CustomersSection`：表頭加「角色／Role」「狀態／Status」「動作／Actions」；每列顯示 badge（`portal-badge`）與三個 `portal-button-secondary` 按鈕：`{status === "active" ? (zh ? "停用" : "Disable") : (zh ? "啟用" : "Enable")}`、`{zh ? "改角色" : "Change role"}`、`{zh ? "重設密碼" : "Reset password"}`；點擊設 `selection = { action, customer }`；對話框完成後 `resource.refresh()` 並顯示一行 `portal-note` 成功訊息（重設密碼：`zh ? "密碼已重設，該使用者的所有登入已登出。" : "The password was reset and every session for that user was signed out."`）。
- `AccountActionDialog`：複製 `ReviewDialog` 的骨架（`useModalIsolation`、focus trap、Esc、`inFlightRef`），依 `action` 顯示：
  - `disable`／`enable`：說明文字 ＋ 確認鈕；POST `/admin/customers/{id}/status` body `{action}`。
  - `role`：說明「將 X 從 customer 改為 admin」（反之亦然）＋ 確認鈕；POST `/role` body `{role: 反向}`。
  - `reset-password`：兩個 `type="password"` 欄位（label `新密碼／New password`、`確認新密碼／Confirm new password`），送出前比對，不一致顯示 `zh ? "兩次輸入的密碼不一致。" : "The passwords do not match."` 且**不**打 API；長度 < 12 顯示 `zh ? "密碼至少 12 個字元。" : "Use at least 12 characters."`；POST `/reset-password` body `{newPassword}`。
  - 錯誤用 `portalErrorText(error, locale)` 顯示在 `portal-error`。
  - 確認鈕文字固定 `zh ? "確認" : "Confirm"`，取消鈕 `zh ? "取消" : "Cancel"`。

- [ ] **Step 3: 測試通過**

```bash
cd /Users/optyne/repository/b300/sell-panel/powerchampion-marketplace/.worktrees/a2a-admin-shell
npx vitest run tests/portal-ui.test.tsx 2>&1 | tail -6
npx vitest run 2>&1 | tail -4
npx tsc --noEmit 2>&1 | tail -3
```
Expected: 全綠。

- [ ] **Step 4: commit**

```bash
cd /Users/optyne/repository/b300/sell-panel/powerchampion-marketplace/.worktrees/a2a-admin-shell
git add components/admin-portal.tsx tests/portal-ui.test.tsx
git commit -m "admin: customer directory shows role/status and offers disable, role change and password reset

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: 帳戶頁的「安全性」分頁（自助改密碼）

**Files:**
- Modify: `components/account-portal.tsx:14`（`Section` 加 `"security"`）、`:51-61`（NAV 加項）、資料載入 switch（`security` 不需載資料）、新增 `SecuritySection` 表單
- Modify: `app/account/[[...section]]/page.tsx:12-21`（允許 `security`）
- Modify: `tests/portal-ui.test.tsx`

**Interfaces:**
- Consumes: Task 3 的 `POST /password`。
- Produces: `/account/security`：表單三欄（目前密碼、新密碼、確認新密碼），成功顯示 `zh ? "密碼已更新。其他裝置的登入已登出。" : "Password updated. Other devices were signed out."`。

- [ ] **Step 1: 失敗的測試**

```tsx
it("changes the password from the security section", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn().mockImplementation((url, init) => {
    const u = String(url);
    if (u.endsWith("/session")) return Promise.resolve(Response.json({ user: customer }));
    if (u.endsWith("/password") && init?.method === "POST") return Promise.resolve(Response.json({ ok: true }));
    return Promise.resolve(Response.json({ error: "unexpected" }, { status: 500 }));
  });
  vi.stubGlobal("fetch", fetchMock);
  wrap(<AccountPortal section="security" />);
  await user.type(await screen.findByLabelText(/current password/i), "customer-test-password-123!");
  await user.type(screen.getByLabelText(/^new password/i), "brand-new-password-987!");
  await user.type(screen.getByLabelText(/confirm/i), "brand-new-password-987!");
  await user.click(screen.getByRole("button", { name: /update password/i }));
  expect(await screen.findByText(/password updated/i)).toBeVisible();
  const call = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
  expect(JSON.parse(String(call?.[1]?.body))).toEqual({ currentPassword: "customer-test-password-123!", newPassword: "brand-new-password-987!" });
});
```

- [ ] **Step 2: 實作**

- `Section` 加 `"security"`；NAV 加 `{ section: "security", href: "/account/security", en: "Security", zh: "安全性" }`；`app/account/[[...section]]/page.tsx` 的合法 section 清單加 `security`。
- 載入邏輯：`section === "security"` 時只抓 `/session`，不抓資料。
- `SecuritySection`：三個 `portal-field` 密碼欄位，送出前本地檢查（不一致／太短，訊息同 Task 6），用該檔既有的 `mutate("/password", "POST", { currentPassword, newPassword })`，成功清空欄位並顯示 `portal-note`；錯誤用 `portalErrorText`。提交鈕 `zh ? "更新密碼" : "Update password"`。

- [ ] **Step 3: 測試通過**

```bash
cd /Users/optyne/repository/b300/sell-panel/powerchampion-marketplace/.worktrees/a2a-admin-shell
npx vitest run 2>&1 | tail -4
npx tsc --noEmit 2>&1 | tail -3
npm run lint 2>&1 | tail -3
```

- [ ] **Step 4: commit**

```bash
cd /Users/optyne/repository/b300/sell-panel/powerchampion-marketplace/.worktrees/a2a-admin-shell
git add components/account-portal.tsx 'app/account/[[...section]]/page.tsx' tests/portal-ui.test.tsx
git commit -m "account: security section with self-service password change

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: 文件與 spec 修訂

**Files:**
- Modify: `docs/superpowers/specs/2026-10-08-unified-admin-platform-design.md` §3 表格（A2 → A2a／A2b 兩列）、§5.3（加「後台殼層：獨立 layout」與「密碼重設：admin 代重設＋自助改」兩段；admin 頁表格加「安全性」）
- Modify: `docs/portal-operations.md`（新增「帳號管理」段：停用／角色／重設密碼在 `/admin/customers`；`manage.py` 的互動式密碼在 Dokploy 網頁終端不可用，改用 `read -s` 進 `PC_PORTAL_ADMIN_PASSWORD`／`PC_PORTAL_NEW_PASSWORD`）
- Modify: `server/README.md`（路由表加 `/password` 與三條 `/admin/customers/*`；審計動作名清單）
- Modify: `docs/deploy/a1-postgres-cutover.md` §5（`/api/portal/health` 從公開網址是 404，改寫為「Dokploy 容器 Healthy ＋ 登入測試」）

- [ ] **Step 1: 改文件**（逐檔小幅修改，不重寫）
- [ ] **Step 2: commit**

```bash
cd /Users/optyne/repository/b300/sell-panel/powerchampion-marketplace/.worktrees/a2a-admin-shell
git add docs/superpowers/specs/2026-10-08-unified-admin-platform-design.md docs/portal-operations.md server/README.md docs/deploy/a1-postgres-cutover.md
git commit -m "docs: A2 split into A2a/A2b; admin shell, account management and password reset

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: 【使用者執行】push、PR、merge、驗收

- [ ] **Step 1: 【使用者執行】**

```bash
cd /Users/optyne/repository/b300/sell-panel/powerchampion-marketplace/.worktrees/a2a-admin-shell && git push -u origin a2a/admin-shell
```

```bash
cd /Users/optyne/repository/b300/sell-panel/powerchampion-marketplace/.worktrees/a2a-admin-shell && gh pr create --base main --head a2a/admin-shell --title "A2a: standalone admin shell, account management, password reset" --body "Admin shell without marketing/workspace chrome; disable/enable, role change, admin password reset; self-service password change; users.disabled_at migration (0002)."
```

agent 等 `portal-backend`（sqlite＋postgres）綠，再請使用者 `gh pr merge <n> --merge --delete-branch=false`。merge 即 Autodeploy。Migration `0002` 會在 portal 啟動時自動套用（`Store()` → `upgrade_to_head`）。

- [ ] **Step 2: 驗收（部署後）**
- agent：`curl -s https://powerchampion.ai/admin | grep -c admin-shell-sidebar` ≥ 1；`grep -c site-header-wrapper` = 0。
- 使用者：以 `doga960103@gmail.com` 登入 → `/admin` 只有後台側欄 → 到「客戶」頁看到兩個帳號含角色與狀態 → 到 `/account/security` 用臨時密碼換成正式密碼 → 登出再用新密碼登入。
- agent：在 db 容器終端 `psql -U portal -d portal -c "select version_num from alembic_version; select action from audit_events order by created_at desc limit 3;"` → `0002_users_disabled_at`、含 `account.password_changed`。

- [ ] **Step 3: 收尾**：記憶檔補 A2a 完成；移除 worktree（分支保留）；ledger 標 A2a DONE；開 A2b 計畫。

---

## 自我檢查（對照 spec §5.3 與使用者需求）

- 殼層選項 A → Task 5（獨立 layout、SiteShell 繞過、PlatformFrame 去特例、AdminPortal 去 chrome）。
- 停用／啟用、改角色 → Task 1（欄位＋登入／session 檢查）、Task 2（路由）、Task 6（UI）。
- 密碼重設：admin 代重設 → Task 2＋6；自助改 → Task 3＋7。
- 所有 admin 寫入進 `audit_events` → Task 2、3 的審計動作名。
- 每個寫入都有 BFF 白名單與 proxy 測試 → Task 4。
- 兩種後端測試 → Task 1、2、3 跑 `scripts/test_backend_postgres.sh`。
- A2b 留下：閘道 admin token、代理路由、金鑰／用量／閘道／Personas 頁、閘道 HTML 退場（A3）。
