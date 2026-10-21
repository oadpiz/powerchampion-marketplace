"use client";

import { engineerActivityText, engineerKeyStatusText } from "../lib/portal-client";
import { BlockError } from "./admin-gateway-panels";
import { GatewayNotConnected, ResourceState, dateLabel, usePortalResource } from "./admin-resource";
import { useLocale } from "./locale-provider";

type ActivityStatus =
  | "ok"
  | "partial"
  | "unconfigured"
  | "auth_failed"
  | "unavailable"
  | "gateway_unconfigured"
  | "gateway_outdated"
  | "gateway_error";
type EngineerNode = {
  name: string;
  up: boolean | null;
  gpuCount: number | null;
  collector: "ok" | "stale" | "failed" | null;
  labelEngineer: string | null;
  labelMatches: boolean | null;
  gpusInUse: number | null;
  processes: number | null;
  memoryBytes: number | null;
  lastLoginAt: string | null;
  sessions: number | null;
};
type EngineerAlert = {
  alertname: string;
  severity: string;
  node: string | null;
  gpu: string | null;
  mountpoint: string | null;
  username: string | null;
  since: string | null;
  reason?: "user" | "node";
};
type EngineerDeploy = {
  id: number | null;
  at: string | null;
  node: string | null;
  owner?: string | null;
  user: string | null;
  verified: boolean;
  model: string | null;
  port: number | null;
  text: string;
};
type Engineer = {
  id: string;
  clusterId: string;
  username: string;
  displayName: string;
  active: boolean;
  keyStatus: "synced" | "pending" | "missing";
  keyFingerprint: string | null;
  keyType: string | null;
  grafanaUrl: string | null;
  lastLoginAt: string | null;
  loggedIn: boolean | null;
  gpusInUse: number | null;
  memoryBytes: number | null;
  nodes: EngineerNode[];
  alerts: EngineerAlert[];
  deploys: EngineerDeploy[];
};
type UsageRow = { node: string; username: string; gpus: number | null; processes: number | null; memoryBytes: number | null };
type LoginRow = { node: string; username: string; lastLoginAt: string | null; sessions: number | null };
export type EngineersOverview = {
  gatewayConfigured: boolean;
  activity: {
    status: ActivityStatus;
    stale: boolean;
    generatedAt: string | null;
    ageSeconds: number | null;
    errors: Record<string, string>;
    error: string | null;
    truncated: boolean;
  };
  lastExport: { revision: number; at: string | null } | null;
  engineers: Engineer[];
  unmatched: { gpuUsage: UsageRow[]; logins: LoginRow[]; alerts: EngineerAlert[]; deploys: EngineerDeploy[] };
};

/** null is "no data" (—); 0 is a real zero. */
export function memoryLabel(bytes: number | null): string {
  if (bytes === null || bytes === undefined) return "—";
  if (bytes === 0) return "0";
  return (bytes / 2 ** 30).toFixed(1) + " GiB";
}

const value = (item: number | string | null | undefined): string => (item === null || item === undefined ? "—" : String(item));

function gpuLabel(gpus: number | null, bytes: number | null, zh: boolean): string {
  if (gpus === null) return "—";
  if (gpus === 0) return "0";
  const count = zh ? `${gpus} 張` : `${gpus} ${gpus === 1 ? "GPU" : "GPUs"}`;
  return bytes === null ? count : `${count} · ${memoryLabel(bytes)}`;
}

const activityUsable = (status: ActivityStatus) => status === "ok" || status === "partial";

/** Whether a source's data arrived (or older data is being shown), so an empty list really means "none". */
function sourceKnown(activity: EngineersOverview["activity"], source: "prometheus" | "annotations") {
  return activityUsable(activity.status) && (activity.stale || !activity.errors[source]);
}

