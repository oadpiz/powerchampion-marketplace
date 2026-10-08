# 第 0 期：閘道分支收斂 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把生產分支 `glm53-gateway` 合進 `origin/main`，讓 b300 閘道只剩一條生產線 `main`，並以數值錨點驗證部署後行為未倒退。

**Architecture:** 在 `sell-panel` 開一個獨立 worktree 做 `--no-ff` merge。兩邊的共同祖先是 `f52a412`；`origin/main` 多 4 個 commit（billing 結算、Go CI、kv-affinity），`glm53-gateway` 多 17 個（官網 301、`/catalog.json`、節點 ops、aborted-stream 計費）。乾跑結果：36 個檔案變動，**只有 `app.py` 一處衝突**（aborted stream 的 `record_usage` 呼叫）。合併後由使用者 push、開 PR、merge、把 Dokploy 改追 `main` 並部署；agent 負責部署前後的錨點比對。

**Tech Stack:** git worktree、Python 3 `unittest`（`python3 -m unittest discover -s tests -q`）、`python3 -m py_compile`、PyYAML、urllib（錨點抓取腳本）。Dokploy 部署用 `RELEASE_REVISION` build-arg 把 commit 寫進映像標籤 `org.opencontainers.image.revision`。

## Global Constraints

- 對應 spec：`docs/superpowers/specs/2026-10-08-unified-admin-platform-design.md` §4。
- 兩邊基準（2026-10-08 實測）：`origin/main` 762f5a9 與 `glm53-gateway` 0c406cf 各 **628 tests, OK, 0 failed**。合併後必須 **0 failed 且 ≥ 628**。
- **agent 不得 push、不得 merge PR、不得動 Dokploy、不得對生產做寫入**（LESSONS 2026-08-10；全域硬規則 6）。這些步驟標 `【使用者執行】`，agent 到該步驟就停下回報。
- 所有 git 指令單獨一行執行，先看 `git status`（LESSONS 2026-09-16）。不用 `git stash`（worktree 共用 stash 堆疊）。
- 不用 bare `git checkout <path>` 清理（LESSONS 2026-09-16）。
- 只改本計畫列出的檔案；`config.yaml` 只接受 merge 自動合併的結果，不手改。
- 生產公開端點（`/catalog.json`、`/status.json`、`/openrouter/models`）可讀；需要 admin token 的端點由使用者執行。
- 本計畫落在 marketplace repo（與 spec 同處）；合併產物在 `sell-panel` repo。

---

### Task 1: 建 merge worktree 並執行 merge

**Files:**
- Create: `sell-panel/.wt-merge/`（worktree，分支 `merge/glm53-into-main`）
- Modify（由 git merge 產生）: `sell-panel/.wt-merge/app.py:2015-2031`（唯一衝突）

**Interfaces:**
- Produces: worktree 路徑 `/Users/optyne/repository/b300/sell-panel/.wt-merge`，後續任務都在這裡執行；分支名 `merge/glm53-into-main`。

- [ ] **Step 1: 確認起點乾淨**

```bash
cd /Users/optyne/repository/b300/sell-panel
git fetch origin --prune
git status --short | head
git worktree list
```
Expected: `origin/main` 是 762f5a9（`git rev-parse --short origin/main`），`glm53-gateway` 是 0c406cf，`.wt-merge` 尚不存在。

- [ ] **Step 2: 建 worktree**

```bash
cd /Users/optyne/repository/b300/sell-panel
git worktree add -b merge/glm53-into-main .wt-merge origin/main
```
Expected: 輸出 `Preparing worktree (new branch 'merge/glm53-into-main')`。

- [ ] **Step 3: 執行 merge**

```bash
cd /Users/optyne/repository/b300/sell-panel/.wt-merge
git merge --no-ff --no-commit glm53-gateway
```
Expected: `CONFLICT (content): Merge conflict in app.py`，其餘自動合併。

- [ ] **Step 4: 驗證衝突只有一處**

```bash
cd /Users/optyne/repository/b300/sell-panel/.wt-merge
git diff --name-only --diff-filter=U
grep -c '^<<<<<<<' app.py
```
Expected: 第一行只印 `app.py`；第二行印 `1`。若不是，停下回報（乾跑時的前提已變）。

- [ ] **Step 5: 看衝突內容**

```bash
cd /Users/optyne/repository/b300/sell-panel/.wt-merge
sed -n '2010,2035p' app.py
```
Expected: `<<<<<<< HEAD` 側是 `record_usage(model_id, None, key_id, reserved, note="stream_aborted", pricing=pricing)`；`>>>>>>> glm53-gateway` 側是 `record_usage(model_id, captured["usage"], key_id, reserved, note="stream_aborted")`。

兩邊的語意：`origin/main` 加了 `pricing=pricing`（計費快照，6 處呼叫都有）；`glm53-gateway` 改成用 `continuous_usage_stats` 最後看到的 `captured["usage"]` 對中斷串流計費（commit 5ffe4b0，有測試 `test_aborted_stream_bills_tokens_generated_so_far` 守著）。正確的合併是**兩者都要**。先不解，下一個 Task 先寫守衛測試。

