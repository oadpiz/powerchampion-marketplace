import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminPortal } from "../components/admin-portal";
import { AdminShell } from "../components/admin-shell";
import { engineerActivityText, engineerKeyStatusText } from "../lib/portal-client";
import { adminFetch, wrap } from "./support/admin-fetch";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

const GIB = 2 ** 30;
const SYNCED_TITLE_EN = "Synced = an export was marked after the key changed; the nodes were not checked one by one";
const SYNCED_TITLE_ZH = "已同步＝在金鑰變更後已標記匯出，並未逐台驗證節點";

const node = (name: string, extra: Record<string, unknown> = {}) => ({
  name, up: true, gpuCount: 8, collector: "ok", labelEngineer: "justin", labelMatches: true,
  gpusInUse: 0, processes: 0, memoryBytes: 0, lastLoginAt: null, sessions: 0, ...extra,
});
const engineer = (username: string, clusterId: string, extra: Record<string, unknown> = {}) => ({
  id: `id-${username}`, clusterId, username, displayName: username[0].toUpperCase() + username.slice(1), active: true,
  keyStatus: "missing", keyFingerprint: null, keyType: null,
  grafanaUrl: `https://grafana.powerchampion.ai/d/b300-engineers?var-engineer=${username}&from=now-24h&to=now`,
  lastLoginAt: null, loggedIn: false, gpusInUse: 0, memoryBytes: 0, nodes: [], alerts: [], deploys: [], ...extra,
});
const overview = (extra: Record<string, unknown> = {}, activity: Record<string, unknown> = {}) => ({
  gatewayConfigured: true,
  activity: { status: "ok", stale: false, generatedAt: "2026-10-22T03:11:21Z", ageSeconds: 3.1, errors: {}, error: null, truncated: false, ...activity },
  lastExport: { revision: 7, at: "2026-10-21T10:00:00Z" },
  engineers: [
    engineer("justin", "eng1", {
      keyStatus: "synced", keyFingerprint: "SHA256:abc", keyType: "ssh-ed25519", lastLoginAt: "2026-10-21T11:30:00Z", loggedIn: true,
      gpusInUse: 2, memoryBytes: 80 * GIB,
      nodes: [node("b300-11", { gpusInUse: 2, processes: 3, memoryBytes: 80 * GIB, lastLoginAt: "2026-10-21T11:30:00Z", sessions: 1 }),
        node("b300-12", { labelEngineer: "mwind", labelMatches: false }), node("b300-13", { collector: "failed" })],
      alerts: [{ alertname: "GpuHeldIdle", severity: "warning", node: "b300-11", gpu: "3", mountpoint: null, username: "justin",
        since: "2026-10-21T09:00:00Z", reason: "user" }],
      deploys: [{ id: 12, at: "2026-10-21T08:00:00Z", node: "b300-11", user: "justin", verified: true, model: "qwen3-8b", port: 8000, text: "deployed qwen3 8B" }],
    }),
    engineer("mwind", "eng2", { keyStatus: "pending" }),
    engineer("zhuling", "eng3"),
    engineer("nati", "eng4", { gpusInUse: null, memoryBytes: null }),
    engineer("ll", "eng5", { active: false }),
  ],
  unmatched: { gpuUsage: [], logins: [], alerts: [], deploys: [] },
  ...extra,
});

async function renderWith(body: unknown) {
  const calls = adminFetch({ "GET /admin/engineers": body });
  wrap(<AdminPortal section="engineers" />);
  const table = await screen.findByRole("table", { name: /^(Engineers|工程師)$/ });
  return { calls, table };
}

const rowOf = (table: HTMLElement, username: string) =>
  within(table).getByText(`@${username}`).closest("tr") as HTMLElement;