function StatusArea({ data, zh }: { data: EngineersOverview; zh: boolean }) {
  const { activity } = data;
  const locale = zh ? "zh" : "en";
  const text = engineerActivityText(activity.status, locale) ?? "";
  const sources: Record<string, string> = activity.stale
    ? zh
      ? { prometheus: "最近一次更新失敗：GPU 用量、登入與告警", annotations: "最近一次更新失敗：部署標記" }
      : { prometheus: "The latest refresh failed: GPU usage, logins and alerts", annotations: "The latest refresh failed: deploy marks" }
    : zh
      ? { prometheus: "部分監控資料無法取得：GPU 用量、登入與告警", annotations: "部分監控資料無法取得：部署標記" }
      : { prometheus: "Some monitoring data is unavailable: GPU usage, logins and alerts", annotations: "Some monitoring data is unavailable: deploy marks" };
  let primary = null;
  if (activity.status === "gateway_unconfigured") primary = <GatewayNotConnected />;
  else if (activity.status === "unconfigured" || activity.status === "gateway_outdated")
    primary = <p className="portal-note" role="status">{text}</p>;
  else if (activity.status === "auth_failed") primary = <BlockError message={text} code="grafana_auth_failed" />;
  else if (activity.status === "unavailable") primary = <BlockError message={text} code="monitoring_unavailable" />;
  else if (activity.status === "gateway_error") primary = <BlockError message={text} code={activity.error ?? "unavailable"} />;
  // While older data is served the gateway keeps the old status (often "ok"), so errors are shown whenever present.
  const errorBlocks = activityUsable(activity.status)
    ? Object.entries(activity.errors).map(([source, code]) => <BlockError key={source} message={sources[source] ?? source} code={code} />)
    : [];
  const failedNow = Object.keys(activity.errors).length > 0;
  return (
    <>
      {primary}
      {errorBlocks}
      {activity.stale && (
        <p className="portal-note" role="status">
          {failedNow
            ? zh
              ? `顯示 ${value(activity.ageSeconds)} 秒前的資料，監控目前連不到`
              : `Showing data from ${value(activity.ageSeconds)} s ago; monitoring is unreachable right now`
            : zh
              ? `顯示 ${value(activity.ageSeconds)} 秒前的資料`
              : `Showing data from ${value(activity.ageSeconds)} s ago`}
        </p>
      )}
      {activity.truncated && <p className="portal-note">{zh ? "資料過多，已截斷" : "Too much data; the lists were truncated"}</p>}
    </>
  );
}