---

### Task 2: 守衛測試：中斷串流的 record_usage 必須同時帶 usage 與 pricing

**Files:**
- Modify: `sell-panel/.wt-merge/tests/test_stream_proxy.py`（方法 `test_aborted_stream_bills_tokens_generated_so_far`，約 L216-231；此檔無衝突，已是兩邊聯集）
- Modify: `sell-panel/.wt-merge/app.py:2015-2031`（解衝突）

**Interfaces:**
- Consumes: Task 1 的 worktree。
- Produces: 解完衝突、無衝突標記的 `app.py`；測試方法多一條斷言。

- [ ] **Step 1: 先把衝突暫時解成 glm53 那一側（缺 pricing），讓測試有東西可跑**

用編輯器把 `app.py` L2015-2031 的整個衝突區塊（含 `<<<<<<< HEAD`、`=======`、`>>>>>>> glm53-gateway` 三行）替換成：

```python
                    # Client hung up, or the backend died, before the final
                    # chunk. With continuous_usage_stats the last chunk we saw
                    # carries the tokens generated so far, so the aborted
                    # request is billed for what was actually produced; only
                    # when no chunk ever reported usage does it record zero.
                    record_usage(model_id, captured["usage"], key_id, reserved, note="stream_aborted")
```

```bash
cd /Users/optyne/repository/b300/sell-panel/.wt-merge
grep -c '^<<<<<<<\|^=======$\|^>>>>>>>' app.py
python3 -m py_compile app.py
```
Expected: `0`；py_compile 無輸出。

- [ ] **Step 2: 在測試加斷言**

在 `tests/test_stream_proxy.py` 的 `test_aborted_stream_bills_tokens_generated_so_far` 裡，
`self.assertEqual(kw.get("note"), "stream_aborted")` 這一行之後加：

```python
        self.assertIn("pricing", kw, "aborted streams must carry the pricing snapshot like every other record_usage call")
```

- [ ] **Step 3: 跑測試，確認它失敗**

```bash
cd /Users/optyne/repository/b300/sell-panel/.wt-merge
python3 -m unittest tests.test_stream_proxy -k aborted_stream_bills -v 2>&1 | tail -8
```
Expected: `FAIL: test_aborted_stream_bills_tokens_generated_so_far`，訊息含 `'pricing' not found`。

- [ ] **Step 4: 正式解衝突：補上 pricing**

把 Step 1 那行 `record_usage(...)` 改成：

```python
                    record_usage(model_id, captured["usage"], key_id, reserved, note="stream_aborted", pricing=pricing)
```

- [ ] **Step 5: 跑測試，確認通過**

```bash
cd /Users/optyne/repository/b300/sell-panel/.wt-merge
python3 -m unittest tests.test_stream_proxy -v 2>&1 | tail -6
```
Expected: 該檔全部 `ok`，末行 `OK`。

- [ ] **Step 6: 標記衝突已解（不要 commit，merge 還沒驗完）**

```bash
cd /Users/optyne/repository/b300/sell-panel/.wt-merge
git add app.py tests/test_stream_proxy.py
git status --short | grep -v '^M \|^A \|^D ' | head
```
Expected: 第二行無輸出（沒有 `UU` 或 `??`）。

---

### Task 3: 全量驗證 merge 結果並 commit

**Files:**
- Verify only: `sell-panel/.wt-merge/app.py`、`control.py`、`node_agent.py`、`allocctl/*.py`、`config.yaml`、`docker-compose.production.yml`、`tests/**`

**Interfaces:**
- Consumes: Task 2 的 staged merge。
- Produces: merge commit（記下 40 碼 SHA，寫到 `sell-panel/.wt-merge/docs/phase0-merge-report.md`），後續部署驗證要比對它。

- [ ] **Step 1: 編譯檢查（與 CI 相同）**

```bash
cd /Users/optyne/repository/b300/sell-panel/.wt-merge
python3 -m py_compile app.py control.py node_agent.py allocctl/*.py && echo COMPILE_OK
```
Expected: `COMPILE_OK`。

- [ ] **Step 2: 配置檔解析與關鍵條目**

```bash
cd /Users/optyne/repository/b300/sell-panel/.wt-merge
python3 - <<'EOF'
import yaml
c = yaml.safe_load(open("config.yaml"))
ids = [m["id"] for m in c["models"]]
g = next(m for m in c["models"] if m["id"] == "glm-5.3-flash-uncensored")
print("models:", len(ids))
print("glm53:", g["enabled"], g["price_prompt"], g["price_completion"], g["backend_url"])
print("nodes:", [n["name"] for n in c["nodes"]])
EOF
python3 -c "import yaml,sys;yaml.safe_load(open('docker-compose.production.yml'));print('COMPOSE_YAML_OK')"
```
Expected: `glm53: True 0.3 1.0 http://b300-tunnel:8117`（價格由兩邊共同祖先 e09dce9 設定）；`nodes:` 含 `b300-14` 與 `b300-31`；`COMPOSE_YAML_OK`。models 數記下來（預期 19，和 `.wt-glm53/config.yaml` 一樣；若不同，列出差異的 id 並確認是否來自 origin/main 的 4 個 commit）。