describe("admin engineers section", () => {
  it("renders roster and per-node usage", async () => {
    const user = userEvent.setup();
    const { calls, table } = await renderWith(overview());
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Engineers");
    expect(calls.filter((call) => call.path === "/admin/engineers")).toEqual([{ method: "GET", path: "/admin/engineers", body: undefined }]);
    const justin = rowOf(table, "justin");
    expect(within(justin).getByText("2 GPUs · 80.0 GiB")).toBeVisible();
    expect(within(justin).getByText("Synced")).toBeVisible();
    expect(within(justin).getByText("Online")).toBeVisible();
    expect(within(justin).getByLabelText("1 alerts")).toHaveClass("admin-badge-alert");
    expect(within(rowOf(table, "mwind")).getByText("Pending sync")).toBeVisible();
    expect(within(rowOf(table, "zhuling")).getByText("Not provided")).toBeVisible();
    // GPU column: 0 is a real zero, null (no data) is a dash.
    expect(rowOf(table, "zhuling").querySelectorAll("td")[4]).toHaveTextContent(/^0$/);
    expect(rowOf(table, "nati").querySelectorAll("td")[4]).toHaveTextContent(/^—$/);
    expect(screen.getByText(/Data as of .* \(3\.1 s ago\)/)).toBeVisible();
    const details = screen.getByText("Justin: nodes and events");
    const nodes = screen.getByRole("table", { name: "Nodes of justin" });
    expect(nodes).not.toBeVisible();
    await user.click(details);
    expect(nodes).toBeVisible();
    expect(within(nodes).getByText("b300-11")).toBeVisible();
    expect(within(nodes).getByText("80.0 GiB")).toBeVisible();
    expect(within(nodes).getByText("Monitoring label differs from the allocation (export not applied yet?)")).toBeVisible();
    expect(within(nodes).getByText("failed")).toBeVisible();
    const alerts = screen.getByRole("table", { name: "Alerts for justin" });
    expect(within(alerts).getByText("GpuHeldIdle")).toBeVisible();
    expect(within(alerts).getByText("Their own process")).toBeVisible();
    expect(within(screen.getByRole("table", { name: "Deploy marks of justin" })).getByText("deployed qwen3 8B")).toBeVisible();
  });

  it("greys out deactivated engineers", async () => {
    const { table } = await renderWith(overview());
    const ll = rowOf(table, "ll");
    expect(within(ll).getByText("Deactivated")).toBeVisible();
    expect(ll.closest("tbody")).toHaveClass("admin-engineer-inactive");
    expect(rowOf(table, "justin").closest("tbody")).not.toHaveClass("admin-engineer-inactive");
  });

  it("explains the key status with the exact tooltip wording", async () => {
    const { table } = await renderWith(overview());
    expect(within(rowOf(table, "justin")).getByText("Synced")).toHaveAttribute("title", SYNCED_TITLE_EN);
    expect(engineerKeyStatusText("synced", "zh")).toEqual({ label: "已同步", title: SYNCED_TITLE_ZH });
    expect(engineerKeyStatusText("pending", "zh").label).toBe("待同步");
    expect(engineerKeyStatusText("missing", "zh").label).toBe("未提供");
  });

  it("shows gateway-not-connected but keeps roster", async () => {
    const { table } = await renderWith(overview({ gatewayConfigured: false },
      { status: "gateway_unconfigured", generatedAt: null, ageSeconds: null }));
    expect(screen.getByText(/Gateway not connected/)).toBeVisible();
    expect(within(table).getAllByText(/^@/)).toHaveLength(5);
    expect(screen.queryByText(/Data as of/)).not.toBeInTheDocument();
  });

  it.each([
    ["auth_failed", {}, "Grafana rejected the read token (expired or revoked)", "grafana_auth_failed"],
    ["unavailable", {}, "Monitoring data is unavailable right now", "monitoring_unavailable"],
    ["gateway_outdated", {}, "The gateway does not support engineer activity yet (deploy the gateway first)", null],
    ["gateway_error", { error: "gateway_auth_failed" }, "Engineer activity could not be loaded from the gateway", "gateway_auth_failed"],
    ["unconfigured", {}, "The gateway has no Grafana read token yet (B300_GRAFANA_READ_TOKEN), so the activity columns are empty.", null],
    ["ok", { stale: true, ageSeconds: 320 }, "Showing data from 320 s ago", null],
    ["ok", { stale: true, ageSeconds: 120, errors: { annotations: "timeout" } }, "Showing data from 120 s ago; monitoring is unreachable right now", "timeout"],
    ["ok", { truncated: true }, "Too much data; the lists were truncated", null],
    ["partial", { errors: { prometheus: "http_5xx", annotations: "timeout" } }, "Some monitoring data is unavailable: GPU usage, logins and alerts", "http_5xx"],
  ])("shows the %s state %o and keeps the roster", async (status, extra, message, code) => {
    const { table } = await renderWith(overview({}, { status, ...extra }));
    expect(screen.getByText(message, { exact: false })).toBeVisible();
    if (code) expect(screen.getAllByRole("alert").map((node) => node.querySelector("code")?.textContent)).toContain(code);
    expect(within(table).getAllByText(/^@/)).toHaveLength(5);
  });

  it.each([
    ["en", "Showing data from 90 s ago; monitoring is unreachable right now", "The latest refresh failed: GPU usage, logins and alerts"],
    ["zh", "顯示 90 秒前的資料，監控目前連不到", "最近一次更新失敗：GPU 用量、登入與告警"],
  ])("warns about stale data with its age and error code even when the status is ok (%s)", async (locale, note, message) => {
    localStorage.setItem("pc-locale", locale);
    window.history.replaceState({}, "", "/admin/engineers");
    const { table } = await renderWith(overview({}, { status: "ok", stale: true, ageSeconds: 90, errors: { prometheus: "http_401" } }));
    await waitFor(() => expect(screen.getByText(note)).toBeVisible());
    const alert = screen.getByText(message, { exact: false }).closest("[role=alert]") as HTMLElement;
    expect(within(alert).getByText("http_401")).toBeVisible();
    expect(within(rowOf(table, "justin")).getByText(locale === "zh" ? "2 張 · 80.0 GiB" : "2 GPUs · 80.0 GiB")).toBeVisible();
  });

  it("shows no data rather than none when a monitoring source failed", async () => {
    const user = userEvent.setup();
    const body = overview({}, { status: "partial", errors: { prometheus: "http_5xx", annotations: "timeout" } });
    (body.engineers[1] as Record<string, unknown>).gpusInUse = null;
    const { table } = await renderWith(body);
    const mwind = rowOf(table, "mwind");
    expect(within(mwind).queryByLabelText("0 alerts")).toBeNull();
    expect(mwind.querySelectorAll("td")[5]).toHaveTextContent(/^—$/);
    const summary = screen.getByText("Mwind: nodes and events");
    await user.click(summary);
    const details = summary.closest("details") as HTMLElement;
    expect(within(details).getByText("Alert data is unavailable right now.")).toBeVisible();
    expect(within(details).getByText("Deploy marks are unavailable right now.")).toBeVisible();
    expect(screen.getByText("Some monitoring data is unavailable: deploy marks", { exact: false })).toBeVisible();
  });

  it("renders deploy text as text", async () => {
    const user = userEvent.setup();
    const body = overview();
    (body.engineers[0].deploys as Record<string, unknown>[])[0].text = "<img src=x onerror=alert(1)>";
    await renderWith(body);
    await user.click(screen.getByText("Justin: nodes and events"));
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeVisible();
    expect(document.querySelector("img[src='x']")).toBeNull();
  });

  it("links to Grafana in a new tab and hides the link without a url", async () => {
    const body = overview();
    (body.engineers[1] as Record<string, unknown>).grafanaUrl = null;
    const { table } = await renderWith(body);
    const link = within(rowOf(table, "justin")).getByRole("link", { name: "Open Grafana for justin" });
    expect(link).toHaveAttribute("href", "https://grafana.powerchampion.ai/d/b300-engineers?var-engineer=justin&from=now-24h&to=now");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(within(rowOf(table, "mwind")).queryByRole("link")).toBeNull();
  });

  it("never renders command history or addresses, even if a payload carried them", async () => {
    const body = overview();
    const justin = body.engineers[0] as Record<string, unknown>;
    justin.ip = "172.16.10.11";
    justin.cmd = "python -m vllm serve --api-key sk-secret";
    (justin.nodes as Record<string, unknown>[])[0].host = "203.0.113.7";
    await renderWith(body);
    expect(screen.getByText("sudo b300-activity")).toBeVisible();
    expect(screen.getByText(/Read-only\. Command history stays on the nodes/)).toBeVisible();
    for (const needle of ["172.16.10", "203.0.113.7", "vllm", "sk-secret"]) expect(document.body.textContent).not.toContain(needle);
  });

  it("hides the unmatched section when empty and lists it otherwise", async () => {
    await renderWith(overview());
    expect(screen.queryByText("Unmatched data")).not.toBeInTheDocument();
  });

  it("lists unmatched data", async () => {
    const user = userEvent.setup();
    await renderWith(overview({
      unmatched: {
        gpuUsage: [{ node: "b300-11", username: "tku", gpus: 1, processes: 1, memoryBytes: GIB }],
        logins: [{ node: "b300-11", username: "root", lastLoginAt: "2026-10-20T00:00:00Z", sessions: 0 }],
        alerts: [{ alertname: "EngineerNodeDown", severity: "critical", node: "b300-99", gpu: null, mountpoint: null, username: null, since: null }],
        deploys: [{ id: 13, at: "2026-10-21T08:00:00Z", node: "b300-11", owner: "eng9", user: "someone", verified: false, model: null, port: null, text: "x" }],
      },
    }));
    await user.click(screen.getByText("Unmatched data"));
    expect(within(screen.getByRole("table", { name: "Users not on the roster (GPU)" })).getByText("tku")).toBeVisible();
    expect(within(screen.getByRole("table", { name: "Users not on the roster (logins)" })).getByText("root")).toBeVisible();
    expect(within(screen.getByRole("table", { name: "Alerts on unassigned nodes" })).getByText("b300-99")).toBeVisible();
    const deploys = screen.getByRole("table", { name: "Deploys with no matching engineer" });
    expect(within(deploys).getByText("eng9")).toBeVisible();
    expect(within(deploys).getByText("Unverified")).toBeVisible();
  });

  it("speaks Traditional Chinese", async () => {
    localStorage.setItem("pc-locale", "zh");
    window.history.replaceState({}, "", "/admin/engineers");
    const { table } = await renderWith(overview());
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("工程師"));
    const justin = rowOf(await screen.findByRole("table", { name: "工程師" }), "justin");
    expect(within(justin).getByText("2 張 · 80.0 GiB")).toBeVisible();
    expect(within(justin).getByText("已同步")).toHaveAttribute("title", SYNCED_TITLE_ZH);
    expect(within(justin).getByText("在線")).toBeVisible();
    expect(screen.getByText("Justin 的節點與事件")).toBeVisible();
    expect(screen.getByText(/唯讀。指令紀錄不在網頁上，請在節點上執行/)).toBeVisible();
    expect(table).toBeDefined();
    expect(engineerActivityText("auth_failed", "zh")).toBe("Grafana 讀取權杖被拒（過期或已撤銷）");
    expect(engineerActivityText("unavailable", "zh")).toBe("監控資料暫時無法取得");
    expect(engineerActivityText("gateway_outdated", "zh")).toBe("閘道版本尚未支援工程師活動（請先部署閘道）");
    expect(engineerActivityText("unconfigured", "zh")).toBe("閘道尚未設定 Grafana 讀取權杖（B300_GRAFANA_READ_TOKEN），活動欄位暫無資料。");
    expect(engineerActivityText("ok", "zh")).toBeNull();
  });

  it.each([
    ["en", ["Overview", "Customers", "API keys", "Redeem codes", "Usage", "Gateway", "Personas", "Node allocation", "Engineers", "Credit requests", "Audit log"]],
    ["zh", ["總覽", "客戶", "金鑰", "兌換碼", "用量", "閘道", "人設", "機台分配", "工程師", "儲值申請", "操作紀錄"]],
  ])("puts Engineers right after Node allocation in the %s navigation", async (locale, labels) => {
    localStorage.setItem("pc-locale", locale);
    window.history.replaceState({}, "", "/admin/engineers");
    wrap(<AdminShell pathname="/admin/engineers"><p>content</p></AdminShell>);
    const nav = screen.getByRole("navigation");
    await waitFor(() => expect(within(nav).getAllByRole("link").map((link) => link.textContent)).toEqual(labels));
    expect(within(nav).getByRole("link", { name: labels[8] })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: labels[8] })).toHaveAttribute("href", "/admin/engineers");
  });
});