function AlertTable({ alerts, zh, caption, withReason }: { alerts: EngineerAlert[]; zh: boolean; caption: string; withReason: boolean }) {
  return (
    <table className="portal-table">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr>
          <th scope="col">{zh ? "告警" : "Alert"}</th>
          <th scope="col">{zh ? "嚴重度" : "Severity"}</th>
          <th scope="col">{zh ? "節點" : "Node"}</th>
          <th scope="col">{zh ? "GPU／掛載點" : "GPU / mount"}</th>
          <th scope="col">{zh ? "開始於" : "Since"}</th>
          {withReason && <th scope="col">{zh ? "歸屬" : "Why listed"}</th>}
        </tr>
      </thead>
      <tbody>
        {alerts.map((alert, index) => (
          <tr key={`${alert.alertname}-${alert.node}-${alert.gpu}-${alert.mountpoint}-${index}`}>
            <td>{alert.alertname}</td>
            <td>{alert.severity}</td>
            <td>{value(alert.node)}</td>
            <td>{alert.gpu !== null ? `GPU ${alert.gpu}` : value(alert.mountpoint)}</td>
            <td>{dateLabel(alert.since, zh)}</td>
            {withReason && (
              <td>{alert.reason === "user" ? (zh ? "本人的行程" : "Their own process") : zh ? "他的節點" : "On their node"}</td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DeployTable({ deploys, zh, caption, withOwner }: { deploys: EngineerDeploy[]; zh: boolean; caption: string; withOwner: boolean }) {
  return (
    <table className="portal-table">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr>
          <th scope="col">{zh ? "時間" : "Time"}</th>
          <th scope="col">{zh ? "節點" : "Node"}</th>
          {withOwner && <th scope="col">{zh ? "歸屬（owner）" : "Owner"}</th>}
          <th scope="col">{zh ? "使用者" : "User"}</th>
          <th scope="col">{zh ? "模型" : "Model"}</th>
          <th scope="col">{zh ? "連接埠" : "Port"}</th>
          <th scope="col">{zh ? "說明" : "Note"}</th>
        </tr>
      </thead>
      <tbody>
        {deploys.map((deploy, index) => (
          <tr key={`${deploy.id ?? "x"}-${index}`}>
            <td>{dateLabel(deploy.at, zh)}</td>
            <td>{value(deploy.node)}</td>
            {withOwner && <td>{value(deploy.owner)}</td>}
            <td>
              {value(deploy.user)}{" "}
              {!deploy.verified && <span className="portal-badge">{zh ? "未驗證" : "Unverified"}</span>}
            </td>
            <td>{value(deploy.model)}</td>
            <td>{value(deploy.port)}</td>
            <td>{deploy.text}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function EngineerDetails({ engineer, zh, alertsKnown, deploysKnown }: { engineer: Engineer; zh: boolean; alertsKnown: boolean; deploysKnown: boolean }) {
  const collectorLabel = (state: EngineerNode["collector"]) =>
    state === null ? "—" : state === "ok" ? "ok" : state === "stale" ? (zh ? "過時" : "stale") : zh ? "失敗" : "failed";
  return (
    <details>
      <summary>{zh ? `${engineer.displayName} 的節點與事件` : `${engineer.displayName}: nodes and events`}</summary>
      {engineer.nodes.length === 0 ? (
        <p className="portal-note">{zh ? "沒有分配節點。" : "No nodes assigned."}</p>
      ) : (
        <div className="portal-table-wrap">
          <table className="portal-table">
            <caption className="sr-only">{zh ? `${engineer.username} 的節點` : `Nodes of ${engineer.username}`}</caption>
            <thead>
              <tr>
                <th scope="col">{zh ? "節點" : "Node"}</th>
                <th scope="col">{zh ? "狀態" : "Status"}</th>
                <th scope="col">{zh ? "GPU 卡數" : "GPUs"}</th>
                <th scope="col">{zh ? "使用中" : "In use"}</th>
                <th scope="col">{zh ? "顯存" : "Memory"}</th>
                <th scope="col">{zh ? "行程數" : "Processes"}</th>
                <th scope="col">collector</th>
                <th scope="col">{zh ? "最後互動式登入" : "Last interactive login"}</th>
              </tr>
            </thead>
            <tbody>
              {engineer.nodes.map((node) => (
                <tr key={node.name}>
                  <td>
                    {node.name}
                    {node.labelMatches === false && (
                      <span className="portal-badge admin-badge-alert">
                        {zh ? "監控標籤與分配不一致（匯出尚未套用？）" : "Monitoring label differs from the allocation (export not applied yet?)"}
                      </span>
                    )}
                  </td>
                  <td>{node.up === null ? "—" : node.up ? "up" : "down"}</td>
                  <td>{value(node.gpuCount)}</td>
                  <td>{value(node.gpusInUse)}</td>
                  <td>{memoryLabel(node.memoryBytes)}</td>
                  <td>{value(node.processes)}</td>
                  <td>{collectorLabel(node.collector)}</td>
                  <td>{node.lastLoginAt ? dateLabel(node.lastLoginAt, zh) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <h3>{zh ? "告警" : "Alerts"}</h3>
      {engineer.alerts.length === 0 ? (
        <p className="portal-note">
          {alertsKnown ? (zh ? "沒有進行中的告警。" : "No firing alerts.") : zh ? "告警資料暫時無法取得。" : "Alert data is unavailable right now."}
        </p>
      ) : (
        <div className="portal-table-wrap">
          <AlertTable alerts={engineer.alerts} zh={zh} withReason caption={zh ? `${engineer.username} 的告警` : `Alerts for ${engineer.username}`} />
        </div>
      )}
      <h3>{zh ? "部署標記" : "Deploy marks"}</h3>
      {engineer.deploys.length === 0 ? (
        <p className="portal-note">
          {deploysKnown ? (zh ? "沒有部署標記。" : "No deploy marks.") : zh ? "部署標記暫時無法取得。" : "Deploy marks are unavailable right now."}
        </p>
      ) : (
        <div className="portal-table-wrap">
          <DeployTable deploys={engineer.deploys} zh={zh} withOwner={false} caption={zh ? `${engineer.username} 的部署標記` : `Deploy marks of ${engineer.username}`} />
        </div>
      )}
    </details>
  );
}

function Unmatched({ data, zh }: { data: EngineersOverview["unmatched"]; zh: boolean }) {
  if (!data.gpuUsage.length && !data.logins.length && !data.alerts.length && !data.deploys.length) return null;
  return (
    <details>
      <summary>{zh ? "未對應的資料" : "Unmatched data"}</summary>
      {data.gpuUsage.length > 0 && (
        <div className="portal-table-wrap">
          <table className="portal-table">
            <caption>{zh ? "不在名冊的使用者（GPU）" : "Users not on the roster (GPU)"}</caption>
            <thead>
              <tr>
                <th scope="col">{zh ? "節點" : "Node"}</th>
                <th scope="col">{zh ? "使用者" : "User"}</th>
                <th scope="col">GPU</th>
                <th scope="col">{zh ? "顯存" : "Memory"}</th>
                <th scope="col">{zh ? "行程數" : "Processes"}</th>
              </tr>
            </thead>
            <tbody>
              {data.gpuUsage.map((row) => (
                <tr key={`${row.node}-${row.username}`}>
                  <td>{row.node}</td>
                  <td>{row.username}</td>
                  <td>{value(row.gpus)}</td>
                  <td>{memoryLabel(row.memoryBytes)}</td>
                  <td>{value(row.processes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data.logins.length > 0 && (
        <div className="portal-table-wrap">
          <table className="portal-table">
            <caption>{zh ? "不在名冊的使用者（登入）" : "Users not on the roster (logins)"}</caption>
            <thead>
              <tr>
                <th scope="col">{zh ? "節點" : "Node"}</th>
                <th scope="col">{zh ? "使用者" : "User"}</th>
                <th scope="col">{zh ? "最後互動式登入" : "Last interactive login"}</th>
                <th scope="col">{zh ? "在線工作階段" : "Sessions"}</th>
              </tr>
            </thead>
            <tbody>
              {data.logins.map((row) => (
                <tr key={`${row.node}-${row.username}`}>
                  <td>{row.node}</td>
                  <td>{row.username}</td>
                  <td>{row.lastLoginAt ? dateLabel(row.lastLoginAt, zh) : "—"}</td>
                  <td>{value(row.sessions)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data.alerts.length > 0 && (
        <div className="portal-table-wrap">
          <AlertTable alerts={data.alerts} zh={zh} withReason={false} caption={zh ? "未分配節點的告警" : "Alerts on unassigned nodes"} />
        </div>
      )}
      {data.deploys.length > 0 && (
        <div className="portal-table-wrap">
          <DeployTable deploys={data.deploys} zh={zh} withOwner caption={zh ? "無法對應的部署" : "Deploys with no matching engineer"} />
        </div>
      )}
    </details>
  );
}

export function AdminEngineersSection() {
  const locale = useLocale().locale;
  const zh = locale === "zh";
  const resource = usePortalResource<EngineersOverview>("/admin/engineers");
  const data = resource.data;
  const alertsKnown = data ? sourceKnown(data.activity, "prometheus") : false;
  const deploysKnown = data ? sourceKnown(data.activity, "annotations") : false;
  return (
    <ResourceState {...resource}>
      {data && (
        <section className="portal-panel">
          <div className="portal-actions">
            <button type="button" className="portal-button-secondary" onClick={resource.refresh}>
              {zh ? "重新整理" : "Refresh"}
            </button>
            {data.activity.generatedAt && (
              <small>
                {zh
                  ? `資料時間：${dateLabel(data.activity.generatedAt, zh)}（${value(data.activity.ageSeconds)} 秒前）`
                  : `Data as of ${dateLabel(data.activity.generatedAt, zh)} (${value(data.activity.ageSeconds)} s ago)`}
              </small>
            )}
          </div>
          <p className="portal-note">
            {zh ? "唯讀。指令紀錄不在網頁上，請在節點上執行 " : "Read-only. Command history stays on the nodes: run "}
            <code>sudo b300-activity</code>
            {zh ? "。" : " there."}
          </p>
          <StatusArea data={data} zh={zh} />
          <div className="portal-table-wrap">
            <table className="portal-table">
              <caption className="sr-only">{zh ? "工程師" : "Engineers"}</caption>
              <thead>
                <tr>
                  <th scope="col">{zh ? "工程師" : "Engineer"}</th>
                  <th scope="col">{zh ? "節點" : "Nodes"}</th>
                  <th scope="col">{zh ? "SSH 金鑰" : "SSH key"}</th>
                  <th scope="col">{zh ? "最後互動式登入" : "Last interactive login"}</th>
                  <th scope="col">GPU</th>
                  <th scope="col">{zh ? "告警" : "Alerts"}</th>
                  <th scope="col">{zh ? "最近部署" : "Latest deploy"}</th>
                  <th scope="col">Grafana</th>
                </tr>
              </thead>
              {data.engineers.map((engineer) => {
                const key = engineerKeyStatusText(engineer.keyStatus, locale);
                const latest = engineer.deploys[0];
                return (
                  <tbody key={engineer.id} className={engineer.active ? undefined : "admin-engineer-inactive"}>
                    <tr>
                      <td>
                        {engineer.displayName} <span>@{engineer.username}</span>{" "}
                        {!engineer.active && <span className="portal-badge">{zh ? "已停用" : "Deactivated"}</span>}
                      </td>
                      <td>{engineer.nodes.length}</td>
                      <td>
                        <span className="portal-badge" title={key.title}>{key.label}</span>
                      </td>
                      <td>
                        {engineer.lastLoginAt ? dateLabel(engineer.lastLoginAt, zh) : "—"}{" "}
                        {engineer.loggedIn && <span className="portal-badge">{zh ? "在線" : "Online"}</span>}
                      </td>
                      <td>{gpuLabel(engineer.gpusInUse, engineer.memoryBytes, zh)}</td>
                      <td>
                        {alertsKnown || engineer.alerts.length > 0 ? (
                          <span
                            className={engineer.alerts.length > 0 ? "portal-badge admin-badge-alert" : "portal-badge"}
                            aria-label={zh ? `${engineer.alerts.length} 個告警` : `${engineer.alerts.length} alerts`}
                          >
                            {engineer.alerts.length}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>{latest ? `${dateLabel(latest.at, zh)} · ${value(latest.node)}` : "—"}</td>
                      <td>
                        {engineer.grafanaUrl && (
                          <a href={engineer.grafanaUrl} target="_blank" rel="noopener noreferrer"
                             aria-label={zh ? `在 Grafana 查看 ${engineer.username}` : `Open Grafana for ${engineer.username}`}>
                            Grafana
                          </a>
                        )}
                      </td>
                    </tr>
                    <tr>
                      <td colSpan={8}>
                        <EngineerDetails engineer={engineer} zh={zh} alertsKnown={alertsKnown} deploysKnown={deploysKnown} />
                      </td>
                    </tr>
                  </tbody>
                );
              })}
            </table>
          </div>
          <Unmatched data={data.unmatched} zh={zh} />
        </section>
      )}
    </ResourceState>
  );
}