- [ ] **Step 3: 全量測試**

```bash
cd /Users/optyne/repository/b300/sell-panel/.wt-merge
python3 -m unittest discover -s tests -q 2>&1 | tail -4
```
Expected: `Ran N tests`，`OK`，N ≥ 628。若有 FAIL／ERROR，不准刪測試；逐條判斷是「兩邊語意衝突」還是「merge 漏了什麼」，修 `app.py` 後重跑。修了什麼寫進 Step 6 的報告。

- [ ] **Step 4: 確認 merge 沒夾帶 glm53 以外的東西**

```bash
cd /Users/optyne/repository/b300/sell-panel/.wt-merge
git diff --cached --stat | tail -1
git diff --cached --name-only | grep -v -E '^(app.py|tests/|docs/|monitoring/|scripts/|config.yaml|docker-compose.production.yml|Dockerfile|OPERATIONS.md|README.md|node_agent.py|site/|static/|web/static/embed.go)' 
```
Expected: 第一行約 `36 files changed`；第二行無輸出（乾跑時的檔案集合）。

- [ ] **Step 5: commit merge**

```bash
cd /Users/optyne/repository/b300/sell-panel/.wt-merge
git commit -m "merge: glm53-gateway into main (phase 0 branch reconciliation)

Brings the production line (website 301s, /catalog.json, node ops endpoints,
aborted-stream billing via continuous_usage_stats) onto main, which already
carried immutable billing settlement and the kv-affinity prototype.

Only conflict: the aborted-stream record_usage call in app.py. Resolved to keep
both sides: bill captured[\"usage\"] (glm53-gateway) and pass pricing=pricing
(main). Guarded by a new assertion in test_stream_proxy.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git rev-parse HEAD
git log glm53-gateway ^HEAD --oneline | wc -l
```
Expected: 最後一行 `0`（glm53-gateway 全部包含在內）。記下 `git rev-parse HEAD` 的 40 碼 SHA，下稱 `MERGE_SHA`。

- [ ] **Step 6: 寫 merge 報告**

建立 `docs/phase0-merge-report.md`（在 `.wt-merge` 內）：

```markdown
# Phase 0 merge report — glm53-gateway into main

- Date: 2026-10-08
- Merge commit: <MERGE_SHA>
- Parents: origin/main 762f5a9, glm53-gateway 0c406cf (merge-base f52a412)
- Conflicts: app.py (aborted-stream record_usage) — kept both sides, see tests/test_stream_proxy.py
- Test baseline: 628/628 on each parent; merged: <N>/<N>, 0 failed
- config.yaml: <models count> models, glm-5.3-flash-uncensored enabled, 0.30/1.00
- Extra fixes during merge: <none | list>
- Next: user pushes branch, opens PR to main, merges; then Dokploy app follows main.
```

填掉所有 `<...>`。

```bash
cd /Users/optyne/repository/b300/sell-panel/.wt-merge
git add docs/phase0-merge-report.md
git commit -m "docs: phase 0 merge report

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: 錨點抓取與比對腳本

**Files:**
- Create: `sell-panel/.wt-merge/scripts/capture_public_anchors.py`
- Create: `sell-panel/.wt-merge/tests/test_capture_public_anchors.py`

**Interfaces:**
- Produces:
  - `capture(base_url: str) -> dict` ：回 `{"catalog": <json>, "status": <json>, "openrouter_models": <json>}`。
  - `diff(before: dict, after: dict, ignore: set[str]) -> list[str]`：回 JSON 路徑字串清單，`ignore` 內的鍵名在任何深度都略過。
  - CLI：`capture_public_anchors.py capture --base https://b300.powerchampion.ai --out FILE`、
    `capture_public_anchors.py compare BEFORE AFTER [--ignore k1,k2]`，compare 有差異時 exit 1 並逐行印路徑。
- 預設忽略鍵：`uptime`、`uptime_seconds`、`ts`、`timestamp`、`generated_at`、`updated_at`、`checked_at`、`latency_ms`、`last_seen`、`incidents`。

- [ ] **Step 1: 寫失敗的測試**

`tests/test_capture_public_anchors.py`：

```python
import unittest

from scripts.capture_public_anchors import diff


class DiffTests(unittest.TestCase):
    def test_identical_is_empty(self):
        a = {"catalog": {"models": [{"id": "x", "price_prompt": 0.3}]}}
        self.assertEqual(diff(a, a, ignore=set()), [])

    def test_changed_leaf_reports_path(self):
        a = {"catalog": {"models": [{"id": "x", "price_prompt": 0.3}]}}
        b = {"catalog": {"models": [{"id": "x", "price_prompt": 0.5}]}}
        self.assertEqual(diff(a, b, ignore=set()), ["catalog.models[0].price_prompt: 0.3 -> 0.5"])

    def test_missing_and_added_keys(self):
        a = {"status": {"models": {"m1": "ready"}}}
        b = {"status": {"models": {"m2": "ready"}}}
        self.assertEqual(sorted(diff(a, b, ignore=set())),
                         ["status.models.m1: removed", "status.models.m2: added"])

    def test_ignored_keys_skipped_at_any_depth(self):
        a = {"status": {"uptime": 1, "nested": {"ts": 1, "ok": True}}}
        b = {"status": {"uptime": 2, "nested": {"ts": 2, "ok": True}}}
        self.assertEqual(diff(a, b, ignore={"uptime", "ts"}), [])

    def test_list_length_change(self):
        a = {"c": [1, 2]}
        b = {"c": [1, 2, 3]}
        self.assertEqual(diff(a, b, ignore=set()), ["c: length 2 -> 3"])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: 跑測試確認失敗**

```bash
cd /Users/optyne/repository/b300/sell-panel/.wt-merge
python3 -m unittest tests.test_capture_public_anchors 2>&1 | tail -3
```
Expected: `ModuleNotFoundError: No module named 'scripts.capture_public_anchors'`。（`scripts/` 沒有 `__init__.py`，是 namespace package；既有測試如 `tests/test_reviewer_keys.py:15` 已經這樣 `from scripts import ...`，不要新增 `__init__.py`。）

- [ ] **Step 3: 寫實作**

`scripts/capture_public_anchors.py`：

```python
#!/usr/bin/env python3
"""Capture the gateway's public numeric anchors before/after a deploy, and diff them.

Usage:
  capture_public_anchors.py capture --base https://b300.powerchampion.ai --out before.json
  capture_public_anchors.py compare before.json after.json [--ignore uptime,ts]
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.request

ENDPOINTS = {
    "catalog": "/catalog.json",
    "status": "/status.json",
    "openrouter_models": "/openrouter/models",
}
DEFAULT_IGNORE = {
    "uptime", "uptime_seconds", "ts", "timestamp", "generated_at", "updated_at",
    "checked_at", "latency_ms", "last_seen", "incidents",
}


def _get_json(url: str, timeout: float = 10.0):
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return json.load(r)


def capture(base_url: str) -> dict:
    base = base_url.rstrip("/")
    return {name: _get_json(base + path) for name, path in ENDPOINTS.items()}


def diff(before, after, ignore: set[str], path: str = "") -> list[str]:
    out: list[str] = []
    if isinstance(before, dict) and isinstance(after, dict):
        for k in sorted(set(before) | set(after)):
            if k in ignore:
                continue
            p = f"{path}.{k}" if path else str(k)
            if k not in before:
                out.append(f"{p}: added")
            elif k not in after:
                out.append(f"{p}: removed")
            else:
                out.extend(diff(before[k], after[k], ignore, p))
        return out
    if isinstance(before, list) and isinstance(after, list):
        if len(before) != len(after):
            return [f"{path}: length {len(before)} -> {len(after)}"]
        for i, (x, y) in enumerate(zip(before, after)):
            out.extend(diff(x, y, ignore, f"{path}[{i}]"))
        return out
    if before != after:
        out.append(f"{path}: {before!r} -> {after!r}")
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("capture")
    c.add_argument("--base", required=True)
    c.add_argument("--out", required=True)
    d = sub.add_parser("compare")
    d.add_argument("before")
    d.add_argument("after")
    d.add_argument("--ignore", default="")
    args = ap.parse_args(argv)

    if args.cmd == "capture":
        data = capture(args.base)
        with open(args.out, "w") as f:
            json.dump(data, f, indent=2, sort_keys=True)
        print(f"captured {len(data)} endpoints -> {args.out}")
        return 0

    ignore = set(DEFAULT_IGNORE)
    if args.ignore:
        ignore |= {s.strip() for s in args.ignore.split(",") if s.strip()}
    with open(args.before) as f:
        before = json.load(f)
    with open(args.after) as f:
        after = json.load(f)
    changes = diff(before, after, ignore)
    for line in changes:
        print(line)
    print(f"{len(changes)} difference(s)")
    return 1 if changes else 0


if __name__ == "__main__":
    sys.exit(main())
```

（這份腳本與測試已在 2026-10-08 於隔離目錄實跑過：5 tests OK。）

- [ ] **Step 4: 跑測試確認通過**

```bash
cd /Users/optyne/repository/b300/sell-panel/.wt-merge
python3 -m unittest tests.test_capture_public_anchors -v 2>&1 | tail -8
python3 -m unittest discover -s tests -q 2>&1 | tail -3
```
Expected: 5 個 `ok`；全量仍 `OK`，數字比 Task 3 Step 3 多 5。

- [ ] **Step 5: 對生產做一次實抓（唯讀，公開端點）**

```bash
cd /Users/optyne/repository/b300/sell-panel/.wt-merge
python3 scripts/capture_public_anchors.py capture --base https://b300.powerchampion.ai --out /tmp/anchors-smoke.json
python3 -c "import json;d=json.load(open('/tmp/anchors-smoke.json'));print(sorted(d), len(json.dumps(d)))"
```
Expected: `['catalog', 'openrouter_models', 'status']` 且長度 > 1000。這只是確認腳本能跑，正式的「部署前」快照在 Task 6。

- [ ] **Step 6: commit**

```bash
cd /Users/optyne/repository/b300/sell-panel/.wt-merge
git add scripts/capture_public_anchors.py tests/test_capture_public_anchors.py
git commit -m "scripts: capture and diff public gateway anchors around a deploy

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4b: 行銷站補 `/data-retention` 頁（部署閘道前的前置）

**背景（2026-10-08 執行中發現）**：生產閘道目前還自己服務 `/privacy`、`/terms`、`/data-retention`（200），
表示生產跑的是 glm53-gateway 合併 site-info **之前**的版本。合併後的 `app.py:781` `_MARKETING_REDIRECTS`
會把 `/data-retention` 301 到 `https://powerchampion.ai/data-retention`，而行銷站 `main` 沒有這頁（404）。
`/privacy`、`/terms`、`/status`、`/pricing`、`/about→/company` 的目標都存在。使用者決定：先把頁面移植到
行銷站 `main`，行銷站先部署、閘道後部署（原本記憶裡的順序）。

**Files（marketplace repo，worktree `.worktrees/data-retention-page`，分支 `phase0/data-retention-page` 從 `main` 開）：**
- Create: `app/data-retention/page.tsx`（8 行，與 `app/privacy/page.tsx` 同形，`policy="dataRetention"`，`metadataForRoute("/data-retention")`）
- Modify: `components/editorial-page.tsx:6`（`PolicyPage` 加 `"dataRetention"`）
- Modify: `lib/trust.ts`（`PolicyLocaleContent` 型別加 `dataRetention`；`POLICY_CONTENT.en` 與 `.zh` 各加 `dataRetention` 區塊；「API usage data」段落的 `b300.powerchampion.ai/data-retention` 改成本站 `/data-retention`）
- Modify: `lib/metadata.ts`（route union 加 `"/data-retention"`，entries 加 title／description）
- Modify: `lib/content.ts:12,26,38`（footer 型別與兩語系加 `dataRetention` 標籤）
- Modify: `components/site-shell.tsx:12,65-66,84`（footer policies 加 `["dataRetention", "/data-retention"]`）
- Modify: `tests/rendered-html.test.mjs:78-100`（expected metadata 加 `/data-retention`；`routes` 與 `shellDestinations` 加 `/data-retention`）
- Modify: `tests/trust-pages.test.tsx`（加一個 data-retention 頁的渲染測試）
- Modify: `public/sitemap.xml`（加 `/data-retention`；若 `npm run seo:sitemap` 會產生，就用它產生）

**內容來源**：分支 `fix/site-info-2026-09-09` 已有完整實作，用 `git show fix/site-info-2026-09-09:<檔>` 讀取
`lib/trust.ts`（`dataRetention` 區塊 en／zh）、`lib/metadata.ts`（`/data-retention` 的 title／description）、
`tests/legal-pages.test.tsx`（可參考的測試）。**只搬 data-retention 相關的部分**，不要把該分支的其他改動
（related-links nav、metadata 重構）帶進來；該分支與 main 已分叉 19 個 commit。

**Interfaces:**
- Produces: `https://powerchampion.ai/data-retention` 部署後 200，title 含 `Data retention`（en）；footer Policies 群組有連結；
  `/trust` 頁的「API usage data」段落連到 `/data-retention`。

- [ ] **Step 1: 建 worktree**

```bash
cd /Users/optyne/repository/b300/sell-panel/powerchampion-marketplace
git status --short | head -3
git worktree add -b phase0/data-retention-page .worktrees/data-retention-page main
cd .worktrees/data-retention-page && npm ci --silent 2>&1 | tail -2
```
Expected: worktree 建立；`npm ci` 無錯誤（Node ≥ 22.13）。

- [ ] **Step 2: 先寫失敗的測試**

(a) `tests/rendered-html.test.mjs`：在 `expected` 物件（L78-90 附近）加：
```js
  "/data-retention": {
    title: "Data retention | Power Champion",
    description: "<從 git show fix/site-info-2026-09-09:lib/metadata.ts 取 /data-retention 的 description，原文照抄>",
  },
```
並在 `routes` 與 `shellDestinations` 兩個陣列各加 `"/data-retention"`。

(b) `tests/trust-pages.test.tsx`：仿照該檔既有的 privacy／terms 渲染測試，加：
```tsx
it("renders the data retention policy", () => {
  render(<EditorialPage policy="dataRetention" />);
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/data retention/i);
});
```
（import 與 render 工具照該檔既有寫法。若該檔沒有 privacy 的同形測試，就照 `tests/components.test.tsx` 的渲染慣例。）

```bash
cd /Users/optyne/repository/b300/sell-panel/powerchampion-marketplace/.worktrees/data-retention-page
npx vitest run tests/trust-pages.test.tsx 2>&1 | tail -8
```
Expected: FAIL，型別或執行期錯誤指出 `dataRetention` 不存在。

- [ ] **Step 3: 實作**

依上方 Files 清單逐檔改。`lib/trust.ts` 的 `dataRetention` 內容：

```bash
git show fix/site-info-2026-09-09:lib/trust.ts | grep -n 'dataRetention' 
```
找到 en 與 zh 兩個區塊，整塊複製進 main 版 `POLICY_CONTENT` 對應語系的 `terms:` 之後。若該區塊引用了 main 沒有的欄位
（例如 `meta`、`related`），刪掉那些欄位，只保留 `title`、`intro`／`sections` 等 main 的 `PolicyLocaleContent` 已有的欄位。

- [ ] **Step 4: 驗證**

```bash
cd /Users/optyne/repository/b300/sell-panel/powerchampion-marketplace/.worktrees/data-retention-page
npx tsc --noEmit 2>&1 | tail -5
npm run lint 2>&1 | tail -5
npm test 2>&1 | tail -15
```
Expected: tsc 無錯誤；lint 無錯誤；`npm test`（vitest ＋ build ＋ rendered-html）全綠，rendered-html 的輸出含 `/data-retention`。

- [ ] **Step 5: 本地實跑確認 200**

```bash
cd /Users/optyne/repository/b300/sell-panel/powerchampion-marketplace/.worktrees/data-retention-page
(PORT=3977 npm run start >/tmp/dr-start.log 2>&1 &) ; sleep 8
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3977/data-retention
curl -s http://localhost:3977/data-retention | grep -o '<title>[^<]*</title>'
curl -s http://localhost:3977/trust | grep -o 'href="/data-retention"' | head -1
pkill -f "vinext[ ]start" || true
```
Expected: `200`；`<title>Data retention | Power Champion</title>`；`href="/data-retention"`。
（若 `vinext start` 不吃 `PORT`，看 `package.json` 的 start 與 `/tmp/dr-start.log` 找正確的埠或旗標。）

- [ ] **Step 6: commit**

```bash
cd /Users/optyne/repository/b300/sell-panel/powerchampion-marketplace/.worktrees/data-retention-page
git add app/data-retention/page.tsx components/editorial-page.tsx lib/trust.ts lib/metadata.ts lib/content.ts components/site-shell.tsx tests/rendered-html.test.mjs tests/trust-pages.test.tsx public/sitemap.xml
git commit -m "feat(legal): add /data-retention page so the gateway 301 lands on content

The gateway (phase 0 merge) redirects b300.powerchampion.ai/data-retention here.
Content ported from fix/site-info-2026-09-09; footer and /trust now link locally.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

**【使用者執行】** push 分支、開 PR 到 marketplace `main`、merge → Dokploy 自動部署行銷站。agent 驗證：
`curl -s -o /dev/null -w '%{http_code}' https://powerchampion.ai/data-retention` 回 `200` 之後，Task 7 才能部署閘道。

---

### Task 5: 【使用者執行】push、PR、merge 進 main

**Files:** 無（遠端操作）。

**Interfaces:**
- Consumes: 分支 `merge/glm53-into-main`，HEAD 為 Task 4 的 commit。
- Produces: `origin/main` 包含 `MERGE_SHA`。

- [ ] **Step 1: agent 停下，把以下指令交給使用者**

```bash
cd /Users/optyne/repository/b300/sell-panel/.wt-merge && git push -u origin merge/glm53-into-main
```

```bash
cd /Users/optyne/repository/b300/sell-panel/.wt-merge && gh pr create --base main --head merge/glm53-into-main --title "merge: glm53-gateway into main (phase 0)" --body-file docs/phase0-merge-report.md
```

PR 要用 **merge commit**（不要 squash、不要 rebase），否則 `MERGE_SHA` 會變、`git log glm53-gateway ^main` 不會是空的。CI（`.github/workflows/ci.yml`）綠了再 merge。

- [ ] **Step 2: 使用者回報 merge 完成後，agent 驗證**

```bash
cd /Users/optyne/repository/b300/sell-panel
git fetch origin --prune
git log glm53-gateway ^origin/main --oneline | wc -l
git merge-base --is-ancestor <MERGE_SHA> origin/main && echo MERGE_ON_MAIN
```
Expected: `0` 與 `MERGE_ON_MAIN`。

---

### Task 6: 部署前快照與 Dokploy 前置確認

**Files:**
- Create: `sell-panel/.wt-merge/docs/deploy/anchors-phase0-before.json`

**Interfaces:**
- Produces: 部署前的錨點檔，Task 7 用來比對。

- [ ] **Step 1: 抓部署前快照**

```bash
cd /Users/optyne/repository/b300/sell-panel/.wt-merge
mkdir -p docs/deploy
python3 scripts/capture_public_anchors.py capture --base https://b300.powerchampion.ai --out docs/deploy/anchors-phase0-before.json
python3 - <<'EOF'
import json
d = json.load(open("docs/deploy/anchors-phase0-before.json"))
cat = d["catalog"]
models = cat.get("models", cat) if isinstance(cat, dict) else cat
ids = [m.get("id") for m in models] if isinstance(models, list) else list(models)
print("catalog ids:", len(ids), sorted(i for i in ids if i))
print("status keys:", sorted(d["status"])[:12])
EOF
```
Expected: 列出 id 清單，含 `glm-5.3-flash-uncensored`。把這兩行輸出貼進回報。

- [ ] **Step 2: 【使用者執行】Dokploy 前置確認（agent 列出清單，使用者在 Dokploy UI 看）**

請使用者確認三件事並回報：
1. `b300-sell-panel`（Dokploy 內部名 `b300-selling-platform-f6nfqr`）目前追的 branch 是什麼；要改成 `main`。
2. 該 app 的 **Patch** 功能有沒有啟用中的覆蓋（尤其 `config.yaml`、`docker-compose.production.yml`）。有的話，部署後映像裡的檔案會是 patch 內容而不是 git 的（LESSONS 2026-08-05）。本期**不**改 patch 內容，但要知道它在。
3. 記下目前映像：`docker images b300-sell-panel --format '{{.ID}} {{.CreatedAt}}'`（在 Dokploy 主機上執行），這是回滾點。

agent 把三個答案寫進 Task 7 的報告。

---

### Task 7: 【使用者執行】部署，agent 驗證

**Files:**
- Create: `sell-panel/.wt-merge/docs/deploy/anchors-phase0-after.json`
- Create: `sell-panel/.wt-merge/docs/deploy/phase0-deploy-verification.md`

**Interfaces:**
- Consumes: Task 6 的 before 快照、Task 5 的 `MERGE_SHA`。

- [ ] **Step 1: 【使用者執行】在 Dokploy 把 branch 改成 `main` 並觸發部署**

部署會用 `RELEASE_REVISION=<commit>` 建映像，`scripts/verify_deployed_container.py` 會在主機上確認容器標籤等於該 commit 且 `/health` 健康。等 Dokploy 顯示 done。

- [ ] **Step 2: agent 等待並確認部署真的發生了**

```bash
for i in $(seq 1 30); do
  R=$(curl -s -m 5 https://b300.powerchampion.ai/health || true)
  echo "$R" | grep -q '"ok"\|"status"' && break
  sleep 10
done
curl -s -m 5 https://b300.powerchampion.ai/health
```
Expected: `/health` 回 200 的 JSON。這條本來就會過，所以**不是**驗證；驗證在 Step 3。

- [ ] **Step 3: 【使用者執行】在 Dokploy 主機確認映像 revision**

```bash
docker inspect b300-sell-panel --format '{{index .Config.Labels "org.opencontainers.image.revision"}}'
```
Expected: 等於 `MERGE_SHA`（40 碼）。這是「部署真的是合併後的 commit」的唯一直接證據。若不等於，停下。

- [ ] **Step 4: agent 抓部署後快照並比對**

```bash
cd /Users/optyne/repository/b300/sell-panel/.wt-merge
python3 scripts/capture_public_anchors.py capture --base https://b300.powerchampion.ai --out docs/deploy/anchors-phase0-after.json
python3 scripts/capture_public_anchors.py compare docs/deploy/anchors-phase0-before.json docs/deploy/anchors-phase0-after.json; echo "exit=$?"
```
Expected: **會有差異**，因為生產目前跑的是 glm53-gateway 合併 site-info 之前的版本（2026-10-08 實測：`/catalog.json` 401、`/privacy` 200）。至少預期 `catalog` 從 `{"_http_status": 401}` 變成完整目錄。**每一條**差異都要能歸因到 (a) `origin/main` 比 `glm53-gateway` 多的 4 個 commit 之一（762f5a9、53d02fb、8c017ea、70f7103），或 (b) glm53-gateway 上尚未部署的 commit（`git log --oneline 5ffe4b0^..0c406cf`，17 個）；用 `git -C /Users/optyne/repository/b300/sell-panel show <sha> --stat` 與 `git show <sha> -- config.yaml` 找證據。歸因不了的差異 = 倒退，進 Step 7 回滾。

- [ ] **Step 5: 確認 GLM-5.3 仍 ready 且節點操作鏈仍通**

```bash
python3 - <<'EOF'
import json
d = json.load(open("/Users/optyne/repository/b300/sell-panel/.wt-merge/docs/deploy/anchors-phase0-after.json"))
s = json.dumps(d["status"])
print("glm53 in status:", "glm-5.3-flash-uncensored" in s)
EOF
```
Expected: `True`。

【使用者執行】（需要 admin token，agent 不持有）：

```bash
curl -s -m 20 -X POST -H "X-Admin-Token: $SELL_PANEL_ADMIN_TOKEN" https://b300.powerchampion.ai/api/nodes/b300-14/ops/check
```
Expected: 回 JSON 含 job id，且後續 `GET /api/nodes/b300-14/jobs/<id>` 狀態為成功。使用者回報結果。

- [ ] **Step 6: 一筆真實推論請求**

【使用者執行】（需要一把有效客戶 key）：

```bash
curl -s -m 60 https://b300.powerchampion.ai/v1/chat/completions -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d '{"model":"glm-5.3-flash-uncensored","messages":[{"role":"user","content":"ping"}],"max_tokens":5}'
```
Expected: 200，JSON 含 `choices`。

- [ ] **Step 7: 若任一步失敗：回滾**

【使用者執行】在 Dokploy 把 branch 改回 `glm53-gateway`（或 redeploy 前一個 commit），Dokploy 會從原始碼重建；或按 `docs/prod-ops-runbook.md` §4 用 Task 6 記下的映像 ID `up -d`。回滾後重跑 Step 4，差異應回到 0。

- [ ] **Step 8: 寫驗證報告並 commit**

`docs/deploy/phase0-deploy-verification.md`：

```markdown
# Phase 0 deploy verification

- Date: <YYYY-MM-DD HH:MM>
- Deployed revision (container label): <sha>  == MERGE_SHA: <yes/no>
- Dokploy branch before/after: <glm53-gateway> -> <main>
- Dokploy patches active: <none | list>
- Rollback image recorded: <image id>
- Anchor diff: <0 differences | list, each with attributed commit>
- glm-5.3-flash-uncensored in status: <yes/no>
- /api/nodes/b300-14/ops/check: <job id, result>
- Real chat completion: <200 | error>
- Result: PASS / ROLLED BACK (<reason>)
```

```bash
cd /Users/optyne/repository/b300/sell-panel/.wt-merge
git add docs/deploy/anchors-phase0-before.json docs/deploy/anchors-phase0-after.json docs/deploy/phase0-deploy-verification.md
git commit -m "docs: phase 0 deploy verification with anchor snapshots

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

這個 commit 在 `merge/glm53-into-main` 分支上，但 PR 已 merge；由使用者決定另開一個小 PR 或直接 push 到 main。agent 只回報路徑。

---

### Task 8: 收尾：worktree、專案守則、記憶

**Files:**
- Remove: `sell-panel/.wt-glm53/`、`sell-panel/.wt-siteinfo/`（worktree 目錄；**分支保留**）
- Modify: `b300/CLAUDE.md`（「版控狀態」段與驗證方式段）
- Modify: `~/.claude/projects/-Users-optyne-repository-b300/memory/website-info-2026-09.md`

**Interfaces:** 無。

- [ ] **Step 1: 確認兩個 worktree 都沒有未提交的工作**

```bash
cd /Users/optyne/repository/b300/sell-panel
git -C .wt-glm53 status --short
git -C .wt-siteinfo status --short
```
Expected: `.wt-glm53` 只有 `?? .superpowers-siteinfo-merge-report.md`（未追蹤的報告，先 `cp` 到 `docs/` 再移除 worktree）；`.wt-siteinfo` 無輸出。有其他輸出就停下回報。

- [ ] **Step 2: 保存報告並移除 worktree**

```bash
cd /Users/optyne/repository/b300/sell-panel
cp .wt-glm53/.superpowers-siteinfo-merge-report.md .wt-merge/docs/siteinfo-merge-report-2026-09.md
git worktree remove .wt-glm53
git worktree remove .wt-siteinfo
git worktree list
```
Expected: 清單裡不再有 `.wt-glm53`、`.wt-siteinfo`；`.wt-merge` 仍在。

- [ ] **Step 3: 更新專案 CLAUDE.md**

`/Users/optyne/repository/b300/CLAUDE.md`：
- 「高風險事實」第 1 點後加一句：`生產分支自 2026-10-xx 起是 main（第 0 期合併 glm53-gateway，merge <MERGE_SHA 前 7 碼>）；glm53-gateway 與 fix/site-info-2026-09-09 已合入，不要再在它們上面改。`
- 「驗證方式」的測試數 `226` 改為 `628+`，並加註 `<!-- 2026-10-xx 更新：第 0 期合併後實測 -->`。

改前備份（b300/ 根目錄不是 git）：

```bash
F=/Users/optyne/repository/b300/CLAUDE.md; [ -e "$F.bak-$(date +%Y%m%d)" ] || cp "$F" "$F.bak-$(date +%Y%m%d)"
```

- [ ] **Step 4: 更新記憶**

在 `website-info-2026-09.md` 的「生產分支」段落後加一行：`2026-10-xx 第 0 期已把 glm53-gateway 合進 main，生產改追 main；兩個 worktree 已移除。`

- [ ] **Step 5: 回報**

回報內容：`MERGE_SHA`、測試數、錨點 diff 結果、驗證報告路徑、CLAUDE.md 的 diff。第 0 期完成的定義是 spec §4 四條驗收全部有證據。

---

## 自我檢查（寫完計畫後對照 spec §4）

- `git log glm53-gateway ^origin/main` 為空 → Task 5 Step 2。
- 0 failed、≥ max(628, 628) → Task 3 Step 3、Task 4 Step 4。
- 生產映像 revision 等於合併 commit → Task 7 Step 3。
- 錨點差異只能歸因到 origin/main 多的 4 個 commit；GLM-5.3 仍 ready；`ops/check` 仍通 → Task 7 Step 4、5。
- Patch 覆蓋層檢查 → Task 6 Step 2。
- Dokploy 改追 `main` → Task 7 Step 1。
